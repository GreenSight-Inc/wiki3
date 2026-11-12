# Tasks

Run every command from the repository root of the working copy unless the command says `cd`. The working tree already holds most of the code, as design.md section Context lists. Each task says what exists and what remains. The helper checks call the resolver directly with `node` and boot no backend. Define this shell function once in the shell that runs groups 1 and 3:

```sh
R() { node --input-type=module -e "import { readBuildInfo } from './backend/helpers/buildInfo.ts'; console.log(JSON.stringify(await readBuildInfo(process.argv[1])))" "$1"; }
```

`R <folder>` prints the build identity that the resolver finds for that folder as the app root.

## 1. Build identity resolver

- [x] 1.1 Review the existing `backend/helpers/buildInfo.ts` against the spec requirements Build identity resolved at startup and Order of the build identity sources. Confirm the order, the hit rule on branch or commit, and the 5 second `git` timeout. Verify with `grep -n "timeout: 5000" backend/helpers/buildInfo.ts`, which prints one line.
- [x] 1.2 Map a branch answer of `HEAD` from `git rev-parse --abbrev-ref HEAD` to null in `backend/helpers/buildInfo.ts`, as design.md decision 3 says. Update the doc comment of the helper to say so. Verify with task 1.7.
- [x] 1.3 Confirm that `backend/core/config.ts` sets `WIKI.build = await readBuildInfo(WIKI.ROOTPATH)` and that `backend/types/global.d.ts` declares `build`. Verify with `grep -n "WIKI.build" backend/core/config.ts`, which prints one line.
- [x] 1.4 Check the environment source. Run `BUILD_BRANCH=main BUILD_COMMIT=c0ffee R /nonexistent`. Expect `{"branch":"main","commit":"c0ffee","commitDate":null,"source":"env"}`. Run `BUILD_COMMIT_DATE=2026-11-05T03:57:46-05:00 R /nonexistent` and expect `{"branch":null,"commit":null,"commitDate":null,"source":"none"}`.
- [x] 1.5 Check the file source and the fallback. Run `D=$(mktemp -d) && printf '%s' '{"branch":"a\"b","commit":"c0ffee","commitDate":"2026-11-05T03:57:46-05:00"}' > "$D/build.json"` and then `R "$D"`. Expect `"branch":"a\"b"` and `"source":"file"`. Write `not json` into the same file, run `R "$D"`, and expect all nulls with `"source":"none"`. Remove the folder with `rm -rf "$D"`.
- [x] 1.6 Check the git source. Run `R "$PWD"`. Expect `"branch":"feat/greensight-visual"`, a 40 character commit, a commit date with an offset, and `"source":"git"`.
- [x] 1.7 Check a detached checkout. Run `D=$(mktemp -d) && git clone -q "$PWD" "$D/repo" && git -C "$D/repo" checkout -q --detach` and then `R "$D/repo"`. Expect `"branch":null`, a 40 character commit, and `"source":"git"`. Remove the folder with `rm -rf "$D"`.

## 2. System info route

- [x] 2.1 Review the existing diff in `backend/api/system.ts` against the spec requirement Build fields in the system info response. Confirm the three fields have `type: ['string', 'null']`, that the handler reads `WIKI.build`, and that `source` stays out of the response. Verify with `grep -n "buildBranch\|buildCommit\|buildCommitDate" backend/api/system.ts`, which prints six lines.
- [x] 2.2 Confirm the route keeps `permissions: ['access:admin']` and declares no `config.scope`, as design.md decision 7 says. Verify with `sed -n "/'\/info'/,/schema:/p" backend/api/system.ts`, which shows `permissions: ['access:admin']` and no `scope` line.

## 3. Production image stamp

- [x] 3.1 Move the build stamp block in `dev/build/Dockerfile` to just before the final `WORKDIR /wiki`, as design.md decision 5 says. Keep the three `ARG` lines with empty defaults and keep the comment. Drop the `chown`, because the user is `node` there. Verify with `grep -n "ARG BUILD_\|WORKDIR /wiki$" dev/build/Dockerfile`, which shows the three `ARG` lines after the Puppeteer launch check and before the last `WORKDIR /wiki`.
- [x] 3.2 Replace the `printf` write with a `node -e` call that writes `JSON.stringify({ branch, commit, commitDate })` from `process.env` to `/wiki/build.json`, as design.md decision 4 says. Keep the shell guard on a set branch or commit. The call is `node -e "require('node:fs').writeFileSync('/wiki/build.json', JSON.stringify({ branch: process.env.BUILD_BRANCH, commit: process.env.BUILD_COMMIT, commitDate: process.env.BUILD_COMMIT_DATE }) + '\n')"`. Verify the same expression with the relative path `build.json` on the laptop. Run `D=$(mktemp -d) && (cd "$D" && BUILD_BRANCH='a"b' BUILD_COMMIT=c0ffee BUILD_COMMIT_DATE=2026-11-05T03:57:46-05:00 node -e "<the expression>") && R "$D"`. Expect `"branch":"a\"b"` and `"source":"file"`. Remove the folder with `rm -rf "$D"`. A full `docker build` is not part of this change, because change 04 builds the image.
- [x] 3.3 Add `/build.json` to the root `.gitignore` under the Config Files group, as design.md decision 10 says. Verify with `touch build.json && git status --porcelain -- build.json && rm build.json`, which prints nothing.

## 4. Admin > System row

- [x] 4.1 Review the existing diff in `frontend/src/pages/AdminSystem.vue` against two spec requirements. They are Build row in Admin > System and Build identity in the copied system info. Confirm the `v-if="buildLabel"` guard, the 8 character commit, the ` @ ` join, the raw text fallback of `buildDate`, and the ` (build <label>)` copy suffix. Verify with `grep -n "buildLabel\|buildDate" frontend/src/pages/AdminSystem.vue`.
- [x] 4.2 Confirm `admin.system.build` with `Build` and `admin.system.buildHint` with `The git branch and commit this build was made from.` in `backend/locales/en.json`, next to `admin.system.browserHint`. Verify with `grep -n '"admin.system.build' backend/locales/en.json`, which prints two lines.
- [x] 4.3 Format `frontend/src/pages/AdminSystem.vue` with `backend/node_modules/.bin/oxfmt frontend/src/pages/AdminSystem.vue`. The only expected hunk splits the page title `div` on line 8. Verify with `git diff HEAD -- frontend/src/pages/AdminSystem.vue`, which shows that hunk and the build row lines and nothing else, and with `backend/node_modules/.bin/oxfmt --check frontend/src/pages/AdminSystem.vue`, which exits 0.

## 5. Local check set

- [x] 5.1 ts-typecheck: `cd backend && npm run typecheck`. Expect exit 0 and no error line after the tsc banner.
- [x] 5.2 oxlint-backend: `cd backend && npx oxlint`. Expect exit 0.
- [x] 5.3 oxlint-frontend: `cd frontend && npx oxlint`. Expect exit 0.
- [x] 5.4 oxfmt-check: `backend/node_modules/.bin/oxfmt --check $(git diff --name-only HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expect exit 0. If a file of change 02 or 03 fails, report it and leave it to that change.
- [x] 5.5 frontend-build: `cd frontend && npm run build`. Expect exit 0.
- [x] 5.6 blocks-build: skipped, because the change does not touch `blocks/`.
- [x] 5.7 schema-migration: skipped, because this change does not edit `backend/db/schema.ts`. Confirm with `git diff --name-only HEAD -- backend/db/schema.ts`. If it prints the file, the edit belongs to another change, and that change owns its migration.
- [x] 5.8 locale-json: `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expect exit 0 and no output.
- [x] 5.9 secret-scan: `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expect no output and exit 1.
- [x] 5.10 untracked-config: `git ls-files config.yml config.test.yml data-test build.json`. Expect no output.
- [x] 5.11 openspec-validate: `openspec validate --all`. Expect exit 0.

This change has no user-run step. The commit and any `git push` stay with the user outside this task list.
