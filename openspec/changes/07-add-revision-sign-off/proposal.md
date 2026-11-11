# Proposal

## Why

In the Wiki.js 2 fork, a page can ask named approvers to sign off each published revision. In approve mode, a fully signed page shows an Approved badge. Wiki.js 3 has nothing that records who signed which version of a page. The export package does not carry the fork's sign-off tables, so the feature and its history end at the migration.

This change is conditional. It goes ahead only if the legacy wiki uses the feature today. The user runs the read-only `approvalMode`, `pageApprovers`, and `pageApprovals` queries from the plan section "User-run queries before a decision on B3 and B5". If every page has `approvalMode` off and `pageApprovals` is empty, the change is dropped. Task 1.1 is this gate. The plan estimates 5 to 8 days of work.

## What Changes

- A page gets a sign-off mode: `off`, `review`, or `approve`. The default is `off`. A sign-off is the statement of one approver that one page version is correct.
- A page gets a list of sign-off approvers. An approver is an active user or a group other than Guests. A group counts as every one of its current members.
- Each new version of a live page notifies the approvers in-app and by email, as the new notification category `signOffRequested`.
- An approver signs off the current version, or requests changes with a comment. A request for changes notifies the author of that version and the page owners, as the new category `signOffChangesRequested`.
- A sign-off belongs to one page version. A later version clears the status, because the status counts only the sign-offs of the current version. The records of older versions stay for history.
- In approve mode, the page header shows an Approved badge when every current approver signed the current version. In review mode, it shows how many approvers signed. Both modes show pending progress and a changes-requested state.
- A new Sign-off section in the page properties panel sets the mode and the approvers.
- New routes read the sign-off status, set the mode and the approvers, and record a verdict. Three new audit actions record these writes.
- A new column on `pages` and two new tables hold the shape, with one Drizzle migration.
- A new rule file `.claude/rules/page-sign-off.md` holds the durable facts (working rule D).

## Capabilities

### New Capabilities

- `page-sign-off`: per-page sign-off of versions by named approvers, the sign-off status and the Approved badge, the notifications, and who sets the mode and the approvers.

### Modified Capabilities

None. `openspec/specs/` holds no capability yet.

## Non-goals

- No change to approval rules or edit suggestions (`approvalRules`, `pageEditSubmissions`, the review queue). Those govern who publishes. This change records who signed what was published. The names in this change avoid "approval rule" and "approval".
- No blocking of a publish. A sign-off records agreement after the fact. It never holds a save back.
- No delta email with a diff since the approver's last sign-off. The notification links to the page, and the history view already compares versions.
- No manual "request sign-off again" action.
- No new global permission and no new page permission.
- No import of the legacy sign-off history. The fork's `pageApprovers` and `pageApprovals` tables are not in the `.wkbackup` export package. Carrying them over is out of scope. A CSV export of `pageApprovals` on the legacy wiki is the user's own step before cutover, if the company needs the record.
- No sign-off through the MCP server and no change to storage targets. The sign-off shape is not page content, so storage export, page duplication, and the restore of a deleted page leave it out.
- No link between a sign-off and the lifecycle "mark as reviewed" action. A sign-off does not set `lastReviewedAt` and does not remove a lifecycle banner.

## Impact

- Workspaces: backend and frontend. Not blocks.
- Rule files: `.claude/rules/notifications.md` covers the two new categories and their events. `.claude/rules/page-lifecycle.md` names `EXCLUDED_FROM_META`, which gets the new column. `.claude/rules/audit-log.md` covers the three new audit actions. No rule file covers sign-off yet, so the change adds `.claude/rules/page-sign-off.md`. The notifications design is `dev/specs/notifications.md`. No design under `dev/specs/` covers sign-off, and the rule file is enough for its size.
- Stored shape: the change adds a column and two tables that no committed version holds. The column is `pages.signOffMode`, default `off`. The tables are `pageSignOffApprovers` and `pageSignOffs`. The `pages` table is committed, so the change adds the migration `page-sign-off`. It adds the column with its default and creates both tables. It converts no rows, so every existing page reads as mode `off` after the upgrade.
- Permissions, all from CLAUDE.md section Permissions:
  - `manage:pages` on the page, a page rule permission, to set the mode and the approvers. Naming a user who is not on the list yet also needs a global `list:users` rung (`list:users`, `read:users`, `write:users`, or `manage:users`). Naming a new group needs a `list:groups` rung (`list:groups`, `read:groups`, `write:groups`, or `manage:groups`). `manage:system` passes every check.
  - `read:pages` on the page to read the status and the badge. The rule for pages that are not live applies as today, through `unpublishedFor`.
  - `write:pages` or `manage:pages` on the page, or being an approver, to see the names and verdicts of the approvers.
  - A signed-in account that is a current approver and holds `read:pages` on the page to record a verdict.
  - The fan-out checks `read:pages` for each recipient of both categories.
- API: `GET /sites/:siteId/pages/:pageId/sign-off`, `PUT /sites/:siteId/pages/:pageId/sign-off`, and `POST /sites/:siteId/pages/:pageId/sign-off/verdict`. A new field `signOff` on the page payload carries the summary for the header badge.
- Notifications: two new categories, `signOffRequested` and `signOffChangesRequested`, in the `reviews` section. Two new event kinds, `page:signOffRequest` and `page:signOffChanges`.
- Locale keys in `backend/locales/en.json`, all listed with their strings in design.md section Locale keys:
  - `editor.props.signOff`, `editor.props.signOffHint`, `editor.props.signOffModeOff`, `editor.props.signOffModeReview`, `editor.props.signOffModeApprove`, `editor.props.signOffModeOffHint`, `editor.props.signOffModeReviewHint`, `editor.props.signOffModeApproveHint`, `editor.props.signOffUsers`, `editor.props.signOffGroups`, `editor.props.signOffReadOnly`.
  - `common.page.signOff.title`, `common.page.signOff.approved`, `common.page.signOff.pending`, `common.page.signOff.reviewed`, `common.page.signOff.changesRequested`, `common.page.signOff.notLive`, `common.page.signOff.sign`, `common.page.signOff.requestChanges`, `common.page.signOff.comment`, `common.page.signOff.stale`, `common.page.signOff.noAccess`, `common.page.signOff.verdictSigned`, `common.page.signOff.verdictChanges`, `common.page.signOff.verdictPending`.
  - `notifications.categories.signOffRequested.title`, `notifications.categories.signOffRequested.description`, `notifications.categories.signOffChangesRequested.title`, `notifications.categories.signOffChangesRequested.description`, `notifications.messages.signOffRequested.requested`, `notifications.messages.signOffChangesRequested.requested`, `mail.notification.actions.signOffRequested`, `mail.notification.actions.signOffChangesRequested`.
  - `admin.audit.actions.updatePageSignOff`, `admin.audit.actions.signOffPage`, `admin.audit.actions.requestSignOffChanges`.
- New dependencies: none. The frontend reuses the user and group lookups and the shared components of the Ownership section.
- Verification tier: the check set plus a throwaway instance (working rule C). The change is a flow with real state: a save creates a version, a sign-off records against it, and a later save clears it. The header badge is also new UI that meets the header stylesheet. The backend boots only on Node.js 26, so the instance runs in the dev container.
- Uncommitted work from changes 01 to 03 sits in `backend/api/pages.ts`, `backend/api/schemas/page.ts`, `backend/locales/en.json`, `frontend/src/components/PageHeader.vue`, and `frontend/src/stores/page.js`. This change edits those files too and keeps that work intact. Change 06 plans edits to `backend/notifications/recipients.ts`, the page payload, and `backend/db/schema.ts`. Whichever change lands second generates its migration on top of the first.

## Open Questions

- Does the legacy wiki use sign-off today? The user runs the `approvalMode`, `pageApprovers`, and `pageApprovals` queries. If every page is `off` and `pageApprovals` is empty, the change is dropped. Task 1.1 is this gate.
- Is `manage:pages` the right page permission to set the mode and the approvers? Default applied: `manage:pages`. `write:pages` matches ownership, but a writer then removes the approvers of a page that the writer publishes. No new permission is proposed.
- Does a group approver need every current member to sign, or one member? Default applied: every current member, as in the fork. A large group makes the Approved badge hard to reach.
- An approver who cannot read the page cannot sign. Does that approver still count as pending? Default applied: yes. The status marks that approver as without access, and the badge stays pending.
- Does a version that changes only metadata, such as tags, the publish dates, or the path, clear the status? Default applied: yes. Every new version clears it, as every publish did in the fork.
- Does an approver sign a version they wrote themselves? Default applied: yes, as in the fork. A four-eyes rule refuses it instead.
- Does the legacy sign-off history need a CSV export before cutover? Default applied: no export. The user decides after the gate query.
