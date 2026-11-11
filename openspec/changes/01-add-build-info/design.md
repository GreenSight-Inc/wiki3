# Design

## Context

See proposal.md, section Why. The requirements are in `specs/system-build-info/spec.md`.

At HEAD, `GET /system/info` in `backend/api/system.ts` returns `currentVersion` from `package.json` and nothing about the build. `dev/build/Dockerfile` copies `assets/`, `blocks/compiled/`, `backend/`, `config.yml`, and `LICENSE` into `/wiki`. It copies no `.git` folder. The image installs the `git` binary for the git storage target.

The working tree already holds most of this change as uncommitted work:

- `backend/helpers/buildInfo.ts` (untracked) exports `readBuildInfo(rootPath)` and the `BuildInfo` type.
- `backend/core/config.ts` sets `WIKI.build = await readBuildInfo(WIKI.ROOTPATH)` after `WIKI.devMode`.
- `backend/types/global.d.ts` declares `WIKI.build`.
- `backend/api/system.ts` adds the three fields to the 200 schema and to the handler.
- `backend/locales/en.json` adds the two `admin.system.*` keys. The same diff also holds keys of changes 02 and 03, which this change leaves alone.
- `dev/build/Dockerfile` adds the three `ARG` lines and a `printf` step that writes `/wiki/build.json`.
- `frontend/src/pages/AdminSystem.vue` adds the Build row, the `buildLabel` and `buildDate` computed values, and the copy text.

A direct call of the helper on the laptop under Node.js 24.19.0 returned `source: "git"` with branch `feat/greensight-visual` on 2026-11-10. Node.js strips the types, so the helper runs without a booted backend.

`backend/node_modules/.bin/oxfmt --check frontend/src/pages/AdminSystem.vue` fails. The only hunk is line 8, the page title `div`, which predates this change. The new lines of the change already pass.

## Goals / Non-Goals

**Goals:**

- One resolution at boot, with no request-time cost.
- A safe failure: an unknown build hides the row and never stops the boot.
- An image build that writes correct JSON for any branch name.

**Non-Goals:**

- Any change to how `currentVersion` or `latestVersion` work.
- A cache layer order tuned for the release pipeline beyond the move in decision 5. Change 04 owns the pipeline.

## Decisions

### 1. Three sources, first hit wins

The order is the environment, then `build.json`, then a live `git` read. The environment lets an operator override a stamped image by hand. The file is the only source inside the image, because the image has no `.git`. The live read covers a source checkout and the dev container.

A source counts as a hit when it names a branch or a commit. A commit date alone identifies nothing.

Alternative: OCI labels only. The source plan names it. It needs no code but shows the build only on the host, not in the admin area. Rejected for this change.

Alternative: run `git` at every request. Rejected, because the build does not change while the process runs.

### 2. Resolution in a helper, called from the config load

`readBuildInfo` lives in `backend/helpers/buildInfo.ts`. `backend/core/config.ts` calls it once in the same step that sets `WIKI.version`. The helper never throws. Each `git` call has a 5 second timeout, and the three calls run in parallel, so the worst boot delay is about 5 seconds.

Alternative: a startup check in `backend/core/startupChecks.ts`. Rejected, because a startup check fills in stored values, and the build identity is not stored.

### 3. A detached HEAD reads as an unknown branch

`git rev-parse --abbrev-ref HEAD` prints `HEAD` on a detached checkout. The helper maps that answer to null, so the row shows the short commit alone. This is new work. The working tree returns the literal `HEAD` today.

### 4. The Dockerfile writes the JSON with Node.js

The working tree writes the file with `printf` and `%s`. Git allows a double quote in a branch name, and such a name breaks the JSON. The step instead runs `node -e` with `JSON.stringify` on `process.env`. Docker exposes each `ARG` as an environment variable to `RUN`, so the step reads the three values directly. The base image `node:26` holds Node.js.

### 5. The stamp step moves to the end of the Dockerfile

Docker invalidates the cache of every `RUN` after an `ARG` whose value changes. The working tree declares the three `ARG` lines before `npm ci --omit=dev` and the Puppeteer install. The step moves to just before the final `WORKDIR /wiki`. At that point the user is `node`, and `node` owns `/wiki`, so the step needs no `chown`.

### 6. API fields

The three fields go on the inline 200 schema of `GET /info` in `backend/api/system.ts`, next to `currentVersion`. Each is `type: ['string', 'null']`. The route reuses no schema from `backend/api/schemas/` and adds none, because the info response is inline today. The `source` value of `BuildInfo` stays internal and is not in the response.

### 7. Permission

`access:admin` is a global permission. The check lives in `config.permissions` on the route and runs in the `preParsing` hook of `backend/index.ts`. That hook throws 401 for a request with no permissions and 403 for a request without the listed one. The route declares no `config.scope`, so a personal access token cannot call it. The route returns no module configuration, so no `SENSITIVE_MASK` handling applies.

### 8. Frontend

`frontend/src/pages/AdminSystem.vue` loads the response with `API_CLIENT.get('system/info').json()` into its local `state.info`. It uses no Pinia store for these fields. `frontend/src/stores/admin.js` also calls `system/info` in `fetchInfo`, and this change leaves it alone. The row uses the shared components `w-item`, `w-item-section`, `w-item-label`, and `w-separator`, and the `blueprint-icon` with the existing `git` icon. The row adds no stylesheet rule and no dark-mode rule, so no `.w-dark-surface` twin applies. The date uses `Temporal.Instant.from(...).toLocaleString` with `dateStyle: 'medium'` and `timeStyle: 'short'`. A value that does not parse shows as raw text.

### 9. Locale keys

| Key | English string |
| --- | --- |
| `admin.system.build` | Build |
| `admin.system.buildHint` | The git branch and commit this build was made from. |

Both keys sit next to `admin.system.browserHint`, in the sorted run of `admin.system.*` keys.

### 10. Ignore a stray build file

The root `.gitignore` gains `/build.json`. A developer who tests the Docker step by hand then cannot commit the file by accident. The `untracked-config` check already expects no tracked copy.

### Files by workspace

- backend: `backend/helpers/buildInfo.ts` (new), `backend/core/config.ts`, `backend/types/global.d.ts`, `backend/api/system.ts`, `backend/locales/en.json`.
- frontend: `frontend/src/pages/AdminSystem.vue`.
- outside the workspaces: `dev/build/Dockerfile`, `.gitignore`.

## Risks / Trade-offs

- [A `git` call in the dev container fails with a dubious ownership error] → The helper catches the error and reports an unknown build. The row stays hidden in that container. No fix in this change.
- [A stale `build.json` in a source checkout wins over the live read] → The repository ignores the file, and only the image build writes it. A developer deletes it by hand.
- [An environment variable left on a container hides the real stamp] → This is the intended override. The operator removes the variable.
- [Boot waits up to 5 seconds when `git` hangs] → The timeout bounds it. A normal read takes milliseconds.
- [The formatter fix touches line 8 of `AdminSystem.vue`, which predates the change] → The `oxfmt-check` requires every changed file to pass. The fix is one hunk, so it is not a drive-by reformat of an untouched file.

## Migration Plan

No stored shape changes, so no migration applies. Deploy is the next image build. Rollback is `git revert` of the commit. A revert leaves nothing in the database. An image built before the revert keeps its `build.json`, and the reverted code ignores it.

## Assumptions

- Change 04 passes the three build arguments. This change only accepts them.
- The commit date is the committer date from `git show -s --format=%cI`. An operator who sets `BUILD_COMMIT_DATE` by hand supplies the same format.
- No other code reads `WIKI.build`. A search of `backend/` on 2026-11-10 found only the system info route.

## Open Questions

- None.
