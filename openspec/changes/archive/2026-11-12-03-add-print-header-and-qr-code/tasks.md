# Tasks

Run every command from the repository root `/Users/sviatoslavchetyrkin/greensight/wiki3` unless the command starts with `cd`. The working tree already holds most of the code. Each task says what exists and what remains. The `poweredBy` lines in the same files belong to change `02-add-powered-by-toggle`. Leave them as they are.

## 1. Scope of the existing work

- [x] 1.1 Read the print header and QR code parts of the uncommitted diff with `git diff -- backend/api/pages.ts backend/api/schemas/page.ts backend/api/schemas/site.ts backend/models/sites.ts backend/locales/en.json frontend/src/components/PageHeader.vue frontend/src/pages/AdminGeneral.vue frontend/src/stores/page.js frontend/src/stores/site.js`. Pass: every `printQrCode` and `printLastEditedBy` hunk maps to a requirement in `specs/page-print-header/spec.md`.

## 2. Backend

- [x] 2.1 Review `printQrCodeFor` and the `printQrCode` response field in `backend/api/pages.ts` against design D1, D2, and D3. The code exists. Check with `cd backend && npm run typecheck`, which prints no error line after the tsc banner.
- [x] 2.2 Export `urlOf` from `backend/helpers/appShell.ts` and call it in `printQrCodeFor` in place of the copied expression, as design D3 says. Check with `grep -n "urlOf" backend/api/pages.ts backend/helpers/appShell.ts`, which prints the export and the call. Then check with `cd backend && npm run typecheck` with no error line.
- [x] 2.3 Review the schemas and the defaults. The code exists in `backend/api/schemas/page.ts`, `backend/api/schemas/site.ts`, and both default blocks in `backend/models/sites.ts`. Check with `grep -n "printQrCode" backend/api/schemas/page.ts backend/api/schemas/site.ts backend/models/sites.ts`, which prints two lines in each schema file, the property and its description, and two lines in `sites.ts`.
- [x] 2.4 In `backend/locales/en.json`, move `common.page.printLastEditedBy` after `common.page.printFormat`. Change `admin.general.printQrCodeHint` to `Can printed pages show a QR code of their address in the page header?`. Check with `grep -n "common.page.print\|admin.general.printQrCode" backend/locales/en.json`, which prints `printFormat` before `printLastEditedBy` and the new hint.
- [x] 2.5 Check the SVG shape with a scratch run of the installed library: `cd backend && node -e "require('qrcode').toString('https://wiki.example.org/guides/onboarding',{type:'svg',margin:1,width:74,errorCorrectionLevel:'M'}).then(s=>console.log(s.slice(0,90)))"`. Pass: the output starts with `<svg xmlns="http://www.w3.org/2000/svg" width="74" height="74"`.

## 3. Frontend

- [x] 3.1 Review `frontend/src/components/PageHeader.vue` against design D4, D5, D6, and D7. The line, the QR item, the two computed values, and the scoped print rules exist. Check with `cd frontend && npx oxlint`, which exits 0.
- [x] 3.2 Review `frontend/src/stores/page.js`, `frontend/src/stores/site.js`, and the toggle in `frontend/src/pages/AdminGeneral.vue`. The state field, the reset in `pageNotFound`, the site default, the toggle, `defaultConfig`, and `save` exist. Check with `grep -n "printQrCode" frontend/src/stores/page.js frontend/src/stores/site.js frontend/src/pages/AdminGeneral.vue`, which prints three, one, and six lines. The page store line count includes one doc comment.
- [x] 3.3 Read the route watcher in `frontend/src/pages/Index.vue` and `pageMove` and `pageSave` in `frontend/src/stores/page.js`. Pass: the notes show that every path change replaces the route and runs `pageLoad`, which refreshes `printQrCode`. Task 4.5 tests the move on a real instance.
- [x] 3.4 Build the frontend with `cd frontend && npm run build`. Pass: it exits 0 and writes to `assets/`.

## 4. Throwaway instance

Working rule C earns this. The print markup meets `_print.scss`, a stylesheet written elsewhere. The steps follow `.claude/skills/throwaway-instance/SKILL.md`. They run in the dev container, because the backend needs Node.js 26. They never touch the dev database.

- [x] 4.1 Create the scratch database. Run `cd backend && node --input-type=module -e "import fs from 'node:fs'; import { load } from 'js-yaml'; import pg from 'pg'; const d = load(fs.readFileSync('../config.yml','utf8')).db; const c = new pg.Client({ host: d.host, port: d.port, user: d.user, password: d.pass, database: d.db }); await c.connect(); await c.query('CREATE DATABASE wikitest'); await c.end()"`. Pass: it exits 0 with no output.
- [x] 4.2 Create `config.test.yml` with `sed -e 's/^port: .*/port: 3010/' -e 's/^  db: .*/  db: wikitest/' -e 's#^dataPath: .*#dataPath: ./data-test#' config.yml > config.test.yml`. Pass: `grep -nE "^port|^  db:|^dataPath|^  schema" config.test.yml` prints `3010`, `wikitest`, `./data-test`, and `schema: wiki`.
- [x] 4.3 Boot with `CONFIG_FILE=config.test.yml node --no-experimental-webstorage backend` in the background. Pass: the log prints the listening line on port 3010, about 25 seconds later.
- [x] 4.4 Script the API from a scratch directory, as the skill says. Read the site ID from `GET http://localhost:3010/_api/bootstrap`. Log in and change the seeded password. Create the page `guides/onboarding`. Pass: these results hold:
  - `GET /_api/sites/<siteId>/pages/<pageId>` answers `printQrCode: null`.
  - `PUT /_api/sites/<siteId>` with `{"features":{"printQrCode":true}}` and no cookie answers 401.
  - The same `PUT` with the admin cookie answers 200.
  - The page fetch then answers an SVG with `width="74" height="74"`.
  - That SVG equals the output of `QRCode.toString('http://localhost:3010/guides/onboarding', { type: 'svg', margin: 1, width: 74, errorCorrectionLevel: 'M' })`.
- [x] 4.5 Move the page with `PUT /_api/sites/<siteId>/pages/<pageId>/path` to `guides/start`. Pass: the page fetch answers the SVG of `http://localhost:3010/guides/start`.
- [x] 4.6 Install `puppeteer-core` in a scratch directory, never in a workspace. Drive the headless shell that `cd backend && npx puppeteer browsers install chrome-headless-shell --format '{{path}}'` prints. Open `http://localhost:3010/guides/start` signed in, in the light and the dark theme. Pass: these results hold:
  - On the screen media type, `.page-header-print-qr` and `.page-header-print-meta` have `display: none`.
  - After `page.emulateMediaType('print')`, both are visible, and the QR box measures 74 by 74 pixels.
  - The line reads "Last edited by" with the admin name and the date, in dark ink in both themes.
  - A `page.pdf()` to the scratch directory shows the code beside the title.
- [x] 4.7 Turn the switch off through Admin, General in the same browser session. Without a reload, emulate print again. Pass: `.page-header-print-qr` is absent from the DOM.
- [x] 4.8 Tear down. Kill the PID of the instance from step 4.3, matched on `CONFIG_FILE` in `/proc/<pid>/environ`. Drop the database with the client from step 4.1 and the query `DROP DATABASE wikitest`. Run `rm -rf config.test.yml data-test`. Pass: `git status --short config.test.yml data-test` prints nothing.

Run record of 2026-11-12. The steps ran on the laptop, not in the dev container. Node.js 26.13.1 came from the npm package `node@26` in a scratch directory. The browser was the installed Google Chrome in headless mode through `puppeteer-core`, not the headless shell. The dark theme was set with the `body--dark` class. The laptop has no `/proc`, so step 4.8 matched the PID with `ps eww`. Every pass condition of 4.1 to 4.8 held.

## 5. Local check set

Run in this order. A check whose tool is missing is advisory. A check whose target does not exist is skipped. Neither counts as passed.

- [x] 5.1 `ts-typecheck`: `cd backend && npm run typecheck`. Expected exit 0 and no error line after the tsc banner.
- [x] 5.2 `oxlint-backend`: `cd backend && npx oxlint`. Expected exit 0.
- [x] 5.3 `oxlint-frontend`: `cd frontend && npx oxlint`. Expected exit 0.
- [x] 5.4 `oxfmt-check`: `backend/node_modules/.bin/oxfmt --check $( { git diff --name-only HEAD -- '*.ts' '*.js' '*.mjs' '*.vue'; git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue'; } )`. Expected exit 0. The baseline of 2026-11-10 names `frontend/src/pages/AdminSystem.vue` from change 01. Report that hit as known, not as a pass.
- [x] 5.5 `frontend-build`: `cd frontend && npm run build`. Expected exit 0.
- [x] 5.6 `blocks-build`: skipped, because the change does not touch `blocks/`.
- [x] 5.7 `schema-migration`: `git diff --name-only HEAD -- backend/db/schema.ts`. No output means skipped, because the change edits no table.
- [x] 5.8 `locale-json`: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expected exit 0 and no output.
- [x] 5.9 `secret-scan`: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expected no output and exit 1.
- [x] 5.10 `untracked-config`: `git ls-files config.yml config.test.yml data-test build.json`. Expected no output.
- [x] 5.11 `openspec-validate`: `openspec validate --all`. Expected exit 0.

## 6. Hand-off

The push `git push origin feat/greensight-visual` stays outside this task list. It runs after the commit of the change, and the expected output names the branch and no rejected ref.

## Assumptions

- The dev container holds `config.yml` with working database credentials. Steps 4.1 to 4.8 read them from there and write no secret to a tracked file.
- The admin session of step 4.4 serves the browser of step 4.6 through its cookie. The skill describes the login flow.
