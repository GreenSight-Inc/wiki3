# Tasks

Run every command from the repository root of the working copy unless the command says `cd`. The working tree holds uncommitted work of changes 01 to 03 in `backend/api/pages.ts`, `backend/api/schemas/page.ts`, `backend/locales/en.json`, `frontend/src/components/PageHeader.vue`, and `frontend/src/stores/page.js`. No code of this change exists yet. Every task adds to those files and keeps that work intact.

Each group from 2 to 7 ends with the full local check set. The work can stop after any group and leave a consistent tree. A check whose tool is missing is advisory. A check whose target does not exist is skipped. Neither counts as passed.

Assumption: change 06 is not merged when this change starts. If it is, rebase on it first, and generate the migration of this change after the migration of change 06.

## 1. Gate and decisions

- [ ] 1.1 user-run: on the legacy wiki host, against the wiki database, run the read-only queries `SELECT "approvalMode", count(*) FROM pages GROUP BY "approvalMode"`, `SELECT count(*) AS pages_with_approvers, count(DISTINCT "pageId") FROM "pageApprovers"`, and `SELECT count(*) AS approvals, max("approvedAt") AS last_approval FROM "pageApprovals"`. Expect one row per mode, and one count row from each table. Paste the output back.
- [ ] 1.2 Read the output of task 1.1. If every page has `approvalMode` `off` and `approvals` is 0, stop here. Report that the change is dropped, and run no later task. Otherwise record the counts in proposal.md section Why and continue.
- [ ] 1.3 Ask the user the open questions in design.md section Open Questions. Also ask whether the legacy sign-off history needs a CSV export before cutover. Fold each answer into proposal.md, the spec, design.md, and this file with the openspec-update-change skill. Verify with `openspec validate 07-add-revision-sign-off`, which exits 0.

## 2. Stored shape and model core

- [ ] 2.1 In `backend/db/schema.ts`, add `signOffMode: varchar({ length: 16 }).notNull().default('off')` to `pages`, after `lifecycleBanner`, with a doc comment that says it is not page content. Add the tables `pageSignOffApprovers` and `pageSignOffs` after `pageOwners`, with the columns, the check, and the indexes in design.md decision 1. Verify with `grep -n "signOffMode\|pageSignOffApprovers\|pageSignOffs" backend/db/schema.ts`, which prints the column and both table names.
- [ ] 2.2 Generate the migration: `cd backend && npm run db-generate -- --name=page-sign-off`. Expect a new directory under `backend/db/migrations/` whose name ends in `_page-sign-off`.
- [ ] 2.3 Read the generated SQL with `cat backend/db/migrations/*_page-sign-off/migration.sql`. Expect one `ALTER TABLE "pages" ADD COLUMN "signOffMode" varchar(16) DEFAULT 'off' NOT NULL`, two `CREATE TABLE` statements, the check constraint, the foreign keys with `ON DELETE cascade`, no foreign key on `versionId`, and no statement on any other table. Never edit the generated file by hand.
- [ ] 2.4 In `backend/models/pageHistory.ts`, add `signOffMode` to `EXCLUDED_FROM_META` and to `NOT_REPORTED_AS_CHANGED`, with a comment beside the lifecycle columns. Verify with `grep -n "'signOffMode'" backend/models/pageHistory.ts`, which prints two lines.
- [ ] 2.5 Add `isLiveNow(page)` to `backend/helpers/publishing.ts`, as design.md decision 3 says, with `Temporal.Now.instant()` and the same inclusive and exclusive ends as `liveCondition`. Verify with task 2.13.
- [ ] 2.6 Create `backend/models/pageSignOff.ts` with `SIGN_OFF_MODES`, `SIGN_OFF_VERDICTS`, `MAX_SIGN_OFF_APPROVERS`, `settingsOf`, `setSettings`, `currentApproverIds`, and `statusOf`, as design.md decisions 2, 5, 6, and 11 say. Use `es-toolkit` subpath imports only. Register it as `pageSignOff` in `backend/models/index.ts`. Verify with `grep -n "pageSignOff" backend/models/index.ts`, which prints the import and the entry.
- [ ] 2.7 Add `recordVerdict` to the model. It upserts on `(versionId, userId)` and checks that the version is current. The notification emit follows in group 4. Verify with task 2.13.
- [ ] 2.8 Map `signOffMode` onto the page object in the row mapper of `backend/models/pages.ts` next to `lifecycleBanner`, and add it to the page type. Verify with `grep -n "signOffMode" backend/models/pages.ts`, which prints the type line and the mapper line.
- [ ] 2.9 Create `.claude/rules/page-sign-off.md` with a `paths:` list for `backend/models/pageSignOff.ts`, `backend/api/pageSignOff.ts`, `backend/api/schemas/pageSignOff.ts`, `backend/notifications/categories/signOff*.ts`, and `frontend/src/components/PageSignOffDialog.vue`. State the stored shape, the current-version rule, the purge effect, and the exclusion from version meta. Verify with `head -10 .claude/rules/page-sign-off.md`, which shows the front matter.
- [ ] 2.10 Add `page-sign-off` to the rule list in the root `CLAUDE.md`, section Where the rest is documented. Verify with `grep -n "page-sign-off" CLAUDE.md`, which prints one line.
- [ ] 2.11 Add a line to `.claude/rules/page-lifecycle.md` that `signOffMode` sits in `EXCLUDED_FROM_META` beside the lifecycle columns. Verify with `grep -n signOffMode .claude/rules/page-lifecycle.md`, which prints one line.
- [ ] 2.12 Confirm that no file under `backend/` names a sign-off as an approval. Run `grep -rn "approv" backend/models/pageSignOff.ts`. Expect only the word `approve` as a mode value and `approver` for a person.
- [ ] 2.13 Review `isLiveNow`, `statusOf`, and `recordVerdict` against the spec requirements Sign-off belongs to one version, Current approvers, and Approved state. Read each branch for draft, scheduled inside and outside the window, an empty approver set, and a null current version. Record any gap as a fix in this group.

- [ ] 2.14 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 2.15 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 2.16 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 2.17 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 2.18 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 2.19 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 2.20 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 2.21 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 2.22 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 2.23 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 2.24 openspec-validate: `openspec validate --all`. Expect exit 0.

## 3. Routes, audit, page payload, and the version hook

- [ ] 3.1 Add `updatePageSignOff`, `signOffPage`, and `requestSignOffChanges` to the `page` list of `AUDIT_ACTIONS` in `backend/models/auditLog.ts`. Add their `admin.audit.actions.*` strings from design.md section Locale keys to `backend/locales/en.json`. Verify with `grep -n "SignOff\|signOffPage" backend/models/auditLog.ts backend/locales/en.json`, which prints three lines in each file.
- [ ] 3.2 Create `backend/api/schemas/pageSignOff.ts` with `PageSignOffStatus`, `PageSignOffApprover`, and `PageSignOffEntry`, and register it in `backend/api/index.ts` before the routes. Verify with `grep -n "pageSignOff" backend/api/index.ts`, which prints the schema line.
- [ ] 3.3 Create `backend/api/pageSignOff.ts` with the three routes in design.md decision 10. Each has `summary`, `description`, `tags: ['Pages']`, response schemas, `config.scope: 'pages'`, and a comment that opens with "No route-level `permissions`". Register it in `backend/api/index.ts` after `pageOwners.ts`. Verify with `grep -n "sign-off" backend/api/pageSignOff.ts`, which prints three route paths.
- [ ] 3.4 In the PUT handler, check `manage:pages` with `mayOnPage`. Check the list rungs against the current list as `api/pageOwners.ts` does. Check the approver rules and the limit of 50. Call `WIKI.models.pages.assertEditable(page)` after the permission check, as `api/pageOwners.ts` does. Answer 401, 403, 404, 400, and 423 as the spec says. Verify with task 3.8.
- [ ] 3.5 In the verdict handler, read the page with `unpublishedFor(req)`. Answer 404 without `read:pages` and 403 for a person who is not a current approver. Answer 409 for mode `off`, a draft, a stale version, or no current version. Answer 400 for a missing comment. Do not call `assertEditable`, as design.md decision 4 says. Verify with task 3.8.
- [ ] 3.6 Add `signOff` to the page payload in `backend/api/pages.ts` next to `ownership`, null for mode `off`. Add the field to the `Page` schema in `backend/api/schemas/page.ts`. Keep the uncommitted `printQrCode` lines of change 03. Verify with `git diff HEAD -- backend/api/pages.ts | grep -c printQrCode`, which prints 4, the count of change 03 on 2026-11-10.
- [ ] 3.7 Add `versionRecorded` to the model and call it after `record()` in `updatePage` and `movePage` in `backend/models/pages.ts`. Leave the emit for group 4 and return early for now. Verify with `grep -n "pageSignOff.versionRecorded" backend/models/pages.ts`, which prints two lines.
- [ ] 3.8 Review the three handlers against six spec requirements. They are Setting the mode and the approvers, Naming approvers needs the lookup permissions, Valid approvers, Recording a verdict, Verdict refusals, and Reading the sign-off status. Confirm that no response carries an email and no audit entry carries a comment. Record each gap as a fix in this group.
- [ ] 3.9 Extend `.claude/rules/page-sign-off.md` with the permission table of design.md decision 4, the 409 rule for a stale version, and the 423 rule for a page locked against edits. Verify with `grep -n "manage:pages" .claude/rules/page-sign-off.md`, which prints at least one line.
- [ ] 3.10 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 3.11 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 3.12 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 3.13 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 3.14 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 3.15 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 3.16 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 3.17 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 3.18 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 3.19 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 3.20 openspec-validate: `openspec validate --all`. Expect exit 0.

## 4. Notifications

- [ ] 4.1 Add `page:signOffRequest` and `page:signOffChanges` to `NOTIFICATION_EVENT_KINDS`, and `versionId` and `versionAuthorId` to `NotificationEventData`, in `backend/notifications/types.ts`. Verify with `grep -n "signOff" backend/notifications/types.ts`, which prints the two kinds.
- [ ] 4.2 Add `approversOf` and `versionAuthorAndOwnersOf` to `backend/notifications/recipients.ts`, with keyset paging sorted by id as `ownersOf` does. Verify with task 4.7.
- [ ] 4.3 Create `backend/notifications/categories/signOffRequested.ts` and `signOffChangesRequested.ts` with the values in design.md decision 9, and add both keys to `NOTIFICATION_CATEGORIES` in `backend/notifications/index.ts`. Verify with `grep -n "signOff" backend/notifications/index.ts`, which prints two imports and two keys.
- [ ] 4.4 Add the `notifications.categories.*`, `notifications.messages.*`, and `mail.notification.actions.*` strings of design.md section Locale keys to `backend/locales/en.json`, next to the `reviewRequested` keys. Verify with `grep -c "signOffRequested\|signOffChangesRequested" backend/locales/en.json`, which prints 8.
- [ ] 4.5 Make `versionRecorded` emit `page:signOffRequest` when the mode is not `off`, the version id is set, and `isLiveNow(page)` is true. Make `recordVerdict` emit `page:signOffChanges` for a `changesRequested` verdict, with the comment start as `excerpt`. Verify with task 4.7.
- [ ] 4.6 Add a line for the two categories to `.claude/rules/notifications.md` and to the notifications section of `.claude/rules/page-sign-off.md`. Verify with `grep -n "signOffRequested" .claude/rules/notifications.md`, which prints one line.
- [ ] 4.7 Read both recipient queries and the two emits against the spec requirements Sign-off request notification, Changes requested notification, and Notification preferences. Confirm the actor is left to the fan-out, the access is `read:pages`, and a draft emits nothing. Record each gap as a fix in this group.
- [ ] 4.8 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 4.9 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 4.10 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 4.11 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 4.12 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 4.13 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 4.14 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 4.15 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 4.16 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 4.17 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 4.18 openspec-validate: `openspec validate --all`. Expect exit 0.

## 5. Properties panel and stores

- [ ] 5.1 Add `signOff` and `signOffSettings` state and the actions `pageLoadSignOff`, `pageSaveSignOff`, and `pageRecordSignOff` to `frontend/src/stores/page.js`, through `API_CLIENT`, as design.md decision 12 says. Send a pending sign-off edit from `pageSave` after the page save, beside `ownership`. Write `signOff` and `signOffSettings` with `$patch` objects only, so `isSavedFieldMutation` counts no status load as a pending edit. Keep the uncommitted lines of changes 01 to 03. Verify with `grep -n "SignOff" frontend/src/stores/page.js`, which prints the three actions.
- [ ] 5.2 Add `signOff: null` to `frontend/src/stores/editor.js`, count it in `hasPendingChanges`, and reset it with `ownership`. Verify with `grep -n "signOff" frontend/src/stores/editor.js`, which prints at least three lines.
- [ ] 5.3 Add the Sign-off section to `frontend/src/components/PagePropertiesDialog.vue` after Ownership, with `w-btn-toggle` and two `w-select` pickers that reuse `lookupUsers` and `lookupGroups`. Gate it on the existing `mayManagePage` computed, show read-only chips for `write:pages`, and hide it in suggest mode. Use named handlers, never two statements in one attribute. Verify with `grep -n "refCardSignOff" frontend/src/components/PagePropertiesDialog.vue`, which prints the section and its table-of-contents entry.
- [ ] 5.4 Add the `editor.props.signOff*` strings of design.md section Locale keys to `backend/locales/en.json`, next to `editor.props.ownership`. Verify with `grep -c '"editor.props.signOff' backend/locales/en.json`, which prints 11.
- [ ] 5.5 Review the section against the spec requirement Properties panel section. Confirm that a writer without `manage:pages` gets no control, and that a mode change records no version. Record each gap as a fix in this group.
- [ ] 5.6 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 5.7 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 5.8 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 5.9 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 5.10 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 5.11 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 5.12 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 5.13 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 5.14 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 5.15 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 5.16 openspec-validate: `openspec validate --all`. Expect exit 0.

## 6. Header badge and sign-off dialog

- [ ] 6.1 Create `frontend/src/components/PageSignOffDialog.vue` with `w-dialog`, `w-card`, `w-list`, `w-item`, `w-btn`, and `w-input`, as design.md decision 12 says. On a 409 answer, show `common.page.signOff.stale` and reload the status. Verify with task 6.5.
- [ ] 6.2 Add the sign-off button with a `w-chip` to `frontend/src/components/PageHeader.vue` beside the pending suggestions button. Hide it while `editorStore.isActive` is true and while `pageStore.signOff` is null. Keep the uncommitted print lines of change 03. Verify with `git diff HEAD -- frontend/src/components/PageHeader.vue | grep -c page-header-print`, which prints 7, the count of change 03 on 2026-11-10.
- [ ] 6.3 Add the `common.page.signOff.*` strings of design.md section Locale keys to `backend/locales/en.json`, next to the other `common.page.*` keys. Verify with `grep -c '"common.page.signOff' backend/locales/en.json`, which prints 14.
- [ ] 6.4 Use palette colors only, as design.md decision 12 says. If a dark-mode rule turns out to be needed, write it under `.body--dark &` with its `.w-dark-surface &` twin. Verify with `grep -n "body--dark" frontend/src/components/PageSignOffDialog.vue`, which prints nothing or a rule with its twin.
- [ ] 6.5 Review the badge and the dialog against the spec requirement Header badge. Confirm the three states, the hidden state for mode `off`, and that a reader without the list sees counts only. Record each gap as a fix in this group.
- [ ] 6.6 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 6.7 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 6.8 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 6.9 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 6.10 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 6.11 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 6.12 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 6.13 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 6.14 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 6.15 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 6.16 openspec-validate: `openspec validate --all`. Expect exit 0.

## 7. Throwaway instance check

The backend boots only on Node.js 26, so this group runs in the dev container. It never touches the dev instance or its database. Follow the throwaway-instance skill.

- [ ] 7.1 Create the scratch database `wikitest` with `pg` from `backend/node_modules`, with the credentials in `config.yml`. Copy `config.yml` to `config.test.yml` with `port: 3010`, `db.db: wikitest`, and `dataPath: ./data-test`. Verify with `grep -n "port: 3010\|db: wikitest\|dataPath: ./data-test" config.test.yml`, which prints three lines.
- [ ] 7.2 Boot with `CONFIG_FILE=config.test.yml node --no-experimental-webstorage backend` from the repository root, in the background. Expect a listening line on port 3010 within about 25 seconds, and a log line that the `page-sign-off` migration ran.
- [ ] 7.3 Script the API from a scratch directory. Log in as the seeded admin and change the password. Create two users and a group that holds the second user. Create and publish a page. Set mode `approve` with the first user and the group. Expect `GET …/sign-off` to report `required: 2` and `isApproved: false`.
- [ ] 7.4 Sign the current version as both approvers. Expect `isApproved: true`. Save the page again as the admin. Expect `signed: 0` and `isApproved: false`, and expect `GET …/sign-off?versionId=<old id>` to list two `signed` entries.
- [ ] 7.5 Send `signed` with the old version id. Expect 409. Send `changesRequested` without a comment. Expect 400. Send a verdict as a user who is not an approver. Expect 403. Expect a `signOffRequested` entry in the inbox of each approver after the second save, and a `signOffChangesRequested` entry for the admin after a changes verdict. Lock the page with `PUT …/edit-lock`. Expect 423 from `PUT …/sign-off` and 200 from a verdict on the current version.
- [ ] 7.6 Take screenshots with `puppeteer-core` installed in a scratch directory, never in a workspace. Capture the page header with the Approved badge and with pending progress, in light mode and in dark mode. Also capture the Sign-off section of the properties panel. Expect a readable badge on both backgrounds and no layout break.
- [ ] 7.7 Tear down. Kill the PID of the throwaway backend, matched on `CONFIG_FILE` in its environment. Drop the database `wikitest`. Delete `config.test.yml` and `data-test/`. Verify with `git status --porcelain -- config.test.yml data-test`, which prints nothing.
- [ ] 7.8 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [ ] 7.9 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [ ] 7.10 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [ ] 7.11 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. A failure in `frontend/src/pages/AdminSystem.vue` or another file of changes 01 to 03 belongs to that change. Report it and leave it.
- [ ] 7.12 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [ ] 7.13 blocks-build: skipped, because the change does not touch `blocks/`.
- [ ] 7.14 schema-migration: `git diff --name-only HEAD -- backend/db/schema.ts` prints the file, so the check applies. Run `git status --porcelain -- backend/db/migrations/`. Expect one new directory whose name ends in `_page-sign-off` and not in `_scarlett`.
- [ ] 7.15 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [ ] 7.16 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [ ] 7.17 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [ ] 7.18 openspec-validate: `openspec validate --all`. Expect exit 0.

## 8. Hand-off

- [ ] 8.1 Report the result of each check in groups 2 to 7 by id, with skipped and advisory checks named as such. Confirm that `git status --short` lists only the files in design.md decision 13, the work of changes 01 to 03, and the OpenSpec files.
- [ ] 8.2 user-run: `git push origin feat/greensight-visual` after the user commits. The remote `origin` is the fork `GreenSight-Inc/wiki3`. Expect the push to report the branch as updated. The agent never commits or pushes.
