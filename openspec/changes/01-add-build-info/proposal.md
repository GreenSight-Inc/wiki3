# Proposal

## Why

The version in `package.json` names a release, not a build. A custom branch produces many images with the same version, so an administrator cannot tell which commit runs. The Wiki.js 2 fork showed a Git Build row under Admin > System Info, and Wiki.js 3 has no equivalent.

## What Changes

- The backend resolves the build identity once at boot. The build identity is the git branch, the full commit hash, and the commit date of the running code.
- Three sources apply in order, and the first hit wins. The first is the environment. The second is a `build.json` file at the app root. The third is a live read of the `.git` folder.
- The production Dockerfile accepts three build arguments and writes `build.json` from them. An image built with no arguments has no `build.json`.
- `GET /system/info` returns three new fields: `buildBranch`, `buildCommit`, and `buildCommitDate`. Each is a string or null.
- Admin > System shows a Build row with the branch, the short commit, and the commit date. The row is hidden when the build is unknown.
- The text that the Copy System Info button produces names the build when it is known.
- No change is breaking. The three fields are additions to an existing response.

## Non-goals

- The release pipeline that passes the build arguments. Change `04-add-custom-release-pipeline` owns it.
- OCI image labels, such as `org.opencontainers.image.revision`. Change 04 decides on them.
- The version scheme with semver build metadata, such as `3.0.2+jp.1`. Change 04 owns it.
- A Build line on the admin dashboard or in any place other than Admin > System.
- A version compare or an update check based on the commit.
- Exposing the build through the MCP server or to a personal access token.

## Capabilities

### New Capabilities

- `system-build-info`: How the running wiki identifies its own build, and how an administrator reads that identity through the API and the admin area.

### Modified Capabilities

- None. `openspec/specs/` holds no capability yet.

## Impact

- Workspaces: backend and frontend. The change also edits `dev/build/Dockerfile` and the root `.gitignore`. It does not touch blocks.
- Rule file and design: no rule file under `.claude/rules/` covers the system info route or Admin > System. No design under `dev/specs/` covers it. `dev/specs/mcp.md` names `GET /system/info` for `isMCPEnabled` only, and this change leaves that field as it is.
- Stored shape: the change alters no stored shape. It adds no database column, no stored setting, and no config key. `build.json` is a build artifact inside the image, not stored state. No migration applies.
- Permissions: `GET /system/info` keeps its existing route check, the global permission `access:admin` in `config.permissions`. The change adds no permission. The route keeps no `config.scope`, so a personal access token cannot call it.
- Locale keys in `backend/locales/en.json`: `admin.system.build` and `admin.system.buildHint`.
- Dependencies: none new. The resolver uses `node:fs`, `node:path`, `node:child_process`, and `node:util`. The frontend formats the date with the native Temporal API.
- Environment variables read at boot: `BUILD_BRANCH`, `BUILD_COMMIT`, and `BUILD_COMMIT_DATE`. The same names serve as Dockerfile build arguments.
- Working tree: most of the code exists as uncommitted work. `tasks.md` names what exists and what remains.
- Verification tier: the check set alone, under working rule C. The Build row copies the markup of its sibling rows in the same list, so it meets no stylesheet written elsewhere. The resolver is checked with direct `node` calls on scratch folders, not with a booted backend.

## Assumptions

- Change 04 passes `BUILD_BRANCH`, `BUILD_COMMIT`, and `BUILD_COMMIT_DATE` as build arguments. Until it does, an image built from `dev/build/Dockerfile` shows no Build row.
- The commit date is the committer date in ISO 8601 with an offset. The fork used the same meaning.
- The variable names differ from the fork. The fork used `GIT_BRANCH`, `GIT_COMMIT`, and `GIT_COMMIT_DATE` and a file named `git-version.json`. No deployment of the 3.x wiki depends on the fork names, so the change uses the `BUILD_` names that the working tree already holds.
- A branch name and a commit hash are not secrets. They appear only to a caller who holds `access:admin`.

## Open Questions

- None.
