# Tasks

The working tree already holds the implementation as uncommitted work. Each task below reviews one part against `specs/site-footer-attribution/spec.md` and `design.md`, fixes any gap, and verifies it. The same files hold `printQrCode` from change 03. Leave every `printQrCode` line as it is.

## 1. Backend: defaults, schema, and locale keys

- [x] 1.1 Review `backend/models/sites.ts`. Confirm `poweredBy: true` in the `features` defaults of `createSite` and of `init`, with no other `poweredBy` change. Verify with `grep -n "poweredBy" backend/models/sites.ts`, which prints exactly two lines, one in each block.
- [x] 1.2 Review `backend/api/schemas/site.ts`. Confirm `features.poweredBy` is `type: 'boolean'` with no `default` key. Its description says it is on by default and the admin area keeps its own wording. Verify with `grep -n -A4 "poweredBy" backend/api/schemas/site.ts`, which prints the property and its description.
- [x] 1.3 Confirm that no migration is part of this change (design D2). Verify with `git status --porcelain -- backend/db/migrations/ backend/db/schema.ts`, which prints no line.
- [x] 1.4 Review `backend/locales/en.json`. Confirm `admin.general.showPoweredBy` is "Show Powered By" and `admin.general.showPoweredByHint` is the hint string in design D6. Verify with `grep -n "showPoweredBy" backend/locales/en.json`, which prints exactly two lines.

## 2. Frontend: store, footer, and General screen

- [x] 2.1 Review `frontend/src/stores/site.js`. Confirm the state default `poweredBy: true` under `features`, and that `applySiteInfo` still spreads `siteInfo.features` over the state defaults. Verify with `grep -n "poweredBy\|\.\.\.siteInfo.features" frontend/src/stores/site.js`, which prints both lines.
- [x] 2.2 Review `frontend/src/components/FooterNav.vue` against the requirements "The rest of the footer stays" and "The admin area keeps its wording". Confirm `showPoweredBy` is `props.generic || siteStore.features.poweredBy !== false`, the attribution span has `v-if="showPoweredBy"`, the `mr-1` gap depends on `showPoweredBy`, and the first line has `v-if="hasSiteFooter || showPoweredBy"`. Verify with `grep -n "showPoweredBy" frontend/src/components/FooterNav.vue`, which prints four lines.
- [x] 2.3 Review `frontend/src/pages/AdminGeneral.vue`. Confirm the "Show Powered By" toggle in the features list, `poweredBy: true` in `defaultConfig()`, and `poweredBy: state.config.features?.poweredBy ?? true` in `save()`. Confirm the toggle handler holds no two statements in one attribute. Verify with `grep -n "poweredBy\|showPoweredBy" frontend/src/pages/AdminGeneral.vue`, which prints six lines.
- [x] 2.4 Confirm that the print stylesheet still hides the footer (requirement "No attribution on paper"). Verify with `grep -n "\.w-footer," frontend/src/css/_print.scss`, which prints one line inside the `@media print` block. Make no change to the file.

## 3. Local check set

Run from the repository root, in this order. A check whose target does not exist is skipped. A check whose tool is missing is advisory. Never mark either as passed.

- [x] 3.1 ts-typecheck: `cd backend && npm run typecheck`. Expected exit 0 and no error line after the tsc banner.
- [x] 3.2 oxlint-backend: `cd backend && npx oxlint`. Expected exit 0.
- [x] 3.3 oxlint-frontend: `cd frontend && npx oxlint`. Expected exit 0.
- [x] 3.4 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expected exit 0. The baseline of 2026-11-10 names `frontend/src/pages/AdminSystem.vue` from change 01. Record that hit as not caused by this change. Any hit in a file of this change is a failure to fix.
- [x] 3.5 frontend-build: `cd frontend && npm run build`. Expected exit 0.
- [x] 3.6 blocks-build: skipped. The change does not touch `blocks/`.
- [x] 3.7 schema-migration: skipped. `git diff --name-only HEAD -- backend/db/schema.ts` prints no file for this change.
- [x] 3.8 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expected exit 0 and no output.
- [x] 3.9 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expected no output and exit 1.
- [x] 3.10 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expected no output.
- [x] 3.11 openspec-validate: `openspec validate --all`. Expected exit 0.

## 4. Hand-off

- [x] 4.1 Report the result of each check by id, with skipped and advisory checks named as such. The verification tier is the check set alone (proposal, Impact). No throwaway instance is booted.

The `git push` of the branch `feat/greensight-visual` stays with the user outside this task list. The user runs it after the commit of the change, and the expected output names the remote branch.
