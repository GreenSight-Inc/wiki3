# Spec Delta

## Purpose

Lets a page ask named approvers to sign off each published version. It records who signed which version and shows readers whether the current version is approved.

## ADDED Requirements

### Requirement: Sign-off mode per page
Every page SHALL have a sign-off mode of `off`, `review`, or `approve`. A new page SHALL start with `off`. A page with mode `off` SHALL send no sign-off notification, accept no verdict, and show no sign-off state. The modes `review` and `approve` SHALL differ only in what the page header shows.

#### Scenario: New page starts with sign-off off
- **WHEN** an editor creates a page
- **THEN** the sign-off status of the page reports mode `off` and no approvers

#### Scenario: Mode off refuses a verdict
- **WHEN** an approver records a verdict on a page whose mode is `off`
- **THEN** the API answers 409 and records nothing

### Requirement: Existing pages after the upgrade
An installation on the earlier commit SHALL reach the new shape through a migration. After the upgrade, every existing page SHALL read as mode `off` with no approvers and no sign-off records.

#### Scenario: Upgrade from the earlier commit
- **WHEN** an installation on the earlier commit upgrades and the migration runs
- **THEN** every existing page reports mode `off`, an empty approver list, and no sign-offs
- **AND** page reads, saves, and history work as before

### Requirement: Setting the mode and the approvers
`PUT /sites/:siteId/pages/:pageId/sign-off` SHALL replace the mode and the approver list of a page. The body SHALL carry `mode`, `users`, and `groups`, the last two as lists of ids. The caller SHALL hold `manage:pages` on the page. The response SHALL be the sign-off status as the status route returns it.

#### Scenario: Manager sets approve mode with a user and a group
- **WHEN** a caller with `manage:pages` on the page sends mode `approve`, one user id, and one group id
- **THEN** the API answers 200 with mode `approve` and both approvers in the configured list
- **AND** the audit log records one `updatePageSignOff` entry with the page id and the mode, and no names

#### Scenario: Caller without manage:pages
- **WHEN** a signed-in caller who holds `write:pages` but not `manage:pages` on the page sends the request
- **THEN** the API answers 403 and the mode and the approvers stay unchanged

#### Scenario: Caller not signed in
- **WHEN** a request with no session and no personal access token sends the request
- **THEN** the API answers 401

#### Scenario: Page does not exist
- **WHEN** the page id names no page on the site
- **THEN** the API answers 404

### Requirement: Naming approvers needs the lookup permissions
Adding a user who is not on the list SHALL need a global `list:users` rung: `list:users`, `read:users`, `write:users`, `manage:users`, or `manage:system`. Adding a new group SHALL need `list:groups`, `read:groups`, `write:groups`, `manage:groups`, or `manage:system`. Keeping or removing an approver SHALL need neither.

#### Scenario: New user without a user lookup permission
- **WHEN** a caller with `manage:pages` on the page but no `list:users` rung adds a user who is not on the list
- **THEN** the API answers 403 and the list stays unchanged

#### Scenario: Removal without a lookup permission
- **WHEN** the same caller sends the current list minus one approver
- **THEN** the API answers 200 and the approver is removed

### Requirement: Valid approvers
An approver SHALL be an active user that is not a system account, or a group other than Guests. The list SHALL hold at most 50 entries. A request that breaks a rule SHALL be refused whole with 400.

#### Scenario: Guests group as approver
- **WHEN** a caller with `manage:pages` names the Guests group as an approver
- **THEN** the API answers 400 and nothing changes

#### Scenario: Too many approvers
- **WHEN** a caller sends 51 approvers
- **THEN** the API answers 400 and nothing changes

### Requirement: Sign-off settings are not page content
Setting the mode or the approvers SHALL record no page version. A page version SHALL NOT carry the mode. Restoring a version, restoring a deleted page, duplicating a page, and storage export SHALL NOT carry the mode, the approvers, or the sign-offs.

#### Scenario: Mode change records no version
- **WHEN** a manager changes the mode of a page
- **THEN** the history of the page shows no new version

#### Scenario: Deleted page restored
- **WHEN** a page with mode `approve` is deleted and then restored from the recycle bin
- **THEN** the restored page reports mode `off` and no approvers

### Requirement: Current approvers
The current approvers of a page SHALL be every listed user plus every current member of every listed group. Only active accounts that are not system accounts SHALL count. A person reached more than once SHALL count once. Group membership SHALL be read at the time of each check, not stored.

#### Scenario: Member joins an approver group
- **WHEN** every current approver signed the current version and a new user then joins a listed group
- **THEN** the status counts the new user as pending and the page is no longer approved

#### Scenario: Person listed directly and through a group
- **WHEN** a user is listed directly and is also a member of a listed group
- **THEN** the status counts that user once

#### Scenario: Group with no members
- **WHEN** the only approver is a group with no active members
- **THEN** the status reports zero required approvers and the page is not approved

### Requirement: Sign-off belongs to one version
A verdict SHALL name the page version it is about. The current version SHALL be the newest version in the history of the page. The status SHALL count only the verdicts on the current version. A new version of any kind SHALL leave the earlier verdicts in place and out of the count.

#### Scenario: Later save clears the status
- **WHEN** every approver signed the current version and an editor saves the page again
- **THEN** the status counts zero signed approvers for the new version
- **AND** the earlier verdicts stay readable for the earlier version

#### Scenario: Move clears the status
- **WHEN** a page with signed approvers is moved to a new path
- **THEN** the move records a new version and the status counts zero signed approvers

#### Scenario: Page without a recorded version
- **WHEN** the page has no version in its history, for example after an administrator purged the history
- **THEN** the status reports no current version and the API refuses every verdict with 409

### Requirement: Recording a verdict
`POST /sites/:siteId/pages/:pageId/sign-off/verdict` SHALL record the caller's verdict on one version. The body SHALL carry `versionId`, `verdict` as `signed` or `changesRequested`, and `comment`. A `changesRequested` verdict SHALL need a comment of 1 to 2000 characters. A second verdict by the same person on the same version SHALL replace the first.

#### Scenario: Approver signs the current version
- **WHEN** a current approver with `read:pages` sends `signed` with the id of the current version
- **THEN** the API answers 200 with the new status, which counts the caller as signed
- **AND** the audit log records one `signOffPage` entry with the page id and the version id

#### Scenario: Approver requests changes
- **WHEN** a current approver sends `changesRequested` with a comment
- **THEN** the API answers 200 and the status shows that approver with changes requested
- **AND** the audit log records one `requestSignOffChanges` entry without the comment text

#### Scenario: Changes requested without a comment
- **WHEN** an approver sends `changesRequested` with an empty comment
- **THEN** the API answers 400 and records nothing

#### Scenario: Approver changes their mind
- **WHEN** an approver who requested changes on the current version then sends `signed` for it
- **THEN** the status counts the approver as signed

### Requirement: Verdict refusals
The verdict route SHALL refuse a caller who is not signed in with 401. It SHALL answer 404 when the caller cannot read the page. It SHALL refuse a caller who is not a current approver with 403. It SHALL refuse with 409 a version id that is not the current version, a page in draft, and a page with mode `off`.

#### Scenario: Stale version
- **WHEN** an approver opened version A, an editor then published version B, and the approver sends `signed` for version A
- **THEN** the API answers 409 and records nothing

#### Scenario: Reader who is not an approver
- **WHEN** a signed-in reader with `read:pages` who is not a current approver sends a verdict
- **THEN** the API answers 403

#### Scenario: Guest
- **WHEN** an anonymous request sends a verdict
- **THEN** the API answers 401

#### Scenario: Draft page
- **WHEN** an approver sends a verdict on a page whose publish state is draft
- **THEN** the API answers 409 and records nothing

### Requirement: Approver without read access
An approver who does not hold `read:pages` on the page SHALL still count as a current approver. That approver SHALL count as pending until access is granted and a verdict is recorded. The status SHALL mark that approver as without access for the people who see the approver list.

#### Scenario: Approver loses read access
- **WHEN** a group rule takes `read:pages` on the page away from an approver
- **THEN** the status shows that approver as pending and without access, and the page is not approved

### Requirement: Reading the sign-off status
`GET /sites/:siteId/pages/:pageId/sign-off` SHALL return the mode, the current version id, and an `isApproved` flag. It SHALL return the counts of required, signed, and changes-requested approvers, and the viewer's own role and verdict. The caller SHALL hold `read:pages` on the page, and the rule for pages that are not live SHALL apply. A query parameter `versionId` SHALL return the verdicts recorded on that version.

#### Scenario: Reader sees counts only
- **WHEN** a reader with `read:pages` who is not an approver and holds neither `write:pages` nor `manage:pages` reads the status
- **THEN** the response carries the mode, the counts, and `isApproved`, and the approver list and the verdicts are null

#### Scenario: Editor sees the approvers
- **WHEN** a caller with `write:pages` or `manage:pages` on the page, or a current approver, reads the status
- **THEN** the response lists each current approver with name, verdict, comment, time, and access flag

#### Scenario: Caller cannot read the page
- **WHEN** a caller without `read:pages` on the page reads the status
- **THEN** the API answers 404

#### Scenario: History of an older version
- **WHEN** an editor reads the status with the id of an older version
- **THEN** the response lists the verdicts recorded on that version

### Requirement: Approved state
In mode `approve`, a page SHALL be approved when the current approvers number one or more and each one signed the current version. A page in draft SHALL never be approved. In mode `review`, `isApproved` SHALL be false and the counts SHALL carry the state.

#### Scenario: Every approver signed in approve mode
- **WHEN** the mode is `approve`, the page is published, and each of three current approvers signed the current version
- **THEN** `isApproved` is true

#### Scenario: One approver requested changes
- **WHEN** two of three approvers signed and the third requested changes on the current version
- **THEN** `isApproved` is false and the changes-requested count is one

### Requirement: Header badge
The page header SHALL show the sign-off state to every reader who can read the page, while the mode is not `off`. Mode `approve` SHALL show an Approved badge when approved, and pending progress otherwise. Mode `review` SHALL show how many approvers signed. A changes-requested verdict on the current version SHALL show a changes-requested state. The header SHALL show nothing while the mode is `off` and while the editor is open.

#### Scenario: Approved page in light and dark mode
- **WHEN** a reader opens an approved page in approve mode, in light mode and in dark mode
- **THEN** the header shows the Approved badge, readable on both backgrounds

#### Scenario: Mode off
- **WHEN** a reader opens a page whose mode is `off`
- **THEN** the header shows no sign-off badge

#### Scenario: Approver acts from the header
- **WHEN** a current approver opens the badge on a live page
- **THEN** a dialog lists the approvers and their verdicts and offers Sign off and Request changes for the current version

#### Scenario: Reader who is not an approver opens the badge
- **WHEN** a reader without `write:pages`, `manage:pages`, or an approver role opens the badge
- **THEN** the dialog shows the counts only and offers no action

### Requirement: Properties panel section
The page properties panel SHALL show a Sign-off section with the mode and the approver pickers to a person with `manage:pages` on the page. A person with `write:pages` but not `manage:pages` SHALL see the mode and the approvers read-only. The section SHALL be hidden in suggest mode and from a person who holds neither permission. The change SHALL save on its own after the page save, as the owners do.

#### Scenario: Manager edits the section
- **WHEN** a person with `manage:pages` changes the mode in the panel and saves the page
- **THEN** the mode and the approvers save and the page records one version for the page save only

#### Scenario: Writer without manage:pages
- **WHEN** a person with `write:pages` but not `manage:pages` opens the panel
- **THEN** the section shows the mode and the approvers as text with no control

### Requirement: Sign-off request notification
A save, a move, or a storage import that records a new version SHALL notify the current approvers, as the category `signOffRequested`. This SHALL apply only while the mode is not `off`. The notification SHALL go out only when the page is live at that moment. The person who made the change SHALL receive nothing. Each recipient SHALL hold `read:pages` on the page.

#### Scenario: Publish of a page in approve mode
- **WHEN** an editor saves a published page whose mode is `approve`
- **THEN** each current approver except the editor receives a `signOffRequested` entry, in-app and by email by default

#### Scenario: Draft save
- **WHEN** an editor saves a page in draft
- **THEN** no approver receives a sign-off notification

#### Scenario: Approver without read access
- **WHEN** an approver lacks `read:pages` on the page at the time of the fan-out
- **THEN** that approver receives nothing

### Requirement: Changes requested notification
When an approver records `changesRequested`, the wiki SHALL notify the author of that version and the page owners, as the category `signOffChangesRequested`. The entry SHALL carry the start of the comment as its excerpt. The approver SHALL receive nothing. Each recipient SHALL hold `read:pages` on the page.

#### Scenario: Approver requests changes
- **WHEN** an approver requests changes on a version that another user wrote
- **THEN** the author of the version and each page owner receive a `signOffChangesRequested` entry with the comment excerpt

### Requirement: Notification preferences
Both categories SHALL appear under the Reviews heading in Profile, Notifications, with in-app and email on by default. The section switch in Admin, Notifications SHALL apply to them as to every category in that section.

#### Scenario: Person turns email off
- **WHEN** an approver turns email off for `signOffRequested`
- **THEN** later sign-off requests reach that approver in-app only

### Requirement: No secret in sign-off output
No API response, log line, audit entry, or tracked file from this change SHALL contain a secret. A secret is a password, an API key, a personal access token, an OAuth client secret, or a private key. The status SHALL never return an email address.

#### Scenario: Status response
- **WHEN** an editor reads the sign-off status
- **THEN** each approver entry carries an id and a display name and no email address
