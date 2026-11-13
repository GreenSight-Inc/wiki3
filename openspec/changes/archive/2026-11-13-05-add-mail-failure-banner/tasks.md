# Tasks

## 1. Go or no-go gate

- [x] 1.1 Result on 2026-11-13: zero rows, and the user decided go. The task as written: user-run: on the legacy wiki host, against the wiki database, run the read-only query `SELECT value FROM settings WHERE key = 'mailFailure';`. Expected output: zero rows, or one row whose value holds the failure count and the time of the last failure. Record the result and the go or no-go decision in proposal.md, section Open Questions, with the date. On no-go, stop here and leave every later task unchecked.
- [x] 1.2 Done on 2026-11-13: the user confirmed the instance-wide dismissal. The task as written: On go, confirm the instance-wide dismissal with the user and record the answer in design.md, section Open Questions. Verify: both open questions in proposal.md and design.md carry an answer.

## 2. Backend

- [x] 2.1 In `backend/base.yml`, under `defaults.config.notifications`, add `mailAlertDismissedAt: null` with a comment. Verify: `grep -n 'mailAlertDismissedAt' backend/base.yml` prints one line.
- [x] 2.2 In `backend/models/notifications.ts`, add the private helper `failedSinceCondition(since)` and make `status()` use it with the 24-hour window. Add `mailAlert()`, which returns `{ failedCount, dismissedAt }` with the window `greatest(now() - interval '24 hours', dismissedAt)`. Add `dismissMailAlert()`, which sets `WIKI.config.notifications.mailAlertDismissedAt` to the current ISO time, saves with `WIKI.configSvc.saveToDb(['notifications'])`, restores the previous value on failure, and returns a boolean. Leave `NOTIFICATION_SETTINGS_FIELDS` and `getConfig()` unchanged. Verify: `cd backend && npm run typecheck` prints no error line.
- [x] 2.3 In `backend/api/schemas/notifications.ts`, add the schema `NotificationMailAlert` after `NotificationStatus`, with `failedCount` (integer) and `dismissedAt` (date-time, nullable). Verify: `grep -n "NotificationMailAlert" backend/api/schemas/notifications.ts` prints the `$id` line.
- [x] 2.4 In `backend/models/auditLog.ts`, add `dismissMailAlert` to the `admin` group of `AUDIT_ACTIONS`, next to `updateNotificationSettings`. Verify: `grep -n "dismissMailAlert" backend/models/auditLog.ts` prints one line.
- [x] 2.5 In `backend/api/notifications.ts`, add `GET /system/notifications/mail-alert` and `POST /system/notifications/mail-alert/dismiss`, each with `config.permissions: ['manage:system']`, no `config.scope`, a summary, the `Notifications` tag, and response schemas. The POST audits `dismissMailAlert` of kind `admin`. Verify: `cd backend && npm run typecheck` prints no error line, and `cd backend && npx oxlint` exits 0.
- [x] 2.6 In `backend/locales/en.json`, add the five keys of design.md D6 with their strings. Place the four `admin.notifications.mailAlert.*` keys next to the `admin.notifications.*` keys. Place `admin.audit.actions.dismissMailAlert` next to `admin.audit.actions.updateNotificationSettings`. Leave the uncommitted keys of changes 01 to 03 as they are. Verify: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'` prints nothing and exits 0.
- [x] 2.7 Update `.claude/rules/notifications.md` with one bullet on the banner and add `frontend/src/components/MailAlertBanner.vue` to its `paths:` list. Update `dev/specs/notifications.md` section 12.1 with a row for `notifications.mailAlertDismissedAt` and section 12.2 with a paragraph on the banner and its two routes. Verify: `grep -n "mailAlert" .claude/rules/notifications.md dev/specs/notifications.md` prints at least three lines.

## 3. Frontend

- [x] 3.1 Create `frontend/src/components/MailAlertBanner.vue` as design.md D5 describes. It uses a plain HTML template and `userStore.can('manage:system')` as the gate. It makes one `API_CLIENT.get('system/notifications/mail-alert')` call. It renders `<w-banner dense inline-actions>` with `bg-negative text-white`, a link button to `/_admin/notifications`, and the named handler `dismiss`, which calls `notify` on failure. Verify: `cd frontend && npx oxlint` exits 0.
- [x] 3.2 In `frontend/src/layouts/MainLayout.vue`, import the component and place `<mail-alert-banner />` inside `<w-header>` under `<header-nav />`. Verify: `cd frontend && npm run build` exits 0.
- [x] 3.3 Boot a throwaway instance as the throwaway-instance skill says. Copy `config.yml` to `config.test.yml` with `port: 3010`, `db.db: wikitest`, and `dataPath: ./data-test`. Create the database `wikitest` with `pg` from `backend/node_modules`. Run `CONFIG_FILE=config.test.yml node --no-experimental-webstorage backend` from the repository root under Node.js 26. Verify: the log prints the listening line on port 3010 within about 25 seconds. Done on 2026-11-13. Deviation: Node.js 26.13.1 came from the npm package `node@26` in a scratch directory on the laptop, not from the dev container.
- [x] 3.4 On the throwaway instance, sign in as the seeded admin. Insert three rows into `wiki.notifications` of the `wikitest` database with `emailState = 'failed'` and `updatedAt = now()`. Script `GET /_api/system/notifications/mail-alert` and expect `failedCount` 3. Open a page in the headless shell and screenshot it in light mode and in dark mode into a scratch directory. Expect the red banner under the header, with the page view intact below. If the header clips the banner, move it to the top of `<w-page-container>` as the D5 fallback says and repeat. Click Dismiss, reload, and expect no banner and `failedCount` 0. Create a user without `manage:system`, sign in as that user, and expect no banner and no request to the route. Done on 2026-11-13: `failedCount` 3, the banner sits under the header in light mode, in dark mode and at 390 px width with the page view intact, Dismiss answers 200, the reload shows no banner and `failedCount` 0, and one new failure after the dismissal brings the banner back with the singular message. A user in the Users group and a guest see no banner, send no request to the route, and get 401 from both routes. Deviations: the installed Google Chrome ran headless in place of the headless shell, and dark mode was set through the `body--dark` class.
- [x] 3.5 Tear down the throwaway instance. Kill your own PID, matched on `CONFIG_FILE` and not on the name. Run `DROP DATABASE wikitest`, and delete `config.test.yml` and `data-test/`. Verify: `git ls-files --others --exclude-standard config.test.yml data-test` prints nothing. Done on 2026-11-13. Deviation: the PID was matched with `ps eww`, because macOS has no `/proc`.

## 4. Local checks

- [x] 4.1 ts-typecheck: `cd backend && npm run typecheck`. Expected: exit 0 and no error line after the tsc banner.
- [x] 4.2 oxlint-backend: `cd backend && npx oxlint`. Expected: exit 0.
- [x] 4.3 oxlint-frontend: `cd frontend && npx oxlint`. Expected: exit 0.
- [x] 4.4 oxfmt-check: from the root, `backend/node_modules/.bin/oxfmt --check $(git diff --name-only HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expected: exit 0. The baseline names `frontend/src/pages/AdminSystem.vue` from uncommitted work of another change. Report that file as outside this change, and never reformat it here.
- [x] 4.5 frontend-build: `cd frontend && npm run build`. Expected: exit 0.
- [x] 4.6 blocks-build: skipped, because the change does not touch `blocks/`.
- [x] 4.7 schema-migration: skipped, because `git diff --name-only HEAD -- backend/db/schema.ts` prints nothing for this change. Verify that command prints nothing for this change.
- [x] 4.8 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expected: exit 0 and no output.
- [x] 4.9 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expected: no output and exit 1.
- [x] 4.10 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expected: no output.
- [x] 4.11 openspec-validate: `openspec validate --all`. Expected: exit 0.

## 5. Hand-off (user-run, none of it ran during finalization)

Nothing below ran during the finalization, and none of it is marked done. The agent prepares the command. The user runs it from the repository root.

- The commit and the push `git push origin feat/greensight-visual` run in the session that finalizes the change, on the explicit request of the user. Expected: the push reports the branch as new or updated.
