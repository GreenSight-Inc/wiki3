# Proposal

## Why

The GreenSight custom branch of Wiki.js 3 needs its own production image, and the upstream pipeline publishes only to the requarks namespace. The Wiki.js 2 fork has a release workflow, but it builds the old layout and uses a `_jpN` suffix that broke the 2.x version compare.

## What Changes

- A new GitHub Actions workflow, "Release (Fork)", runs when an operator pushes a fork version tag such as `v3.3.1+jp.1`.
- The workflow checks the tag and stamps the version into `backend/package.json` and `frontend/package.json`. It builds the frontend assets, the blocks, and the image from `dev/build/Dockerfile`.
- The workflow passes the build args `BUILD_BRANCH`, `BUILD_COMMIT`, and `BUILD_COMMIT_DATE` that change 01 adds to the Dockerfile. The Build row under Admin, System then names the release build.
- The workflow publishes the image for `linux/amd64` and `linux/arm64` to the GitHub Container Registry (GHCR) namespace of the fork repository. It publishes one exact tag and no `latest` tag.
- The version scheme is semver build metadata: `<upstream version>+jp.<N>`, such as `3.3.1+jp.1`. Semver is the Semantic Versioning 2.0.0 standard.
- A `+` is not legal in a Docker image tag. The image tag replaces the `+` with `_`, so version `3.3.1+jp.1` becomes image tag `3.3.1_jp.1`.
- A small script, `dev/ci/fork-version.mjs`, turns a tag into the version and the image tag, and rejects a malformed tag. It runs in the workflow and on the laptop.
- The upstream workflow `.github/workflows/build.yml` gets a guard on its job. The job runs only when the repository is `requarks/wiki`. In the fork, the run shows the job as skipped.
- A new rule file `.claude/rules/fork-release.md` records the version scheme, the tag mapping, and the user-run release steps (working rule D).

## Capabilities

### New Capabilities

- `custom-release-pipeline`: How an operator releases a build of the custom branch. It covers the tag format, the tag checks, the image and its tag, the reported version, and the upstream guard.

### Modified Capabilities

None. The capabilities in `openspec/specs/` stay unchanged.

## Impact

- Workspaces touched: none of backend, frontend, or blocks. The change adds CI files only. The workflow stamps the package versions inside the CI run, never in a commit.
- Files: `.github/workflows/release-fork.yml` (new), `.github/workflows/build.yml` (one `if:` line), `dev/ci/fork-version.mjs` (new), `.claude/rules/fork-release.md` (new).
- Rule files and designs: no rule file under `.claude/rules/` and no design under `dev/specs/` covers CI or releases today. The change adds `.claude/rules/fork-release.md`.
- Stored shape: the change alters no stored shape. It adds no migration. The `update` setting keeps the version strings it holds today.
- Permissions: the change checks no permission. The version and the Build row stay behind `access:admin` on `GET /system/info`, as they are today.
- Locale keys: none.
- New dependencies: none in any workspace. The workflow uses GitHub Actions from `actions/*` and `docker/*`, each pinned to a full commit hash.
- Verification tier: the check set alone (working rule C). The change has no UI. The tasks add a local test of the tag script and a local image build.
- Change 01 (`01-add-build-info`) supplies the Dockerfile build args and the Build row. Change 01 is archived, and its code is committed as `44169960` in `dev/build/Dockerfile` and `backend/helpers/buildInfo.ts`. This change depends on it.
- Source plan correction: the plan names `3.0.2+jp.1`. The working copy sits on upstream tag `3.3.1` plus one commit, so the first fork version is `3.3.1+jp.1`.

Assumptions:

- Settled on 2026-11-11: the fork repository for 3.x is `GreenSight-Inc/wiki3`, the git remote `origin`. The image is `ghcr.io/greensight-inc/wiki3`, because GHCR needs a lowercase name. The remote `upstream` is `requarks/wiki`, with push disabled.
- The release branch is `feat/greensight-visual`, the work branch of this working copy. The default branch of the fork is `scarlett`.
- The fork repository holds the upstream release tags, such as `3.3.1`.
- The production host is a `t3` instance (x86_64) and the laptop is arm64, so the image carries both platforms.

## Non-goals

- No Docker Hub image, no Helm chart push, no GitHub Release, and no build tarball.
- No Crowdin upload and no Telegram, Discord, or Bluesky notice. Those steps belong to upstream.
- No manual rebuild of an existing version. A published image tag is never overwritten.
- No change to the backend, the frontend, or the blocks, including the version compare and the update check.
- No locale override and no test suite from the 2.x fork. Section H of the source plan names them, but this change leaves them out.
- No change to `.github/workflows/packer.yml`, which runs only by hand.
- No change to the deployment in `greensight-wiki`, which adopts the new image tag in its own change.

## Open Questions

- Which branch is the release branch? Default: `feat/greensight-visual`.
- Is the GHCR package public or private, and how does the production host authenticate a pull? Default: the package takes the visibility GHCR gives it, and the deployment change settles the pull credential.
