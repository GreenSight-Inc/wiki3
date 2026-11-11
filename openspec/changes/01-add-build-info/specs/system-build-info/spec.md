# Spec Delta

## Purpose

Lets an administrator see which build of the wiki runs: the git branch, the commit, and the commit date. Two images of the same version differ by this identity.

## ADDED Requirements

### Requirement: Build identity resolved at startup

The wiki SHALL resolve its build identity once at startup. The build identity is a git branch, a full commit hash, and a commit date. Each part SHALL be known or unknown on its own. The wiki SHALL start normally when no part is known.

#### Scenario: Nothing identifies the build

- **WHEN** the environment sets no build values, the app root holds no build file, and the app root is not a git checkout
- **THEN** the wiki starts normally
- **AND** the branch, the commit, and the commit date are all unknown

#### Scenario: The git binary fails

- **WHEN** the app root holds a `.git` folder but the git command fails or does not answer within 5 seconds
- **THEN** the wiki starts normally
- **AND** the build identity is unknown

### Requirement: Order of the build identity sources

The wiki SHALL take the build identity from the first source that names a branch or a commit. The order SHALL be the environment, then the build file at the app root, then a live read of the git checkout. A source that names only a commit date SHALL not count as a hit.

#### Scenario: The environment wins

- **WHEN** the environment sets `BUILD_BRANCH` to `main` and `BUILD_COMMIT` to a hash
- **AND** the app root also holds a build file with other values
- **THEN** the build identity is `main` with the hash from the environment

#### Scenario: The build file applies

- **WHEN** the environment sets no build values
- **AND** the app root holds a build file with a branch, a commit, and a commit date
- **THEN** the build identity is the three values from the file

#### Scenario: The build file is not valid

- **WHEN** the build file is not valid JSON, or names neither a branch nor a commit
- **THEN** the wiki ignores the file and tries the git checkout

#### Scenario: A source checkout

- **WHEN** no earlier source applies and the app root is a git checkout on a named branch
- **THEN** the build identity is the current branch, the full hash of the current commit, and its committer date

#### Scenario: A detached checkout

- **WHEN** the git checkout has a detached HEAD
- **THEN** the branch is unknown
- **AND** the commit and the commit date are known

#### Scenario: Only a commit date in the environment

- **WHEN** the environment sets only `BUILD_COMMIT_DATE`
- **THEN** the environment does not count as a hit and the next source applies

### Requirement: Production image stamps its build

The production image build SHALL accept three build arguments: `BUILD_BRANCH`, `BUILD_COMMIT`, and `BUILD_COMMIT_DATE`. When the branch or the commit argument is set, the build SHALL write the build file with the three values. Otherwise the build SHALL write no build file. Each value SHALL survive as written, quotes and backslashes included.

#### Scenario: Image built with the arguments

- **WHEN** an operator builds the image with `BUILD_BRANCH=main`, a commit hash, and a commit date
- **AND** runs the image
- **THEN** Admin > System shows `main` with the short commit and the commit date

#### Scenario: Image built with no arguments

- **WHEN** an operator builds the image with no build arguments
- **THEN** the image holds no build file
- **AND** Admin > System shows no Build row

### Requirement: Build fields in the system info response

`GET /system/info` SHALL return `buildBranch`, `buildCommit`, and `buildCommitDate`. Each field SHALL be a string or null. Null SHALL mean the part is unknown. `buildCommit` SHALL be the full hash. `buildCommitDate` SHALL be an ISO 8601 date and time with an offset, as the source gave it. Every other field of the response SHALL stay as it is.

#### Scenario: Known build

- **WHEN** an administrator calls `GET /system/info` on a wiki with a known build
- **THEN** the response holds `buildBranch`, `buildCommit` with 40 hex characters, and `buildCommitDate`

#### Scenario: Unknown build

- **WHEN** an administrator calls `GET /system/info` on a wiki with no known build
- **THEN** `buildBranch`, `buildCommit`, and `buildCommitDate` are all null

### Requirement: Access to the build fields

`GET /system/info` SHALL keep its existing check on the global permission `access:admin`. A request with no session and no API key SHALL receive 401. A session or an API key without `access:admin` SHALL receive 403. A personal access token SHALL not reach the route.

#### Scenario: Caller without the permission

- **WHEN** a signed-in user without `access:admin` calls `GET /system/info`
- **THEN** the response is 403 and holds no build field

#### Scenario: Anonymous caller

- **WHEN** a request with no session and no API key calls `GET /system/info`
- **THEN** the response is 401 and holds no build field

### Requirement: Build row in Admin > System

Admin > System SHALL show a Build row below the current version when the branch or the commit is known. The row SHALL show the branch and the first 8 characters of the commit, joined by ` @ `, or the one part that is known. The row SHALL show the commit date in the browser locale when it is known. The row SHALL be hidden when both the branch and the commit are unknown.

#### Scenario: Branch and commit known

- **WHEN** an administrator opens Admin > System on a build of `main` at commit `a13a208e6927cd28e2ec4de7f4b7b8c56add34db`
- **THEN** the Build row shows `main @ a13a208e`
- **AND** the row shows the commit date below it

#### Scenario: Only the commit known

- **WHEN** the branch is unknown and the commit is known
- **THEN** the Build row shows the short commit alone

#### Scenario: Commit date not readable

- **WHEN** the commit date does not parse as a date and time with an offset
- **THEN** the Build row shows the commit date text as the server sent it

#### Scenario: Build unknown

- **WHEN** an administrator opens Admin > System on a wiki with no known build
- **THEN** the page shows no Build row and no empty row in its place

#### Scenario: User without the permission

- **WHEN** a user without `access:admin` opens the admin area
- **THEN** the user sees no Admin > System page and no build identity

### Requirement: Build identity in the copied system info

The Copy System Info button SHALL add the build to the first line as ` (build <label>)` when the build is known. The label SHALL be the same text as the Build row. The first line SHALL stay as before when the build is unknown.

#### Scenario: Copy with a known build

- **WHEN** an administrator clicks Copy System Info on a build of `main` at commit `a13a208e`
- **THEN** the first copied line reads `Wiki.js <version> (build main @ a13a208e)`

#### Scenario: Copy with an unknown build

- **WHEN** an administrator clicks Copy System Info on a wiki with no known build
- **THEN** the first copied line reads `Wiki.js <version>`

### Requirement: No secret in the build identity output

The change SHALL put no secret in the API response, in a log line, or in a tracked file. The build file SHALL hold only the branch, the commit, and the commit date. The repository SHALL ignore a build file at its root so that no copy is tracked.

#### Scenario: Build file content

- **WHEN** the image build writes the build file
- **THEN** the file holds exactly the keys `branch`, `commit`, and `commitDate`

#### Scenario: Stray build file in the working copy

- **WHEN** a developer creates `build.json` at the repository root
- **THEN** `git status` does not list it as untracked
