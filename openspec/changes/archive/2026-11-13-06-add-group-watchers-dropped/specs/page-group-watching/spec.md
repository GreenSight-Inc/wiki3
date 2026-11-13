# Spec Delta

## Purpose

Lets a group watch a page. Every current member of the group then hears about changes and comments on that page through their own notification choices.

## ADDED Requirements

### Requirement: A group watch makes every current member a watcher
The system SHALL treat every member of a group that watches a page as a watcher of that page. The system SHALL read the membership when the notification goes out, not when the group was added. A group watch SHALL reach the same notifications as a personal watch: changes to watched pages and comments on watched pages.

#### Scenario: A member hears about an edit
- **WHEN** the group Field Team watches page `procedures/harvest` and an editor outside the group saves the page
- **THEN** every active member of Field Team who holds `read:pages` on the page receives a "Changes to watched pages" entry for it

#### Scenario: A member hears about a comment
- **WHEN** the group Field Team watches a page and somebody comments on it
- **THEN** every active member of Field Team who holds `read:comments` on the page receives a "Comments on watched pages" entry for it

#### Scenario: A person who joins later is told
- **WHEN** a person joins Field Team after the group started to watch the page and the page then changes
- **THEN** that person receives the entry

#### Scenario: A person who left is not told
- **WHEN** a person leaves Field Team and the page then changes
- **THEN** that person receives no entry through the group watch

### Requirement: Members without read access receive nothing
The system SHALL check each member against the page rules of their own groups, as it checks a personal watcher. A member who fails the check SHALL receive no entry. A disabled account and a system account SHALL receive no entry.

#### Scenario: A member without read access
- **WHEN** a member of a watching group holds no `read:pages` on the page and the page changes
- **THEN** that member receives no entry and learns nothing about the page

#### Scenario: A disabled member
- **WHEN** a member of a watching group has a disabled account and the page changes
- **THEN** that member receives no entry

### Requirement: One entry per person
The system SHALL give a person one entry per event, regardless of how many ways the person watches the page. The person who caused the event SHALL receive no entry.

#### Scenario: A personal watcher in a watching group
- **WHEN** a person watches a page personally, is also a member of two groups that watch it, and the page changes
- **THEN** the person receives one entry for the change

#### Scenario: The editor is a member
- **WHEN** a member of a watching group edits the page
- **THEN** that editor receives no entry and the other members receive one each

#### Scenario: Repeated saves coalesce
- **WHEN** a page that a group watches is saved five times before a member reads the entry
- **THEN** the member holds one unread entry for the page that counts five changes

### Requirement: A member's own preferences decide the channel
The system SHALL deliver a group watch through each member's own preferences for the category, in-app or email or both or neither. The section switches in Admin, Notifications SHALL apply as they apply to a personal watcher. An unverified address SHALL receive no email.

#### Scenario: A member turned email off
- **WHEN** a member of a watching group has email off and in-app on for "Changes to watched pages" and the page changes
- **THEN** the member receives an in-app entry and no email

#### Scenario: A member turned the category off
- **WHEN** a member of a watching group has both channels off for "Changes to watched pages"
- **THEN** the member receives nothing for the change

### Requirement: A deleted page tells its group watchers
The system SHALL notify the members of the watching groups when a page is deleted. The audience SHALL be the members at the moment of the deletion, with the same checks as for an edit.

#### Scenario: Deletion of a group-watched page
- **WHEN** a page that the group Field Team watches is deleted
- **THEN** every active member of Field Team who held `read:pages` on the page as it was receives a "deleted" entry

### Requirement: The page payload names the group watchers to its editors
The system SHALL return the group watchers of a page, each with its id and name, on the page payload to a requester who holds `write:pages` on the page. Every other requester SHALL receive null in that field. The guests group SHALL never be a group watcher.

#### Scenario: An editor opens the page
- **WHEN** a requester with `write:pages` on the page fetches it
- **THEN** the payload lists the groups that watch the page, ordered by name

#### Scenario: A reader opens the page
- **WHEN** a requester without `write:pages` on the page fetches it
- **THEN** the group watchers field is null and no group name is shown

### Requirement: An editor sets the group watchers of a page
The system SHALL offer `PUT /sites/:siteId/pages/:pageId/watch-groups` with a body `{ ids }`, a list of up to 50 group ids. The route SHALL replace the group watchers of the page with that list and answer `{ ok: true, watchGroups }`, the groups as they now stand. An empty list SHALL remove every group watcher. The change SHALL record no page version and SHALL write one audit entry.

#### Scenario: An editor adds a group
- **WHEN** a signed-in caller with `write:pages` on the page and `list:groups` sends the ids of two groups
- **THEN** the system answers 200 with both groups in `watchGroups` and their members count as watchers from then on

#### Scenario: An editor removes every group
- **WHEN** a caller with `write:pages` on the page sends an empty list
- **THEN** the system answers 200 with an empty `watchGroups` and no group watches the page

#### Scenario: The audit log records the change
- **WHEN** the group watchers of a page change
- **THEN** the audit log holds one entry "Changed the groups watching a page" with the page and the number of groups, and no member names

### Requirement: The set route refuses a caller without the permission
The route SHALL answer 401 to a request without an account, 404 to a page the caller cannot read or that does not exist, and 403 to a caller without `write:pages` on the page. The route SHALL answer 423 when the page is locked against edits. A caller who adds a new group to the list SHALL also hold `list:groups`, `read:groups`, `write:groups`, `manage:groups`, or `manage:system`, or the route SHALL answer 403. Removing groups SHALL need no global permission.

#### Scenario: A guest calls the route
- **WHEN** a request without an account calls the route
- **THEN** the system answers 401 and changes nothing

#### Scenario: A reader calls the route
- **WHEN** a signed-in caller with `read:pages` but no `write:pages` on the page calls the route
- **THEN** the system answers 403 "You are not allowed to edit this page." and changes nothing

#### Scenario: An editor without group lookup adds one
- **WHEN** a caller with `write:pages` on the page but no group lookup permission sends a list that adds a group
- **THEN** the system answers 403 "You are not allowed to look up groups, so you cannot add them as watchers." and changes nothing

#### Scenario: An editor without group lookup removes one
- **WHEN** the same caller sends the current list less one group
- **THEN** the system answers 200 and the removed group no longer watches the page

#### Scenario: A page locked against edits
- **WHEN** a caller with `write:pages` on a page that is locked against edits calls the route
- **THEN** the system answers 423 "This page is locked and cannot be edited." and changes nothing

#### Scenario: An invalid group
- **WHEN** a caller sends the id of the guests group or of a group that does not exist
- **THEN** the system answers 400 "Every watcher group must be a group other than Guests." and changes nothing

### Requirement: The properties panel offers the group watchers
The page properties panel SHALL show a Group Watchers section to an editor with `write:pages` on the page, outside suggest mode. The section SHALL offer a multiple group picker that searches as the editor types. A change SHALL be saved with the page save, by its own request. The section SHALL be hidden from every other reader and in suggest mode.

#### Scenario: An editor with group lookup
- **WHEN** an editor with `write:pages` and `list:groups` opens the page properties
- **THEN** the Group Watchers section shows the current groups as chips in a picker that searches groups

#### Scenario: An editor without group lookup
- **WHEN** an editor with `write:pages` but no group lookup permission opens the page properties
- **THEN** the section lists the current groups as removable chips and says that adding a group needs the group lookup permission

#### Scenario: Suggest mode
- **WHEN** a person opens the editor in suggest mode
- **THEN** the Group Watchers section is not shown

#### Scenario: Only the group watchers changed
- **WHEN** an editor changes only the group watchers and saves
- **THEN** the system sends the group watchers request and no page update, and no page version is recorded

### Requirement: Personal watching is unchanged
The bell on the page header and the personal Watching list SHALL keep showing the personal watch only. Unwatching a page SHALL remove only the caller's own personal watch.

#### Scenario: A member presses the bell
- **WHEN** a member of a watching group without a personal watch opens the page
- **THEN** the bell shows "Watch Page" and the Watching list in the inbox does not list the page

### Requirement: An upgraded installation starts with no group watchers
After the upgrade, an installation on the earlier commit SHALL hold an empty group watch table. Every existing personal watch SHALL read and notify as before.

#### Scenario: Upgrade from the earlier commit
- **WHEN** an installation on the earlier commit runs the migration
- **THEN** no page has a group watcher and every personal watcher receives the same entries as before

### Requirement: No secret in the output
The route response, the page payload, the audit entry, and the log lines of this capability SHALL hold no secret. They SHALL carry group ids and group names only, never a member list or an email address.

#### Scenario: The route response
- **WHEN** an editor sets the group watchers
- **THEN** the response holds the group ids and names and no member, email address, or token
