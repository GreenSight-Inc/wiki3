# site-footer-attribution Specification

## Purpose
Lets an administrator decide per site whether the reader footer shows the "Powered by Wiki.js" attribution, while the admin area keeps its own wording.

## Requirements

### Requirement: Attribution is on by default

A site SHALL show the "Powered by Wiki.js" attribution in the footer of every reader page until an administrator turns it off. A new site and the default site of a fresh install SHALL start with the attribution on.

#### Scenario: Fresh install

- **WHEN** a reader opens any page of the default site on a fresh install
- **THEN** the footer shows "Powered by Wiki.js" with a link to the Wiki.js website

#### Scenario: New site

- **WHEN** an administrator creates a new site and a reader opens one of its pages
- **THEN** the footer shows the attribution

### Requirement: A site from an earlier commit keeps the attribution

A site that was stored before this setting existed SHALL show the attribution after the upgrade, with no manual step. The General screen SHALL show the toggle as on for that site.

#### Scenario: Upgrade of an existing installation

- **WHEN** an installation on an earlier commit upgrades and a reader opens a page of a site that never saved this setting
- **THEN** the footer shows the attribution as it did before the upgrade

#### Scenario: General screen after the upgrade

- **WHEN** an administrator opens Admin > General for that site
- **THEN** the "Show Powered By" toggle is on

### Requirement: Administrator switches the attribution per site

Admin > General SHALL offer a "Show Powered By" toggle in its features list. Its hint SHALL read "Can the "Powered by Wiki.js" attribution be displayed in the page footer?". Saving the screen SHALL store the value for the current site only.

#### Scenario: Turn the attribution off

- **WHEN** an administrator turns "Show Powered By" off and saves
- **THEN** every reader page of that site shows no attribution, and the toggle reads off when the screen loads again

#### Scenario: Other sites are not affected

- **WHEN** an administrator turns the attribution off for one site of a multi-site installation
- **THEN** the pages of every other site still show their attribution as each site has it set

#### Scenario: Turn the attribution on again

- **WHEN** an administrator turns "Show Powered By" on and saves
- **THEN** every reader page of that site shows the attribution again

### Requirement: Only a site administrator changes the setting

Changing the setting SHALL require the `manage:sites` permission. A caller without it SHALL NOT change the setting.

#### Scenario: Caller without the permission

- **WHEN** a signed-in caller without `manage:sites` sends a site update that sets the attribution flag
- **THEN** the API answers 403 Forbidden and the stored value does not change

#### Scenario: Caller who is not signed in

- **WHEN** an anonymous caller sends the same site update
- **THEN** the API answers 401 Unauthorized and the stored value does not change

#### Scenario: Administrator without access to the screen

- **WHEN** a user without `manage:sites` opens the admin area
- **THEN** the admin menu shows no General entry, and the toggle is not offered to that user

### Requirement: The site API carries the flag

The site update request SHALL accept `features.poweredBy` as a boolean and SHALL reject any other type. The site read response and the bootstrap response SHALL return `features.poweredBy` when the site holds it. Saving one feature flag SHALL NOT drop the others.

#### Scenario: Update with a boolean

- **WHEN** a caller with `manage:sites` sends `PUT /sites/{siteId}` with `features.poweredBy` set to false
- **THEN** the API answers with `ok` true, and `GET /sites/{siteId}` returns `features.poweredBy` false with every other feature flag unchanged

#### Scenario: Update with a wrong type

- **WHEN** a caller with `manage:sites` sends `features.poweredBy` as a string such as "no"
- **THEN** the API answers 400 Bad Request and the stored value does not change

#### Scenario: Site that never saved the flag

- **WHEN** a client reads a site that never saved the flag
- **THEN** the response has no `features.poweredBy` key, and the client treats the attribution as on

### Requirement: The rest of the footer stays

Turning the attribution off SHALL remove only the attribution and the gap before it. The copyright or license line and the extra footer content SHALL stay. The footer SHALL NOT draw an empty line.

#### Scenario: Company and license set

- **WHEN** a site has a company name and a content license and the attribution is off
- **THEN** the footer shows the copyright or license line alone, with no trailing gap

#### Scenario: Nothing else in the footer

- **WHEN** a site has no company name, no content license, no extra footer content, and the attribution is off
- **THEN** the footer draws no text line

#### Scenario: Extra footer content

- **WHEN** a site has extra footer content and the attribution is off
- **THEN** the footer still shows the extra content

### Requirement: The admin area keeps its wording

The footer of the admin area SHALL show "Powered by Wiki.js, an open source project." regardless of what the site setting says.

#### Scenario: Attribution off on the current site

- **WHEN** the attribution is off for a site and an administrator opens any admin screen
- **THEN** the admin footer still shows "Powered by Wiki.js, an open source project."

### Requirement: No attribution on paper

A printed reader page SHALL carry no attribution, with the setting on or off.

#### Scenario: Print with the attribution on

- **WHEN** a reader prints a page of a site with the attribution on
- **THEN** the printed sheet has no footer and no attribution

#### Scenario: Print with the attribution off

- **WHEN** a reader prints a page of a site with the attribution off
- **THEN** the printed sheet has no footer and no attribution

### Requirement: No secret in the output

The change SHALL NOT place a secret in an API response, a log line, or a tracked file.

#### Scenario: Site read response

- **WHEN** a client reads the site configuration
- **THEN** the attribution flag is a plain boolean and the response carries no new secret
