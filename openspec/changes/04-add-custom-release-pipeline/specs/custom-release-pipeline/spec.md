# Spec Delta

## Purpose

Lets an operator release a build of the GreenSight custom branch with one version tag. The release gives one pinned container image in the registry namespace of the fork.

## ADDED Requirements

### Requirement: Fork version tag format

A fork version SHALL have the form `<major>.<minor>.<patch>+jp.<N>`. The first part SHALL name the upstream base release, and `N` SHALL count fork releases on that base. The release tag SHALL be the version with a leading `v`, such as `v3.1.0+jp.1`. No number SHALL carry a leading zero.

#### Scenario: Valid tag starts a release

- **WHEN** the operator pushes the tag `v3.1.0+jp.1` to the fork repository
- **THEN** the Actions tab shows a new run of the "Release (Fork)" workflow for that tag

#### Scenario: Upstream and 2.x tags start no release

- **WHEN** the operator pushes the tag `3.1.0` or the tag `v2.5.315_jp3` to the fork repository
- **THEN** no run of the "Release (Fork)" workflow starts

#### Scenario: Malformed tag fails before the build

- **WHEN** the operator pushes a tag that starts a run but breaks the form, such as `v3.1.0+jp.01`
- **THEN** the run fails in its first check with a message that names the tag and the expected form
- **AND** no image is built or published

### Requirement: Base release check

The release SHALL publish an image only when the base release of the version exists as a tag in the fork. That tag SHALL be an ancestor of the tagged commit.

#### Scenario: Base release is in the history

- **WHEN** the operator pushes `v3.1.0+jp.1` on a commit that contains upstream tag `3.1.0`
- **THEN** the base check passes and the run continues

#### Scenario: Base release is missing or not in the history

- **WHEN** the operator pushes `v3.2.0+jp.1` and the tag `3.2.0` is absent from the fork or is not an ancestor of the tagged commit
- **THEN** the run fails with a message that names the missing base release
- **AND** no image is built or published

### Requirement: Release branch check

The release SHALL publish an image only when the tagged commit is on the release branch of the fork.

#### Scenario: Tag on the release branch

- **WHEN** the tagged commit is reachable from the release branch
- **THEN** the branch check passes and the build records the release branch as its branch

#### Scenario: Tag off the release branch

- **WHEN** the tagged commit is not reachable from the release branch
- **THEN** the run fails with a message that names the release branch
- **AND** no image is built or published

### Requirement: Published image and tag mapping

A successful run SHALL publish one image to the GitHub Container Registry namespace of the fork repository. The image tag SHALL be the version with `+` replaced by `_`, such as `3.1.0_jp.1`. The run SHALL publish no `latest` tag and no major-only or minor-only tag.

#### Scenario: Successful release

- **WHEN** the run for `v3.1.0+jp.1` succeeds
- **THEN** the image `ghcr.io/<owner>/<repository>:3.1.0_jp.1` exists in the registry
- **AND** the run summary shows the version, the image reference, the image digest, the branch, and the commit

#### Scenario: No floating tags

- **WHEN** the operator lists the tags of the image after the run
- **THEN** the list holds `3.1.0_jp.1` and no `latest`, `3`, or `3.1` tag from this run

### Requirement: Published tags are immutable

The release SHALL never overwrite an image tag that already exists in the registry.

#### Scenario: Tag already published

- **WHEN** a run starts for a version whose image tag already exists in the registry
- **THEN** the run fails with a message that the image tag already exists
- **AND** the existing image stays unchanged

### Requirement: Image platforms

The published image SHALL carry a `linux/amd64` and a `linux/arm64` variant under the same tag.

#### Scenario: Both platforms present

- **WHEN** the operator inspects the published image tag
- **THEN** the index lists a `linux/amd64` and a `linux/arm64` image

### Requirement: Version and build reported by the running wiki

A wiki started from the published image SHALL report the full fork version, such as `3.1.0+jp.1`, as its current version. It SHALL report the release branch, the full commit hash, and the commit date as its build.

#### Scenario: Admin sees the fork version and build

- **WHEN** an administrator with `access:admin` opens Admin, System on a wiki started from image `3.1.0_jp.1`
- **THEN** the current version reads `3.1.0+jp.1`
- **AND** the Build row shows the release branch, the commit, and the commit date of the tagged commit

### Requirement: Update check treats build metadata as the base release

The admin dashboard and the update check SHALL treat a fork version as equal to its upstream base release. A newer upstream release SHALL show as an available update.

#### Scenario: Same upstream base

- **WHEN** the latest upstream release is `3.1.0` and the wiki runs `3.1.0+jp.1`
- **THEN** the admin dashboard shows the version as up to date

#### Scenario: Newer upstream release

- **WHEN** the latest upstream release is `3.1.1` and the wiki runs `3.1.0+jp.1`
- **THEN** the admin dashboard and the update check dialog show an update to `3.1.1` as available

### Requirement: Upstream pipeline stays upstream

The upstream build and publish workflow SHALL run its job only in the repository `requarks/wiki`. In any other repository, its job SHALL be skipped.

#### Scenario: Branch push in the fork

- **WHEN** a push to the `scarlett` branch of the fork triggers the upstream workflow
- **THEN** the run shows its job as skipped and publishes nothing

#### Scenario: Upstream repository unchanged

- **WHEN** the same workflow runs in `requarks/wiki`
- **THEN** its job runs as it did before the change

### Requirement: Pinned steps and no secrets

Every action the release workflow uses SHALL be pinned to a full commit hash. The release SHALL use only the token GitHub issues to each run. No secret SHALL appear in a tracked file, a run log, the run summary, or the image.

#### Scenario: Operator reviews the workflow and a run

- **WHEN** the operator reads the release workflow and the log of a finished run
- **THEN** each action reference ends in a 40-character commit hash
- **AND** the workflow names no repository secret and the log shows no token value
