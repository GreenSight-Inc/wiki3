# Design

## Context

See proposal.md, section Why, for the motivation and the condition. The code facts that shape the design:

- `pageWatching` holds one row per person and page. `userId` is NOT NULL, and a unique index covers `(pageId, userId)`. The table is in the committed init migration.
- `watchersOf` in `backend/notifications/recipients.ts` yields the watcher ids of a page in ascending order, a batch of 1,000 at a time, by keyset. Both `watchedPage` and `watchedPageComment` use it. For `page:delete` it reads `event.recipients` instead.
- `notifications.emit` in `backend/models/notifications.ts` fills `recipients` for a deletion in the INSERT itself: `ARRAY(SELECT "userId" FROM "pageWatching" WHERE "pageId" = …)`. `pages.deletePage` and the folder delete in `backend/models/pages.ts` call it before the rows go.
- The fan-out in `backend/notifications/fanout.ts` runs five steps per batch for every category. It drops the actor, and it drops disabled and system accounts. It checks access per group set and applies each person's preferences and the section switch. It skips a person who already holds an entry for the event. The upsert on `(userId, groupKey) WHERE readAt IS NULL` coalesces repeated events.
- Page ownership is the closest pattern. `pageOwners` is a table, `PUT …/pages/:pageId/ownership` sets it with `write:pages` on the page, and the page payload returns it only to a requester with `write:pages`. Since upstream 3.3.1, the ownership route and the lifecycle rules route also call `WIKI.models.pages.assertEditable(page)`. A page locked against edits (`isEditLocked`) answers 423 `pageEditLocked` there. The properties panel edits it as `editorStore.ownership` and `pageSave` sends it by its own request.
- The fork stores watchers in `pageWatchers` with `userId` XOR `groupId`, and expands groups to live membership. The plan query `count("groupId") AS group_watch_rows` reads that table.

## Goals / Non-Goals

**Goals:**

- One recipient query covers personal and group watchers. The five fan-out steps stay the only place for exclusion, access, and preferences.
- No change to the committed `pageWatching` shape and no change to personal watching.

**Non-Goals:**

- No per-member opt-out row. No group watch in `listForUser`, `isWatching`, or the inbox Watching list.
- No change to the access rule that the fan-out applies to watchers in general. See Open Questions.

## Decisions

### D1. A new table `pageWatchGroups`

Columns: `id` uuid primary key and `createdAt` timestamp. `pageId` uuid NOT NULL references `pages.id` on delete cascade. `siteId` uuid NOT NULL references `sites.id`. `groupId` uuid NOT NULL references `groups.id` on delete cascade. Indexes: unique `pageWatchGroups_page_group_idx` on `(pageId, groupId)`, and `pageWatchGroups_groupId_idx` on `groupId`.

Alternative considered: a nullable `groupId` column on `pageWatching` with a check that exactly one of `userId` and `groupId` is set. Rejected. It changes a committed shape. It makes `userId` nullable, so `isWatching`, `watch`, `unwatch`, `listForUser`, the deletion capture, and the unique index all need a guard. A separate table leaves every personal-watch path as it is.

A deleted group takes its rows with it through the cascade. A deleted page does the same. The page row lock in D5 serializes two saves of the same list.

### D2. The migration `page-watch-groups`

Edit `backend/db/schema.ts` to add the table next to `pageWatching`. Then run `cd backend && npm run db-generate -- --name=page-watch-groups`. The migration creates the table, the two indexes, and the three foreign keys. It converts no rows, because no installation holds group watches yet. After it runs, the code reads one shape and carries no fallback.

Rollback: `git revert` of the commit removes the code. The table stays in the database, empty or holding rows that nothing reads. No reverse migration is needed. A later forward migration drops the table if the feature is removed for good.

### D3. `watchersOf` reads both tables in one ordered query

`watchersOf` keeps its signature and its keyset contract. For an edit or a comment, it runs one SQL query in the style of `ownersOf`:

```sql
SELECT id FROM (
  SELECT "userId" AS id FROM "pageWatching" WHERE "pageId" = $page
  UNION
  SELECT ug."userId" AS id FROM "pageWatchGroups" pwg
  JOIN "userGroups" ug ON ug."groupId" = pwg."groupId"
  WHERE pwg."pageId" = $page
) audience
WHERE id > $cursor
ORDER BY id
LIMIT $limit
```

`UNION` removes duplicates, so a person who watches personally and through two groups appears once. That matters twice. The keyset contract asks for strictly ascending ids. The multi-row upsert in `deliverBatch` fails when one INSERT holds the same `(userId, groupKey)` twice.

The live membership comes from reading `userGroups` at fan-out time. `recipientsAmong` then drops the actor, disabled accounts, and system accounts. The guest account is a system account.

Both `watchedPage` and `watchedPageComment` reach group members through this one function. Assumption: a group watch means the same as a personal watch, so members also hear about comments. The user confirms this. If not, a second function `personalWatchersOf` serves `watchedPageComment`.

### D4. The deletion capture includes group members

`notifications.emit` builds `recipients` with the same union, in the same statement:

```sql
ARRAY(
  SELECT "userId" FROM "pageWatching" WHERE "pageId" = $page
  UNION
  SELECT ug."userId" FROM "pageWatchGroups" pwg
  JOIN "userGroups" ug ON ug."groupId" = pwg."groupId"
  WHERE pwg."pageId" = $page
)
```

The membership is frozen at the moment of the deletion, which is the last moment the rows exist. `fromList` already deduplicates and sorts the list. The rule in `.claude/rules/notifications.md` about deletions holds: every path that deletes page rows still emits through `emit` with `watchersOf`.

### D5. The model lives in `backend/models/pageWatching.ts`

Two methods join the `PageWatching` class.

- `watchGroupsOf(pageId): Promise<GroupLookup[]>` joins `pageWatchGroups` to `groups` and orders by name.
- `setWatchGroups({ siteId, pageId, ids }): Promise<GroupLookup[]>` deduplicates the ids. It refuses more than `MAX_PAGE_WATCH_GROUPS`, which is 50, with `CustomError('pageWatchGroupsTooMany', …)`. It checks the ids through `WIKI.models.groups.lookup({ ids, limit })`, which never returns the guests group. A missing id throws `CustomError('pageWatchGroupInvalid', 'Every watcher group must be a group other than Guests.')`. `CustomError` answers 400. In one transaction it locks the page row with `FOR UPDATE`, deletes the rows of the page, and inserts the new ones, as `pageOwners.setOwnership` does. It returns `watchGroupsOf(pageId)`.

The model says nothing about the caller. The route decides who calls it.

### D6. Permissions

- `write:pages` is a page rule permission. The route handler checks it with `mayOnPage(req, 'write:pages', page)`. The route declares no `config.permissions` and says so in a `No route-level permissions:` comment.
- `list:groups`, `read:groups`, `write:groups`, `manage:groups`, and `manage:system` are global permissions. The handler checks `actor.permissions` against `LIST_GROUPS_PERMISSIONS` from `backend/models/groups.ts`, only when the new list adds a group that the page does not list yet. Removing groups, or sending the current list back, needs none of them. This mirrors the ownership route.
- Why `write:pages`: it is the permission that already gates page ownership and lifecycle rules in the same panel. The properties panel opens for that editor and saves with that editor's page save. `manage:pages` gates moves, deletes, and folder work, and does not imply `write:pages`. Choosing it splits one panel across two permissions. No new permission is proposed. The user confirms the choice (see Open Questions).
- The fan-out keeps `access: 'read:pages'` on `watchedPage` and `access: 'read:comments'` on `watchedPageComment`. Each member is checked against the pooled rules of their own groups, memoized per group set by `RunContext.mayAccess`. Being in the watching group grants nothing.

### D7. The route

`PUT /sites/:siteId/pages/:pageId/watch-groups` joins `backend/api/watching.ts`, next to the personal watch routes.

- `config.scope: 'pages'`, the scope of the ownership route, because the call changes something about a page for other people. The personal routes keep `scope: 'profile'`.
- Params: the existing `pageParams` of the file. Body: `{ ids: string[] }`, `format: 'uuid'`, `maxItems: 50`, required.
- Response 200: `{ ok: boolean, watchGroups: GroupLookup[] }`. It reuses the `GroupLookup` schema in `backend/api/schemas/group.ts`. No new shared schema is needed.
- Order of checks: `actorFrom(req)` or 401 through `userRequired(req, 'Changing the groups that watch a page')`. Then `getPage` with `unpublished: unpublishedFor(req)` and `mayOnPage(req, 'read:pages', page)`, or 404. Then `write:pages`, or 403 "You are not allowed to edit this page.". Then `WIKI.models.pages.assertEditable(page)`, or 423 `pageEditLocked`, as the ownership route does. Then the lookup rung for an added group, or 403 "You are not allowed to look up groups, so you cannot add them as watchers.".
- After success: `audit(req, 'page', 'updatePageWatchGroups', { pageId, siteId, locale, path, count })`. The action joins the `page` list of `AUDIT_ACTIONS` in `backend/models/auditLog.ts`. The meta holds no group names and no members, per `.claude/rules/audit-log.md`.
- The route returns no module configuration, so no prop masking applies.

### D8. The page payload

`GET` of a single page in `backend/api/pages.ts` adds `mayWrite ? WIKI.models.pageWatching.watchGroupsOf(page.id) : null` to the existing `Promise.all`, next to `ownership`. The field `watchGroups` joins the page response schema in `backend/api/schemas/page.ts` as `anyOf: [null, array of GroupLookup]`, with a description that names `write:pages`. Group names are not every reader's to see, which is why the field is null for other readers, as `ownership` is.

### D9. The frontend

- `frontend/src/stores/page.js`: a state field `watchGroups: null`, reset where `ownership` is reset, and a new action `pageSaveWatchGroups(groups)`. The action calls `API_CLIENT.put(\`sites/${siteStore.id}/pages/${this.id}/watch-groups\`, { json: { ids } })`, patches `watchGroups` from the answer with an object `$patch`, and calls `editorStore.settleChanges()`. `watchGroups` is not in `SAVED_PAGE_FIELDS`, so `isSavedFieldMutation` does not count that patch as a pending edit in the panel. `pageSave` takes `editorStore.watchGroups` with the owners and the lifecycle rules. It sends the page fields only when something about the page itself changed, and puts the unsent part back as pending on failure.
- `frontend/src/stores/editor.js`: a state field `watchGroups: null`, the pending edit. `hasPendingChanges` counts it. `hasPendingPageChanges` does not, so a change of group watchers alone records no version.
- `frontend/src/components/PagePropertiesDialog.vue`: a new section `refCardWatchGroups` after `refCardVisibility` and before the page id footer. Visibility carries `alt-card`, so the new section carries none, and the alternation of the other sections stays as it is. It shows when `editorStore.mode !== 'suggest' && pageStore.watchGroups !== null`. It uses `w-select` with `multiple`, `use-input`, `use-chips`, and `remote-filter`, fed by the existing `lookupGroups` and `state.groupOptions`. Without a group lookup permission it shows `w-chip` items with a remove control and the `editor.props.watchGroupsNoList` hint. A `quickaccess` entry with icon `la:bell` joins the list. The handlers are named functions, never two statements in one attribute.
- The section reuses existing classes and components only. It adds no dark-mode rule, so no `.w-dark-surface` twin is needed.

### D10. Locale keys

In `backend/locales/en.json`, next to their neighbors:

| Key | English string |
| --- | --- |
| `editor.props.watchGroups` | Group Watchers |
| `editor.props.watchGroupsHint` | Every member of these groups is told about changes and comments on this page, by their own notification settings. |
| `editor.props.watchGroupsPick` | Watching Groups |
| `editor.props.watchGroupsNoList` | You are not allowed to look up groups, so you cannot add one here. You can still remove a group. |
| `admin.audit.actions.updatePageWatchGroups` | Changed the groups watching a page |

The picker reuses `editor.props.ownersNoResults` ("No matches") for an empty search.

### D11. Documentation

`.claude/rules/notifications.md` gets one bullet: `watchersOf` covers group watchers through `pageWatchGroups`, and the deletion capture uses the same union. `dev/specs/notifications.md` sections 4.2, 6.3, and 7.3 name group watchers as candidates. `.claude/rules/notifications.md` adds `backend/models/pageWatching.ts` and `backend/api/watching.ts` to its `paths:` list, because a change there now needs the rule.

### Files by workspace

- backend: `db/schema.ts`, the new migration directory under `db/migrations/`, `models/pageWatching.ts`, `notifications/recipients.ts`, `models/notifications.ts`, `api/watching.ts`, `api/pages.ts`, `api/schemas/page.ts`, `models/auditLog.ts`, `locales/en.json`.
- frontend: `src/stores/page.js`, `src/stores/editor.js`, `src/components/PagePropertiesDialog.vue`.
- docs: `.claude/rules/notifications.md`, `dev/specs/notifications.md`.

## Risks / Trade-offs

- [A large group, such as Users, watches a busy page and floods many inboxes] → Coalescing keeps one unread entry per person per page. The email delay groups a burst into one mail. The access check and each person's preferences still apply. The picker hint says that every member is told.
- [A member cannot stop one group-watched page alone] → The member turns the category off in Profile, Notifications, or asks to leave the group. A per-member opt-out is a non-goal for now.
- [The bell shows "Watch Page" to a member who already hears through the group] → Accepted. The bell reports the personal watch, and a personal watch beside a group watch still yields one entry.
- [The fan-out query joins `userGroups` per batch] → `userGroups_groupId_idx` and the new unique index cover the join. A page lists at most 50 groups.
- [A group watch reaches members of a page that is not live] → The fan-out today checks only `read:pages` for every watcher. A group widens that audience. See Open Questions.
- [Uncommitted work from changes 01 to 03 sits in four of the touched files] → The tasks edit around it and run the full check set.

## Migration Plan

1. The user runs the legacy query and decides (task 1.1).
2. The schema edit and `npm run db-generate -- --name=page-watch-groups` create the migration. The migration runs on the next boot.
3. After the cutover, an editor sets the group watchers again by hand on each page that the legacy query lists.
4. Rollback is `git revert`. The empty table stays and nothing reads it.

## Open Questions

- Legacy group watch rows: the user runs the query. Default applied: none. Nothing is built before the answer.
- Port or shared mailbox: default applied, the port, if rows exist.
- `write:pages` as the assigning permission: default applied, `write:pages`. The alternative is `manage:pages`.
- Group members hear about comments too: default applied, yes, through `watchersOf` for both categories.
- Pages locked against edits: default applied, the route refuses a change with 423, as the ownership and lifecycle rules routes do since upstream 3.3.1. Assumption: group watchers are a property kept beside the page, like its owners. Personal watching stays open on a locked page.
- Pages that are not live: default applied, no extra check, the same rule as for personal watchers. If the user wants the stricter rule, it is a separate change to the fan-out for all watchers.
