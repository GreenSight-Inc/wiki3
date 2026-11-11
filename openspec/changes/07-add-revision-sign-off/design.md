# Design

## Context

See proposal.md section Why for the motivation and the gate. This section names only the code that shapes the approach. Every name below was checked against the working copy on 2026-11-10.

- **Versions.** `pageHistory` in `backend/db/schema.ts` holds one complete row per change. `models/pageHistory.ts` writes it in `record()`, which snapshots the page row after the change. `latestVersionId(siteId, pageId)` returns the newest row, which is the page as it stands. The id is a random uuid, so it is not monotonic. Six call sites in `models/pages.ts` call `record()`: create, update, move, delete, restore, and the bulk delete. `convertPage` and `adoptStoredPage` reach `updatePage` or `createPage`, so they record through those.
- **Every save records a version.** `updatePage` calls `record()` even when no field changed. It emits the `page:edit` notification only when `notificationVariants` finds a change.
- **The history purge** (`pageHistory.purge`) deletes every version older than a timeframe. A page whose every version is older loses its history entirely, so `latestVersionId` then returns null.
- **The page row is copied into every version.** `record()` copies each column of `pages` into `meta`, except the names in `EXCLUDED_FROM_META`. `changedFields()` skips the names in `NOT_REPORTED_AS_CHANGED`. The lifecycle columns `contentUpdatedAt`, `lastReviewedAt`, and `lifecycleBanner` sit in the first list for this reason (`.claude/rules/page-lifecycle.md`).
- **Approval rules and edit suggestions** (`models/approvals.ts`, `api/approvals.ts`, `approvalRules`, `pageEditSubmissions`) decide who publishes and queue suggestions for reviewers. The page payload already carries their state as `approvalState`, and `api/approvals.ts` owns the `reviewerFor` helper. This change touches none of it and takes no name from it.
- **Page owners** (`models/pageOwners.ts`, `api/pageOwners.ts`) are the template. They use a separate table and a `PUT …/ownership` route with `write:pages`. The route checks the list rungs for naming users or groups and writes an audit action. The page payload carries `ownership` for writers only. The panel holds a pending edit in `editorStore.ownership`, and `pageSave` sends it after the page save. Owners are users or groups, never a mix. `MAX_PAGE_OWNERS` is 50.
- **Mark as reviewed** (`PUT …/reviewed` in `api/pageLifecycle.ts`) sets `pages.lastReviewedAt` and removes the lifecycle banner. It records no version and says nothing about a version.
- **Notifications** (`.claude/rules/notifications.md`, `dev/specs/notifications.md`). A category is a file under `backend/notifications/categories/`, a key in `NOTIFICATION_CATEGORIES`, and its strings. An event kind is a key in `NOTIFICATION_EVENT_KINDS` with an `emit()` call. `ownersOf` in `notifications/recipients.ts` shows how a recipient query expands groups through `userGroups` and keeps active accounts that are not system accounts. The fan-out leaves the actor out and checks the category's `access` permission per group set. It does not apply the rule for pages that are not live.
- **Live pages** (`helpers/publishing.ts`). `liveCondition` is the SQL form. No JavaScript form exists yet.
- **Frontend.** `PagePropertiesDialog.vue` has the Ownership and Lifecycle Rules sections, the user and group lookups, and the `w-btn-toggle` and `w-select` controls. `PageHeader.vue` has the pending suggestions button with a `w-badge`. `stores/page.js` holds `ownership` and `pageSaveOwnership`. `stores/editor.js` holds the pending `ownership` and the `hasPendingChanges` getter.
- **Uncommitted work** from changes 01 to 03 sits in `backend/api/pages.ts` (the print QR code), `backend/api/schemas/page.ts`, `backend/locales/en.json`, `frontend/src/components/PageHeader.vue` (the print meta line and QR code), and `frontend/src/stores/page.js`. This change adds to those files and leaves that work as it is.

## Goals / Non-Goals

**Goals:**

- One stored shape that answers "who signed which version" without a second copy of the page.
- One place that clears and requests sign-off after a version, reached by every path that records one.
- Reuse of the ownership patterns for the route, the panel, and the store.

**Non-Goals:**

- No change to the purge, to `pageHistory`, or to how a version is recorded.
- No fan-out change for pages that are not live. Change 06 raises that question for watchers.
- No snapshot of group membership.

## Decisions

### 1. Stored shape

- `pages.signOffMode`, `varchar(16)`, not null, default `'off'`. A varchar rather than an enum, as `pageHistory.action` is, so that a later mode needs no migration. The code keeps the closed list `SIGN_OFF_MODES = ['off', 'review', 'approve'] as const` in the model.
- `pageSignOffApprovers`: `id` uuid, `pageId` (cascade on page delete), `userId` (cascade), `groupId` (cascade), with `num_nonnulls(userId, groupId) = 1`. Unique indexes on `(pageId, userId)` and `(pageId, groupId)`, and plain indexes on `userId` and `groupId`. This mirrors `pageOwners`, except that one page mixes users and groups.
- `pageSignOffs`: `id` uuid, `pageId` (cascade on page delete), `versionId` uuid with no foreign key, `userId` (cascade on user delete), `verdict` varchar(24) (`signed` or `changesRequested`), `comment` text, `createdAt`. A unique index on `(versionId, userId)` makes a second verdict an upsert. An index on `(pageId, versionId)` serves the status.
- `versionId` has no foreign key for the reason `pageHistory.pageId` has none. The purge deletes version rows, and the sign-off record of an older version stays for history (spec requirement Sign-off belongs to one version).
- Alternative considered: a mode column inside `pages.config`. Rejected, because `config` is page content. Every version copies it and a version restore puts it back.
- Alternative considered: a column `signOffVersionId` on `pages` that only content changes move. Rejected for now, because "every new version clears" is the default in proposal.md section Open Questions. The column is the path if the user picks "content changes only".

**Migration.** The name is `page-sign-off`. The command is `cd backend && npm run db-generate -- --name=page-sign-off`. It adds the column with its default, so every existing row reads `off`, and it creates the two tables. It converts no rows. After it, the code reads one shape with no fallback (CLAUDE.md first section). The column is not part of a version: `signOffMode` goes into `EXCLUDED_FROM_META` and `NOT_REPORTED_AS_CHANGED` in `models/pageHistory.ts`. `restorePage` writes explicit columns, so a restored page gets the default `off`.

### 2. The current version and what clears a sign-off

The current version is `pageHistory.latestVersionId(siteId, pageId)`. The status counts only the `pageSignOffs` rows with that `versionId`. A new version of any kind clears the status by being newer. Nothing is deleted. A page with no version left after a purge has no current version, and the verdict route answers 409.

A verdict carries the `versionId` the approver saw. The route compares it with the current version and answers 409 when they differ. This closes the race where a publish lands between reading and signing.

### 3. One hook after a version

A new method `WIKI.models.pageSignOff.versionRecorded(siteId, page, versionId, actor)` runs after `record()` in `updatePage` and `movePage`. It reads `page.signOffMode`. For mode `off`, a null `versionId`, or a page that is not live, it does nothing. Otherwise it emits `page:signOffRequest` with the page snapshot, the `versionId`, and the actor. `createPage` needs no call, because a new page starts with mode `off`. `deletePage` needs none, because the cascade removes the rows. The storage import path reaches `updatePage`, so a git pull asks for sign-off too.

A new helper `isLiveNow(page)` in `helpers/publishing.ts` is the JavaScript twin of `liveCondition`. It uses `Temporal.Now.instant()` against the two dates. A scheduled page outside its window gets no notification, and no event fires when its window opens later. Approvers see it on their next visit.

### 4. Permissions

| Act | Permission | Kind | Where checked |
| --- | --- | --- | --- |
| Set mode and approvers | `manage:pages` on the page | page rule | handler, `mayOnPage` |
| Name a new user | `list:users` rung (`LIST_USERS_PERMISSIONS`) or `manage:system` | global | handler, against `actor.permissions` |
| Name a new group | `list:groups` rung (`LIST_GROUPS_PERMISSIONS`) or `manage:system` | global | handler, against `actor.permissions` |
| Read the status and counts | `read:pages` on the page, plus `unpublishedFor(req)` | page rule | handler, through `getPage` and `mayOnPage` |
| See names and verdicts | `write:pages` or `manage:pages` on the page, or current approver | page rule | handler |
| Record a verdict | signed-in account, current approver, `read:pages` on the page | page rule | handler |
| Receive either notification | `read:pages` on the page | page rule | fan-out, category `access` |

No route declares `config.permissions`. Each handler carries a `No route-level permissions:` comment, as `api/pageOwners.ts` does.

`manage:pages` is the default, because a writer who sets the approvers of a page they publish defeats the control. `write:pages` is the alternative, and proposal.md section Open Questions names it. The read-only view in the panel goes to `write:pages` holders.

### 5. Group approvers

`currentApproverIds(pageId)` runs one query. It unions the listed users with the members of the listed groups through `userGroups`, joins `users` on `isActive AND NOT isSystem`, and returns distinct ids. Membership is read at each check. "Every current approver signed" means every id in that set has a `signed` row on the current version. A group with no members adds nobody. An empty set is never approved. A new member is pending at once, as in the fork.

### 6. Approvers who cannot read the page

The status computes `canRead` per approver with `WIKI.models.groups.checkAccess` and an `AccessActor` built from that user's group ids and flattened group permissions. This runs only for callers who see the list, and the list holds at most 50 entries before expansion. An approver without `read:pages` stays in the required set and is pending. The fan-out drops that approver from notifications. The verdict route answers 404 to that approver, because `getPage` with `unpublishedFor` and `mayOnPage` decide first.

### 7. Unpublished and scheduled versions

A page in draft accepts no verdict (409), is never approved, and sends no request. A scheduled page accepts verdicts from approvers who can see it. Outside its window that means `write:pages` or `manage:pages` on it, through the existing rule. The status reports `isLive`, so the badge shows "not live" for an editor on a page that is not live.

### 8. History of older versions

Rows stay until the page or the account goes. `GET …/sign-off?versionId=<id>` returns the verdicts of that version for callers who see the list. The history overlay gets no change in this change. A version list badge is a later step. A deleted account takes its sign-offs with it, which keeps the status consistent, because the same account leaves the approver set.

### 9. Notification categories

| Key | Event | Section | Origins | Priority | Recipients | Access | groupKey |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `signOffRequested` | `page:signOffRequest` | `reviews` | `user`, `import` | 32 | `approversOf` | `read:pages` | `signOff:<pageId>` |
| `signOffChangesRequested` | `page:signOffChanges` | `reviews` | `user` | 31 | `versionAuthorAndOwnersOf` | `read:pages` | `signOffChanges:<pageId>` |

Both default to in-app and email on. `groupKey` per page coalesces several publishes into one unread entry. `approversOf` follows `ownersOf`, with keyset paging over the union in decision 5. `versionAuthorAndOwnersOf` unions the version author, carried as `data.versionAuthorId`, with the `ownersOf` query. `NotificationEventData` gains `versionId` and `versionAuthorId`. The comment start travels as `excerpt`, in Markdown, cut to the length the comment events use. Separate event kinds keep `page:edit` and the `watchedPage` category as they are. A person who watches and approves gets two entries, one for the change and one for the request. Both say different things.

### 10. Routes and schemas

A new file `backend/api/pageSignOff.ts`, registered in `backend/api/index.ts` next to `pageOwners.ts`. A new schema file `backend/api/schemas/pageSignOff.ts` registers `PageSignOffStatus`, `PageSignOffApprover`, and `PageSignOffEntry`, and `backend/api/index.ts` registers it before the routes. Every route declares `summary`, `tags: ['Pages']`, and response schemas, and `config.scope: 'pages'`, as the ownership route does.

- `GET /sites/:siteId/pages/:pageId/sign-off`, with an optional query `versionId`. It answers `PageSignOffStatus` with these fields. They are `mode`, `versionId`, `isLive`, `required`, `signed`, `changesRequested`, `isApproved`, `viewer { isApprover, verdict, canManage, canSeeList }`, `approvers` (the configured users and groups as `{ id, name }`, or null), and `entries` (each current approver as `{ userId, name, verdict, comment, at, canRead }`, or null).
- `PUT /sites/:siteId/pages/:pageId/sign-off`, body `{ mode, users, groups }`. Answers `{ ok, signOff: PageSignOffStatus }`. Audit `updatePageSignOff` with `pageId`, `siteId`, `locale`, `path`, and `mode`.
- `POST /sites/:siteId/pages/:pageId/sign-off/verdict`, body `{ versionId, verdict, comment }`. Answers `{ ok, signOff: PageSignOffStatus }`. Audit `signOffPage` or `requestSignOffChanges` with `pageId`, `siteId`, `locale`, `path`, and `versionId`, never the comment.

The page payload in `GET /sites/:siteId/pages/:pageId` and the path lookup gains `signOff`: null for mode `off`, else `{ mode, versionId, isLive, required, signed, changesRequested, isApproved, viewer }`. It costs two queries, and none for mode `off`. The `Page` schema in `backend/api/schemas/page.ts` gains the field. No route returns module configuration, so no sensitive prop needs a mask. No response carries an email.

### 11. Model

A new file `backend/models/pageSignOff.ts` is registered in `backend/models/index.ts` as `pageSignOff`. Its constants are `SIGN_OFF_MODES`, `SIGN_OFF_VERDICTS`, and `MAX_SIGN_OFF_APPROVERS = 50`. Its methods are `settingsOf`, `setSettings` (one transaction: update the mode, delete and insert the approver rows), `currentApproverIds`, `statusOf`, `recordVerdict` (upsert, then emit `page:signOffChanges` for a changes verdict), and `versionRecorded`. Business logic stays in the model and audit calls stay in the routes (`.claude/rules/audit-log.md`).

### 12. Frontend

- `frontend/src/stores/page.js`: state `signOff` from the page payload and `signOffSettings` for the panel. Actions `pageLoadSignOff()` (`API_CLIENT.get('sites/<siteId>/pages/<id>/sign-off')`), `pageSaveSignOff(settings)` (`API_CLIENT.put(...)`), and `pageRecordSignOff({ versionId, verdict, comment })` (`API_CLIENT.post('…/sign-off/verdict')`). `pageSave` sends a pending sign-off edit after the page save, beside `ownership` and `lifecycleRules`.
- `frontend/src/stores/editor.js`: state `signOff`, null when nothing is pending, counted in `hasPendingChanges` and reset with the others.
- `frontend/src/components/PagePropertiesDialog.vue`: a Sign-off section after Ownership, with `w-btn-toggle` for the mode and two `w-select` pickers that reuse `lookupUsers` and `lookupGroups`. Shown when `userStore.pagePermissions` holds `manage:pages`, read-only chips for `write:pages`, hidden in suggest mode. A table-of-contents entry like the others.
- `frontend/src/components/PageHeader.vue`: a `w-btn` with a `w-chip` beside the pending suggestions button, shown when `pageStore.signOff` is set and `editorStore.isActive` is false. Colors come from the palette: `positive` for Approved, `negative` for changes requested, `grey` for pending and review. Click opens the dialog.
- `frontend/src/components/PageSignOffDialog.vue`, new: the approver list from `pageLoadSignOff()`, a Sign off button, and a Request changes form with a `w-input` textarea. It uses `w-dialog`, `w-card`, `w-list`, `w-item`, `w-btn`, and `w-input`. A 409 answer shows `common.page.signOff.stale` and reloads the status.
- No new dark-mode rule. The chip and the dialog use palette colors and shared components that carry their own dark styles. If a rule turns out to be needed, it goes under `.body--dark &` with its `.w-dark-surface &` twin, as `_base.scss` does.

### 13. Files by workspace

- backend: `db/schema.ts`, `db/migrations/<timestamp>_page-sign-off/` (generated), `models/pageSignOff.ts` (new), `models/index.ts`, `models/pages.ts`, `models/pageHistory.ts`, `models/auditLog.ts`, `helpers/publishing.ts`, `api/pageSignOff.ts` (new), `api/schemas/pageSignOff.ts` (new), `api/schemas/page.ts`, `api/index.ts`, `api/pages.ts`, `notifications/types.ts`, `notifications/index.ts`, `notifications/recipients.ts`, `notifications/categories/signOffRequested.ts` (new), `notifications/categories/signOffChangesRequested.ts` (new), `locales/en.json`.
- frontend: `src/stores/page.js`, `src/stores/editor.js`, `src/components/PagePropertiesDialog.vue`, `src/components/PageHeader.vue`, `src/components/PageSignOffDialog.vue` (new).
- docs: `.claude/rules/page-sign-off.md` (new), a line in the rule list of the root `CLAUDE.md`, and a line in `.claude/rules/notifications.md` for the two categories.

## Locale keys

| Key | English string |
| --- | --- |
| `editor.props.signOff` | Sign-off |
| `editor.props.signOffHint` | Ask named people to sign off each published version of this page. |
| `editor.props.signOffModeOff` | Off |
| `editor.props.signOffModeReview` | Review |
| `editor.props.signOffModeApprove` | Approve |
| `editor.props.signOffModeOffHint` | Nobody is asked to sign off this page. |
| `editor.props.signOffModeReviewHint` | Approvers are asked to review each version. The page shows how many signed off. |
| `editor.props.signOffModeApproveHint` | Approvers are asked to approve each version. The page shows Approved once all of them signed off. |
| `editor.props.signOffUsers` | Approvers |
| `editor.props.signOffGroups` | Approver groups |
| `editor.props.signOffReadOnly` | Only somebody who can manage this page can change its sign-off. |
| `common.page.signOff.title` | Sign-off |
| `common.page.signOff.approved` | Approved |
| `common.page.signOff.pending` | Awaiting sign-off ({signed} of {required}) |
| `common.page.signOff.reviewed` | Signed off by {signed} of {required} |
| `common.page.signOff.changesRequested` | Changes requested |
| `common.page.signOff.notLive` | Not live, so it cannot be signed off |
| `common.page.signOff.sign` | Sign off |
| `common.page.signOff.requestChanges` | Request changes |
| `common.page.signOff.comment` | What needs to change |
| `common.page.signOff.stale` | A newer version was published. Read it, then sign off again. |
| `common.page.signOff.noAccess` | Cannot read this page |
| `common.page.signOff.verdictSigned` | Signed off |
| `common.page.signOff.verdictChanges` | Asked for changes |
| `common.page.signOff.verdictPending` | Pending |
| `notifications.categories.signOffRequested.title` | Pages to sign off |
| `notifications.categories.signOffRequested.description` | A page you sign off has a new version. |
| `notifications.categories.signOffChangesRequested.title` | Changes requested |
| `notifications.categories.signOffChangesRequested.description` | An approver asks for changes to a page you wrote or own. |
| `notifications.messages.signOffRequested.requested` | {actor} asks you to sign off {page} |
| `notifications.messages.signOffChangesRequested.requested` | {actor} asked for changes to {page} |
| `mail.notification.actions.signOffRequested` | Review the page |
| `mail.notification.actions.signOffChangesRequested` | View the page |
| `admin.audit.actions.updatePageSignOff` | Changed the sign-off of a page |
| `admin.audit.actions.signOffPage` | Signed off a page |
| `admin.audit.actions.requestSignOffChanges` | Asked for changes to a page |

Each key goes next to its neighbors in `backend/locales/en.json`.

## Risks / Trade-offs

- [The history purge removes the current version of an unchanged page. Its Approved badge goes with it.] → The status reports no current version. The next save records one. The rule file states it. A change to the purge is out of scope and is an open question.
- [Every new version clears the status, including a tag change, a move, or a lifecycle rule action.] → This matches the fork. The alternative column in decision 1 is ready if the user picks content changes only.
- [A large approver group makes the badge hard to reach. One new member makes an approved page pending.] → The panel hint says that every member signs. The open question on one member per group stays with the user.
- [An approver without read access blocks the badge without being told.] → The list marks that approver. The people who see the list are the people who fix the rules.
- [Changes 06 and 07 both edit `notifications/recipients.ts`, the page payload, and `db/schema.ts`.] → The second change rebases first. Then it generates its migration. The task list says so.
- [A save to a page in approve mode sends one extra notification per approver.] → The per-page `groupKey` coalesces repeated saves into one unread entry.

## Migration Plan

1. The migration `page-sign-off` runs on the next boot, as every Drizzle migration does. It is additive: one column with a default and two empty tables.
2. Rollback of the code is `git revert` of the commit. A revert leaves the column and the two tables in the database. The reverted code never reads them. A page row with an extra column still loads, because Drizzle selects only the columns that the schema names. No reverse migration is needed for a revert. Assumption: the Drizzle journal keeps the row of the reverted migration, so a reinstall of the same commit runs nothing twice. The throwaway instance in task group 7 does not test this.
3. Rows in the two tables and the mode on pages survive a revert. If the change is dropped for good, a new migration drops them. That is a separate change.

## Open Questions

- Does the legacy wiki use sign-off today? Default applied: none. Task 1.1 is the gate, and no other task runs before it.
- Which page permission sets the mode and the approvers? Default applied: `manage:pages`.
- Does a group need every member to sign? Default applied: every current member.
- Does an approver without read access count as pending? Default applied: yes, marked without access.
- Does every new version clear the status, or only a content change? Default applied: every new version.
- Does an approver sign a version they wrote? Default applied: yes.
- Does the history purge spare the newest version of a page with mode on? Default applied: no change to the purge.
- Does a scheduled page get a sign-off request when its window opens? Default applied: no. Only a save, a move, or an import sends one.
- Does the history overlay show the sign-offs of each version? Default applied: not in this change. The status route with `versionId` serves a later step.
