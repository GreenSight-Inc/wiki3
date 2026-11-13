# Proposal

**Dropped on 2026-11-13.** The gate query on the legacy wiki returned 9 watch rows on 7 pages and 0 group watch rows. No group watches a page today, so the user dropped the change. Nothing of it is built. The 9 personal watches do not travel with the import, so each watcher sets the watch again after the cutover.

## Why

In the Wiki.js 2 fork, a page manager can name a whole group as watchers of a page. Wiki.js 3 only lets each person watch a page for themselves. A team that relies on group watchers loses them at the migration, because the export does not carry the fork's `pageWatchers` table.

This change is conditional. It goes ahead only if the legacy wiki holds group watch rows today. The user runs a read-only query on the legacy wiki first. If the query finds no group watch rows, the change is dropped. A zero-code alternative also exists: a shared mailbox account watches the page for the team.

## What Changes

- A page gets a list of group watchers. Every current member of a listed group counts as a watcher of the page.
- Group watchers receive the same notifications as personal watchers: the watched-page notification and the watched-page comment notification.
- Membership is read when the notification goes out, not when the group is added. A person who joins the group later is told. A person who leaves is not.
- Each member still passes the access check, the account check, and their own notification preferences. A member who cannot read the page receives nothing.
- A person who is both a group member and a personal watcher receives one entry, not two. The editor who made the change receives nothing.
- A deleted page captures its group watchers' members in the deletion event, as it does for personal watchers today.
- A new route sets the group watchers of a page. The page payload returns them to a person who holds `write:pages` on the page.
- The page properties panel gets a Group Watchers section with a group picker.
- A new audit action records each change of the group watchers.
- A new table holds the group watch rows, with a Drizzle migration.

## Capabilities

### New Capabilities

- `page-group-watching`: groups as watchers of a page, who assigns and removes them, and how their members are notified.

### Modified Capabilities

None. `openspec/specs/` holds no capability yet.

## Non-goals

- No per-page digest delay. The instance-wide email delay stays the only delay.
- No change-stats line in the notification mail.
- No assignment of individual users as watchers by another person. Each person still watches a page only for themselves.
- No per-page opt-out for one member of a watching group. A member controls the category in Profile, Notifications, or asks to leave the group.
- No group watches in the personal Watching list in the inbox, and no change to the bell on the page header. Both keep showing the personal watch only.
- No import of the fork's `pageWatchers` rows. An editor sets the group watchers again by hand after the migration.
- No new notification category, and no new global permission.

## Impact

- Workspaces: backend and frontend. Not blocks.
- Rule files: `.claude/rules/notifications.md` covers the recipients and the fan-out. `.claude/rules/audit-log.md` covers the new audit action. The design is `dev/specs/notifications.md`. Both the rule file and the design get a short note on group watchers (working rule D).
- Stored shape: the change adds a table `pageWatchGroups`. The table `pageWatching` is committed, so the change leaves it alone and adds a new table instead. The migration is `page-watch-groups`. It creates the table and its indexes and converts no rows.
- Permissions: `write:pages` on the page, a page rule permission, to read and change the group watchers. To add a new group to the list, the caller also holds a global permission: `list:groups`, `read:groups`, `write:groups`, or `manage:groups`, or `manage:system`. Removing a group needs no global permission. The fan-out checks `read:pages` for the watched-page notification and `read:comments` for the comment notification, per member, as today.
- API: a new route `PUT /sites/:siteId/pages/:pageId/watch-groups`. A new field `watchGroups` on the page payload.
- Locale keys in `backend/locales/en.json`: `editor.props.watchGroups`, `editor.props.watchGroupsHint`, `editor.props.watchGroupsPick`, `editor.props.watchGroupsNoList`, and `admin.audit.actions.updatePageWatchGroups`.
- New dependencies: none. The frontend reuses the existing group lookup and shared components.
- Verification tier: the check set alone, per working rule C. The new section reuses the picker and the classes of the Ownership section, so no new stylesheet meets new markup. Assumption: the read of the generated SQL and the type check cover the fan-out query well enough. The user confirms this or asks for a throwaway instance.
- Uncommitted work from changes 01 to 03 sits in `backend/api/pages.ts`, `backend/api/schemas/page.ts`, `backend/locales/en.json`, and `frontend/src/stores/page.js`. This change edits those files too and keeps that work intact.

## Open Questions

- Answered on 2026-11-13: no. `watch_rows` 9, `watched_pages` 7, `group_watch_rows` 0. The change is dropped. The original question follows. Does the legacy wiki hold group watch rows? The user runs the `pageWatchers` query with `group_watch_rows` from the plan section "User-run queries before a decision on B3 and B5". Zero rows drops the change. Task 1.1 is this gate.
- If the change goes ahead, does a shared mailbox account cover the need instead? The user decides between the port and the zero-code alternative.
- Is `write:pages` the right page permission to assign group watchers? It matches page ownership and lifecycle rules. The fork let page managers do it, and Wiki.js 3 has no manager list. `manage:pages` is the other candidate. No new permission is proposed.
- Today the fan-out checks only `read:pages` for a watcher, even on a page that is not live. A group watch widens that audience to every member with `read:pages`. Is that acceptable, or does the fan-out also apply the rule that only editors see a page that is not live?
