# Tasks

## 1. Decision gate

- [ ] 1.1 user-run: on the legacy wiki host, against the wiki database, run the read-only query `SELECT count(*) AS watch_rows, count(DISTINCT "pageId") AS watched_pages, count("groupId") AS group_watch_rows FROM "pageWatchers";` and report the three numbers. If `group_watch_rows` is 0, stop here and drop this change. If it is above 0, also run `SELECT p.path, g.name FROM "pageWatchers" w JOIN pages p ON p.id = w."pageId" JOIN groups g ON g.id = w."groupId";` and keep the output under `tmp/` in greensight-wiki as the list to set again after the cutover.
- [ ] 1.2 The user decides between this port and the zero-code alternative of a shared mailbox account that watches the page. The user also confirms the defaults in design.md, section Open Questions. Verify: the answers are written into design.md, section Open Questions, before task 2.1 starts.

## 2. Stored shape and migration

- [ ] 2.1 In `backend/db/schema.ts`, add the table `pageWatchGroups` after `pageWatching`, as design.md D1 describes, with a doc comment. Verify: `cd backend && npm run typecheck` exits 0.
- [ ] 2.2 Run `cd backend && npm run db-generate -- --name=page-watch-groups`. Verify: `git status --porcelain -- backend/db/migrations/` prints one new directory that ends in `_page-watch-groups`. Its timestamp sorts after the newest existing directory, `20261109094533_group-rule-paths`.
- [ ] 2.3 Read the generated `migration.sql`. Verify: it holds one `CREATE TABLE "pageWatchGroups"`, the unique index `pageWatchGroups_page_group_idx`, the index `pageWatchGroups_groupId_idx`, and three foreign keys, with `ON DELETE CASCADE` on `pageId` and `groupId`. It holds no statement on `pageWatching` or any other table.

## 3. Recipients and the deletion capture

- [ ] 3.1 In `backend/notifications/recipients.ts`, change `watchersOf` to the union query of design.md D3, with `keyset` and the `::uuid` cursor cast that `ownersOf` uses. Update its doc comment to name group watchers. Verify: `cd backend && npm run typecheck` exits 0.
- [ ] 3.2 In `backend/models/notifications.ts`, change the `recipients` expression of `emit` to the union of design.md D4. Update the `watchersOf` parameter comment. Verify: `cd backend && npm run typecheck` exits 0 and `grep -n 'pageWatchGroups' backend/models/notifications.ts` prints the new line.
- [ ] 3.3 Update `.claude/rules/notifications.md` and `dev/specs/notifications.md` as design.md D11 says. Verify: `grep -n 'pageWatchGroups' .claude/rules/notifications.md dev/specs/notifications.md` prints at least one line per file.

## 4. Model, route, payload, and audit

- [ ] 4.1 In `backend/models/pageWatching.ts`, add `MAX_PAGE_WATCH_GROUPS`, `watchGroupsOf`, and `setWatchGroups` as design.md D5 describes. Verify: `cd backend && npm run typecheck` exits 0.
- [ ] 4.2 In `backend/models/auditLog.ts`, add `updatePageWatchGroups` to the `page` list after `unwatchPage`. In `backend/locales/en.json`, add `admin.audit.actions.updatePageWatchGroups` next to `admin.audit.actions.updatePageOwnership`. Verify: `cd backend && npm run typecheck` exits 0.
- [ ] 4.3 In `backend/api/watching.ts`, add `PUT /sites/:siteId/pages/:pageId/watch-groups` as design.md D7 describes. Call `WIKI.models.pages.assertEditable(page)` after the `write:pages` check, as `backend/api/pageOwners.ts` does. Give it a summary, tags `['Pages']`, a description that names the permissions, the body schema, and the 200 schema with `GroupLookup#`. Verify: `cd backend && npm run typecheck` exits 0 and `cd backend && npx oxlint` exits 0.
- [ ] 4.4 In `backend/api/pages.ts`, add `watchGroups` to the single-page answer as design.md D8 describes. In `backend/api/schemas/page.ts`, add the `watchGroups` property next to `ownership`. Keep the uncommitted `printQrCode` work in both files as it is. Verify: `git diff backend/api/pages.ts backend/api/schemas/page.ts` still shows the `printQrCode` lines, and `cd backend && npm run typecheck` exits 0.

## 5. Page properties panel

- [ ] 5.1 In `frontend/src/stores/editor.js`, add `watchGroups: null` and count it in `hasPendingChanges` only, as design.md D9 says. Reset it where `ownership` is reset. Verify: `cd frontend && npx oxlint` exits 0.
- [ ] 5.2 In `frontend/src/stores/page.js`, add `watchGroups: null` beside `ownership` in the state and in each reset, add `pageSaveWatchGroups` with an object `$patch`, and extend `pageSave` as design.md D9 says. Keep the uncommitted `printQrCode` lines. Verify: `cd frontend && npx oxlint` exits 0.
- [ ] 5.3 In `frontend/src/components/PagePropertiesDialog.vue`, add the section `refCardWatchGroups` and its `quickaccess` entry as design.md D9 says. Add the four `editor.props.watchGroups*` keys of design.md D10 to `backend/locales/en.json` next to `editor.props.visibility`. Verify: `cd frontend && npm run build` exits 0.

## 6. Local check set

- [ ] 6.1 ts-typecheck: `cd backend && npm run typecheck`. Expected: exit 0 and no error line after the tsc banner.
- [ ] 6.2 oxlint-backend: `cd backend && npx oxlint`. Expected: exit 0.
- [ ] 6.3 oxlint-frontend: `cd frontend && npx oxlint`. Expected: exit 0.
- [ ] 6.4 oxfmt-check: from the root, `backend/node_modules/.bin/oxfmt --check $(git diff --name-only HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expected: exit 0. The baseline already names `frontend/src/pages/AdminSystem.vue` from change 01 or 02. Report that file apart and fix only files this change touched.
- [ ] 6.5 frontend-build: `cd frontend && npm run build`. Expected: exit 0.
- [ ] 6.6 blocks-build: skipped. The change touches nothing under `blocks/`.
- [ ] 6.7 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, then `git status --porcelain -- backend/db/migrations/` prints the new `_page-watch-groups` directory. Expected: the directory name does not end in `_scarlett`.
- [ ] 6.8 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expected: exit 0 and no output.
- [ ] 6.9 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expected: no output and exit 1.
- [ ] 6.10 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expected: no output.
- [ ] 6.11 openspec-validate: `openspec validate --all`. Expected: exit 0.

## 7. Delivery

- [ ] 7.1 The user reviews the diff and commits it. Assumption: the check set alone is enough under working rule C, because the section reuses the Ownership picker. If the user asks for a throwaway instance, add the boot, check, and teardown steps of `.claude/skills/throwaway-instance/` here before 7.2.
- [ ] 7.2 user-run: `git push` of the branch `feat/greensight-visual`. Expected: the remote accepts the push.
- [ ] 7.3 user-run: after the cutover, on the deployed Wiki.js 3, an editor sets the group watchers of each page in the list from task 1.1 through the page properties. Expected: each page shows its groups under Group Watchers.
