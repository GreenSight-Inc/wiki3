# Design

## Context

See proposal.md, section Why, for the motivation. This section names only the facts that shape the approach.

- `.github/workflows/build.yml` is the upstream pipeline. It runs on a push to `scarlett` and on a manual dispatch. It stamps the version into `backend/package.json` and `frontend/package.json` with `yq`, builds `frontend/` and `blocks/` with `npm ci` and `npm run build`, and builds `dev/build/Dockerfile` for two platforms. It pushes to `requarks/wiki` and `ghcr.io/requarks/wiki`, and it also runs Crowdin, Helm, a release, and three notices.
- In a fork, that workflow fails or publishes into the wrong place, because its secrets and namespaces belong to upstream.
- `dev/build/Dockerfile` copies `assets/` and `blocks/compiled/` from the build context. It does not build them. The pipeline therefore builds both before the image build, as upstream does.
- Change 01 adds the build args `BUILD_BRANCH`, `BUILD_COMMIT`, and `BUILD_COMMIT_DATE` to the Dockerfile. That code is committed as `44169960`. With a commit or a branch set, the Dockerfile writes `/wiki/build.json`. `backend/helpers/buildInfo.ts` reads it at boot.
- The 2.x reference workflow (`~/greensight/wiki/.github/workflows/release-fork.yml`) triggers on `v*`, stamps `<upstream>_jpN`, pushes `ghcr.io/<owner>/wiki:<version>` and `:latest`, and passes `GIT_BRANCH=$GITHUB_REF_NAME`. On a tag push that value is the tag, not the branch.
- The 2.x fork guide (`dev/docs/fork-features.md` in the 2.x fork repository, release `v2.5.314_jp3`) records that the `_jpN` suffix crashed the 2.x version compare.
- The working copy is upstream tag `3.3.1` plus one commit (`git describe --tags` gives `3.3.1-1-gc92e4214`). Upstream tags carry no `v` prefix (`3.0.0` to `3.0.2`, `3.1.0`, `3.1.1`, `3.2.0`, `3.3.0`, `3.3.1`).
- `git remote -v` names `origin`, the fork `https://github.com/GreenSight-Inc/wiki3.git`, and `upstream`, `https://github.com/requarks/wiki` with push disabled. The default branch of the fork is `scarlett`, the same name as the upstream branch that `build.yml` builds.

### How the running wiki reads its version (code read on 2026-11-11, at upstream `3.3.1`)

- `backend/core/config.ts` line 112 sets `WIKI.version` from `backend/package.json`. Line 114 sets `WIKI.devMode` from its `dev` flag, and no code reads `WIKI.devMode`.
- `backend/api/system.ts`, route `GET /system/info` (permission `access:admin`), returns `currentVersion: WIKI.version` and `latestVersion: WIKI.config.update.version`.
- `backend/api/system.ts`, route `POST /system/checkForUpdate` (permission `access:admin`), runs the `checkVersion` task and returns `current` and `latest`.
- `backend/tasks/simple/check-version.ts` reads `https://api.github.com/repos/requarks/wiki/releases/latest`, strips a leading `v`, and stores the result in the `update` setting. It runs nightly (`backend/models/jobs.ts` line 37).
- `backend/models/settings.ts`, method `init`, seeds `update.version` with `WIKI.version` on a fresh install.
- `frontend/src/stores/admin.js`, getter `versionStatus`, calls `semverGte(currentVersion, latestVersion)` from `semver/functions/gte` (semver 7.8.6 in `frontend/package.json`). It returns `pending` first when either version is empty or `n/a`. `AdminDashboard.vue` (`versionCard`) and the status light in `AdminLayout.vue` (getter `isVersionLatest`) read that getter.
- `frontend/src/components/CheckUpdateDialog.vue`, computed `isLatest`, calls the same `semverGte` on the dialog's `current` and `latest`. After a check, the dialog also writes both values into `info` of the admin store, so the version card and the status light follow.
- The backend calls semver only on the Node.js and PostgreSQL versions (`backend/index.ts`, `backend/core/db.ts`), never on `WIKI.version`.
- Other places print `WIKI.version` as a plain string: the boot banner, the MCP `serverInfo.version`, the webhook and fetch `user-agent`, and the metrics label. A `+` is a legal token character in a `user-agent` value.

A run of semver 7.8.5 from `backend/node_modules` on the laptop gave these results. The base update raised the pin to 7.8.6, but the installed copy is still 7.8.5. Assumption: the patch release keeps these results.

| Call | Result |
| ---- | ------ |
| `gte('3.0.2+jp.1', '3.0.2')` | `true`, and `compare` gives `0` |
| `gte('3.0.2+jp.1', '3.0.3')` | `false` |
| `gte('3.0.2-jp.1', '3.0.2')` | `false`, a prerelease ranks below its release |
| `gte('n/a', '3.0.2')` | throws `Invalid Version` |
| `valid('3.0.2+jp.1')` | `'3.0.2'`, build metadata is dropped |

A run on 2026-11-11 gave the same results for `3.3.1+jp.1` against `3.3.1` and `3.3.2`. No code calls `valid` or `clean` on the wiki version, so the dropped metadata never reaches a screen.

## Goals / Non-Goals

**Goals:**

- One tag push gives one immutable, multi-platform image with a version the running wiki compares correctly.
- The upstream pipeline stays byte-for-byte the same in `requarks/wiki`, apart from one guard line.
- The backend, the frontend, and the blocks need no change for the fork version.

**Non-Goals:**

- No reuse of `docker/metadata-action` for the tag. The pipeline computes the tag itself, so the `+` mapping is explicit and testable.
- No re-pin of the actions in the upstream `build.yml`. Its floating tags stay as upstream wrote them.

## Decisions

### D1. Version string `<upstream>+jp.<N>`

The version in `package.json` is `3.3.1+jp.1`. Build metadata is valid semver and has the same precedence as `3.3.1`. The dashboard, the layout status light, and the update dialog then work with no helper.

Alternatives:

- `3.3.1-jp.1` (a prerelease). Rejected. It ranks below `3.3.1`, so every fork build shows "update available" against its own base.
- `3.3.1_jp1` (the 2.x scheme). Rejected. It is not semver, so `semverGte` throws in the `versionStatus` getter, as it did in 2.x.

`N` starts at 1 and counts fork releases on one base. A new upstream base restarts `N` at 1. No number carries a leading zero.

### D2. Git tag `v<version>`

The release tag is `v3.3.1+jp.1`. The `v` prefix keeps fork tags apart from upstream tags, which carry no prefix and also live in the fork repository. A `+` is legal in a git ref name and in a GitHub release tag.

The trigger filter is `'v[0-9]+.[0-9]+.[0-9]+\+jp.[0-9]+'`. In a GitHub filter pattern, `+` means "one or more of the previous character", so the literal `+` takes a backslash. The filter skips upstream tags such as `3.3.1` and 2.x tags such as `v2.5.315_jp3`. A push of all tags therefore starts no stray build.

The filter cannot reject a leading zero. `dev/ci/fork-version.mjs` does that check in the first step.

Alternative: a bare `3.3.1+jp.1` tag. Rejected, because a filter on a digit start also matches every upstream tag.

### D3. Image tag `<upstream>_jp.<N>`

A Docker tag allows `[A-Za-z0-9_.-]` and no `+`. The pipeline replaces the one `+` with `_`, so `3.3.1+jp.1` maps to image tag `3.3.1_jp.1`. The mapping is one-to-one and reversible.

Alternative: `3.3.1-jp.1`. Rejected. Tools that read image tags as semver see a prerelease that ranks below `3.3.1`. The `_` form also matches the 2.x image habit (`2.5.315_jp3`). The OCI label `org.opencontainers.image.version` carries the full `3.3.1+jp.1`.

The tag passes the pin check of the deployment (`grep -nE 'image: .*:(latest|[0-9]+)$'` in `greensight-wiki`), because it ends in `jp.1`.

### D4. Namespace from the repository name

The image is `ghcr.io/${GITHUB_REPOSITORY,,}`, the repository name in lowercase, as in the 2.x reference. The workflow names no owner. Settled on 2026-11-11: the 3.x fork is `GreenSight-Inc/wiki3`, so the image is `ghcr.io/greensight-inc/wiki3`.

GHCR accepts only lowercase image names, and `GITHUB_REPOSITORY` holds `GreenSight-Inc/wiki3`. A workflow expression has no lowercase function. One `run:` step therefore writes `image=ghcr.io/${GITHUB_REPOSITORY,,}` to `$GITHUB_OUTPUT`. The `,,` is the Bash expansion that lowercases a value. Every later step reads the image name from that output.

The 3.x image lives in its own package, apart from the 2.x fork image. The 2.x tags (`2.5.315_jp3`) never meet the 3.x tags (`3.3.1_jp.1`).

### D5. Release branch as a workflow constant

On a tag push, `GITHUB_REF_NAME` is the tag. The workflow therefore sets `RELEASE_BRANCH` at the top. It checks that the tagged commit is an ancestor of `origin/$RELEASE_BRANCH` and passes that branch as `BUILD_BRANCH`. Assumption: `RELEASE_BRANCH` is `feat/greensight-visual`. The default branch of the fork, `scarlett`, is the other candidate.

Alternative: `git branch -r --contains`. Rejected. It returns several branches or none, and the Build row then names a guess.

### D6. Base and immutability checks before the build

- Base check: `git rev-parse -q --verify "refs/tags/$BASE"` and `git merge-base --is-ancestor "$BASE" "$GITHUB_SHA"`. The checkout uses `fetch-depth: 0`, so every tag and branch is present.
- Immutability check: after the registry login, `docker buildx imagetools inspect "$IMAGE:$IMAGE_TAG"` succeeds only for an existing tag. Then the step fails with an `::error::` line.
- Each failing check prints an `::error::` annotation. The operator sees the message on the run page.

### D7. Pinned actions and runner

Every `uses:` names a full 40-character commit hash, with the exact version in a trailing comment. The implementer resolves each hash with `git ls-remote --tags https://github.com/<owner>/<action>`. The actions are `actions/checkout` (v7.x), `actions/setup-node` (v7.x), `docker/setup-qemu-action`, `docker/setup-buildx-action` (v4.x), `docker/login-action` (v4.x), and `docker/build-push-action` (v7.x). The majors follow `build.yml`. The setup-qemu major is the newest on the day. The runner is `ubuntu-24.04`, not `ubuntu-latest`. Node.js is `26.x`, the same as upstream. The lock files pin the npm packages.

### D8. Permissions and secrets

The job declares `contents: read` and `packages: write`. It logs in to GHCR with `github.actor` and `secrets.GITHUB_TOKEN`, the token GitHub issues to each run. It names no other secret. Each `run:` step reads the tag through an `env:` variable, never through `${{ github.ref_name }}` inside the script, so a crafted tag cannot inject shell code. A `concurrency` group per tag stops two runs for one tag.

### D9. Upstream guard

The `build` job in `.github/workflows/build.yml` gets `if: github.repository == 'requarks/wiki'`. In the fork the run appears with the job skipped. In upstream nothing changes. The guard sits on the job, so the triggers stay as upstream wrote them.

### D10. Platforms

The image carries `linux/amd64` and `linux/arm64`, as upstream builds. The production host is a `t3` instance (x86_64, assumption from `greensight-wiki` decision D2), and the laptop stack runs on arm64. The Dockerfile already handles an emulated build: it checks the browser binary instead of launching it.

### Files

No backend route, schema, store, component, or locale key changes.

| Area | File | Change |
| ---- | ---- | ------ |
| CI | `.github/workflows/release-fork.yml` | New. The release workflow |
| CI | `.github/workflows/build.yml` | One `if:` line on job `build` |
| CI | `dev/ci/fork-version.mjs` | New. Parses the tag, prints `version`, `image_tag`, and `base` as `key=value` lines, exits 1 on a bad tag. Node.js built-ins only |
| Rules | `.claude/rules/fork-release.md` | New. Paths: the two workflows, `dev/ci/fork-version.mjs`, `dev/build/Dockerfile` |

### Workflow outline

```yaml
name: Release (Fork)
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+\+jp.[0-9]+'
env:
  RELEASE_BRANCH: feat/greensight-visual
jobs:
  release:
    runs-on: ubuntu-24.04
    permissions: { contents: read, packages: write }
    concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }
    steps:
      # checkout (fetch-depth: 0), setup-node 26.x
      # parse:  node dev/ci/fork-version.mjs "$TAG" >> "$GITHUB_OUTPUT"
      # image:  echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"
      # check:  base tag exists and is an ancestor, commit is on origin/$RELEASE_BRANCH
      # stamp:  npm pkg set version="$VERSION" in backend/ and frontend/
      # build:  npm ci && npm run build in frontend/ and blocks/
      # qemu, buildx, login ghcr.io, image tag must not exist
      # build-push: platforms linux/amd64,linux/arm64, one tag,
      #   build-args BUILD_BRANCH, BUILD_COMMIT, BUILD_COMMIT_DATE,
      #   labels org.opencontainers.image.version/revision/source
      # summary: version, image, digest, branch, commit to $GITHUB_STEP_SUMMARY
```

`BUILD_COMMIT` is `$GITHUB_SHA`. `BUILD_COMMIT_DATE` is `git show -s --format=%cI "$GITHUB_SHA"`, an RFC 3339 time. `BUILD_BRANCH` is `$RELEASE_BRANCH`.

The `dev` flag in `backend/package.json` stays `true`, as in an upstream image. No code reads `WIKI.devMode`.

### Stored shape and permissions

The change alters no stored shape and adds no migration. The `update` setting holds a version string today and still does. The change checks no permission. `GET /system/info` and `POST /system/checkForUpdate` keep their global permission `access:admin` in `config.permissions`.

## Risks / Trade-offs

- [An upstream merge conflicts on the guard line in `build.yml`] → The guard is one line on the job. The rule file names it, so a merge keeps it.
- [The upstream version check reads `requarks/wiki`, so the dashboard reports upstream releases, not fork releases] → This is the wanted signal. A new upstream release is the cue to merge and tag `+jp.1` on the new base.
- [The fork repository lacks the upstream base tag] → The base check fails with the tag name. The fix is a user-run `git push origin 3.3.1`.
- [`imagetools inspect` fails for a reason other than a missing tag] → The push then fails on the same cause, so no image is overwritten.
- [The arm64 build under emulation is slow] → It runs on the runner, not the laptop. The Dockerfile skips the browser launch under emulation.
- [A tag is moved and pushed again] → The immutability check fails the run. A new release takes the next `N`.
- [The GHCR package is private and the host cannot pull] → The deployment change settles the pull credential. This change only publishes.

## Migration Plan

1. Merge the change into the release branch.
2. Push the branch and the upstream base tag to the fork (user-run).
3. Push the first release tag `v3.3.1+jp.1` (user-run) and read the run summary.
4. The deployment change in `greensight-wiki` sets image tag `3.3.1_jp.1`.

Rollback: `git revert` of the commit removes the workflow, the script, the rule file, and the guard. A published image stays in GHCR. Its deletion is a user-run step in the registry. No database state is involved.

## Open Questions

- Release branch name. Default: `feat/greensight-visual`. The other candidate is `scarlett`, the default branch of the fork. The answer changes the one `RELEASE_BRANCH` line.
- Settled on 2026-11-11, no longer open: the fork repository is `GreenSight-Inc/wiki3`, and the image is `ghcr.io/greensight-inc/wiki3` (see D4).
- GHCR package visibility and the pull credential of the production host. Default: the deployment change settles it.
