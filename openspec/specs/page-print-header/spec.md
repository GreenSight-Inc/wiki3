# page-print-header Specification

## Purpose

Defines what the header of a printed wiki page carries. A printed sheet names its last editor and the date of that edit, and optionally its own web address.

## Requirements

### Requirement: Printed last-edited line

A printed page SHALL show the line "Last edited by NAME on DATE" under the page title and the page description. NAME SHALL be the name of the author of the current version. DATE SHALL be the date of the last update, in the date format and the time zone of the reader. The line SHALL NOT appear on screen.

#### Scenario: Reader prints a page

- **WHEN** a reader prints a page that has an author and an update date
- **THEN** the printed header shows "Last edited by" with the author name and the update date under the title and the description

#### Scenario: Reader views the page on screen

- **WHEN** a reader views the same page on screen
- **THEN** the header shows no last-edited line, and the sidebar shows the last editor as before

#### Scenario: Reader prints from the dark theme

- **WHEN** a reader with the dark theme prints a page
- **THEN** the last-edited line prints in dark ink on the white sheet

### Requirement: Last-edited line follows the existing switches

The printed last-edited line SHALL need two switches: the site switch "Last Edited By" and the page property "show last edited by". With either switch off, the line SHALL NOT print. While the page is open in the editor, the line SHALL NOT print. For a page with no recorded author, the line SHALL NOT print.

#### Scenario: Site hides the last editor

- **WHEN** an administrator turns off "Last Edited By" under Admin, General, and a reader prints a page
- **THEN** the printed header shows no last-edited line

#### Scenario: Page hides the last editor

- **WHEN** a page has its "show last edited by" property off and a reader prints it
- **THEN** the printed header shows no last-edited line

#### Scenario: Author prints from the editor

- **WHEN** an author prints while the page is open in the editor
- **THEN** the printed header shows no last-edited line and no QR code

### Requirement: Print QR code site switch

Each site SHALL have the switch "Print QR Code" under Admin, General. The switch SHALL be off for a new site. A site whose stored settings predate the switch SHALL read it as off. Only a caller with the global permission `manage:sites` SHALL change it.

#### Scenario: New site

- **WHEN** an administrator creates a site, or a fresh installation seeds its default site
- **THEN** the "Print QR Code" switch of that site reads as off

#### Scenario: Existing site after the upgrade

- **WHEN** an installation upgrades from a version without the switch and nobody saves the General settings
- **THEN** the site reads the switch as off and printed pages carry no QR code

#### Scenario: Administrator turns the switch on

- **WHEN** a caller with `manage:sites` turns on "Print QR Code" and saves Admin, General
- **THEN** the site settings store the switch as on, and the next page load carries a QR code for print

#### Scenario: Caller without the permission

- **WHEN** a signed-in caller without `manage:sites` sends a site update with the switch
- **THEN** the server answers 403 and the switch keeps its value

#### Scenario: Caller without a session

- **WHEN** a caller with no session and no API key sends a site update with the switch
- **THEN** the server answers 401 and the switch keeps its value

### Requirement: Page fetch carries the QR code

A fetch of a single page SHALL return the field `printQrCode`. With the site switch on, the field SHALL hold an SVG document with the QR code. With the switch off, the field SHALL be null. The fetch SHALL keep its existing permission, `read:pages` on the page.

#### Scenario: Switch on

- **WHEN** a reader with `read:pages` fetches a single page on a site with "Print QR Code" on
- **THEN** the response holds `printQrCode` as a text SVG document with its own width and height of 74 pixels

#### Scenario: Switch off

- **WHEN** a reader fetches a single page on a site with "Print QR Code" off
- **THEN** the response holds `printQrCode` as null

#### Scenario: Reader without read access

- **WHEN** a reader without `read:pages` on the page fetches it
- **THEN** the server answers 404 or 403 as it does today, and returns no QR code

### Requirement: QR code encodes the page address

The QR code SHALL encode the absolute address of the page. The address SHALL use the scheme and the host of the request that fetched the page. The path SHALL carry the locale prefix exactly as the site settings decide for every other link to the page.

#### Scenario: Page in the primary locale

- **WHEN** a reader on `https://wiki.example.org` fetches the page `guides/onboarding` in the primary locale of a site without a forced prefix
- **THEN** the QR code decodes to `https://wiki.example.org/guides/onboarding`

#### Scenario: Page in another locale

- **WHEN** a reader fetches the German version of the same page
- **THEN** the QR code decodes to the address with the German locale prefix, as the canonical link of the page shows it

#### Scenario: Page after a move

- **WHEN** an editor moves a page to a new path and the page view loads again
- **THEN** the QR code decodes to the new address

### Requirement: QR code prints and never shows on screen

The page header SHALL draw the QR code on paper only, at the end of the title row, with no browser download of an image. The QR code SHALL NOT appear on screen in any theme.

#### Scenario: Reader prints with the switch on

- **WHEN** a reader prints a page on a site with "Print QR Code" on
- **THEN** the printed header shows the QR code beside the title, and a phone camera opens the page address from the sheet

#### Scenario: Reader views with the switch on

- **WHEN** a reader views the same page on screen in the light or the dark theme
- **THEN** the header shows no QR code

#### Scenario: Administrator turns the switch off

- **WHEN** an administrator turns the switch off and prints a page that was loaded while it was on
- **THEN** the printed header shows no QR code, with no reload

### Requirement: No secret in the output

The change SHALL put no secret in an API response, a log line, or a tracked file. The QR code SHALL encode only the page address.

#### Scenario: Response and logs

- **WHEN** a reader fetches a page with the switch on
- **THEN** the `printQrCode` field encodes the page address and nothing else, and the server writes no log line about it
