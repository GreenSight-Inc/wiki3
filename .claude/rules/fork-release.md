---
paths:
  - ".github/workflows/release-fork.yml"
  - ".github/workflows/build.yml"
  - "dev/ci/fork-version.mjs"
  - "dev/build/Dockerfile"
---

# Fork release

The GreenSight fork (`GreenSight-Inc/wiki3`) publishes its own image through
`.github/workflows/release-fork.yml`, "Release (Fork)". The upstream pipeline `build.yml` publishes
only to the requarks namespace and does not run in the fork.

- **The version is `<upstream base>+jp.<N>`**, such as `3.3.1+jp.1`. It is semver build metadata,
  so it compares equal to its base: the admin dashboard, the status light and the update dialog
  report it up to date against upstream `3.3.1` and offer `3.3.2` as an update, with no helper. A
  prerelease (`3.3.1-jp.1`) ranks below its base, and the 2.x form (`3.3.1_jp1`) is not semver and
  makes `semverGte` throw. `N` starts at 1 on each base, and no number carries a leading zero.
- **The git tag is `v<version>`**, such as `v3.3.1+jp.1`. The `v` keeps fork tags apart from upstream
  tags, which carry no prefix and live in the fork too. The workflow filter is
  `'v[0-9]+.[0-9]+.[0-9]+\+jp.[0-9]+'`, where the backslash makes the `+` literal.
- **The image tag replaces the `+` with `_`**: `ghcr.io/greensight-inc/wiki3:3.3.1_jp.1`. A Docker
  tag allows no `+`. The OCI label `org.opencontainers.image.version` carries the full version. The
  image name is the repository name in lowercase, since GHCR takes lowercase names only.
- **`dev/ci/fork-version.mjs` is the one parser of a tag.** It prints `version=`, `image_tag=` and
  `base=` lines, or one error line and exit 1. Run it on a tag before pushing it.
- **A release publishes one exact tag and never `latest`.** A run refuses an image tag that already
  exists, and refuses a tag whose base release is missing or not an ancestor, or whose commit is not
  on `RELEASE_BRANCH` (set at the top of the workflow, `feat/greensight-visual`). A rebuild of a
  version takes the next `N`.
- **The build args `BUILD_BRANCH`, `BUILD_COMMIT` and `BUILD_COMMIT_DATE`** of `dev/build/Dockerfile`
  are what the workflow passes, so the Build row under Admin, System names the release. The branch
  is `RELEASE_BRANCH`, never `GITHUB_REF_NAME`, which is the tag on a tag push.
- **The upstream guard is one line**: `if: github.repository == 'requarks/wiki'` on job `build` in
  `.github/workflows/build.yml`. Keep it through every upstream merge. Without it, a push to
  `scarlett` in the fork runs the upstream publish with secrets the fork does not have.
- **Every `uses:` in `release-fork.yml` is a 40-character commit hash** with `# vX.Y.Z` after it, and
  every `run:` reads the tag through `env:`, never through `${{ github.ref_name }}` in the script. The
  only secret named is `GITHUB_TOKEN`.
- **`git tag` and `git push` are user-run.** The agent prepares the commands, and the operator runs
  them: `git push origin <base>` once per upstream base, then
  `git tag -a 'v3.3.1+jp.1' -m 'GreenSight 3.3.1+jp.1' && git push origin 'v3.3.1+jp.1'`.
