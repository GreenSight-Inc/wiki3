# Proposal

## Why

GreenSight prints wiki procedures, and a printed sheet says neither who last edited it nor where it lives. The Wiki.js 2 fork printed both, so the 3.x branch needs them before the migration.

On screen, Wiki.js 3 shows the last editor in the page sidebar. The print stylesheet `frontend/src/css/_print.scss` removes that sidebar, so the editor and the date never reach paper. Wiki.js 3 prints no QR code at all.

## What Changes

- A printed page carries the line "Last edited by NAME on DATE" under the page title and description. The line never shows on screen.
- A new per-site switch `features.printQrCode` adds a QR code of the page address to the printed header. A QR code is a square barcode that a phone camera reads as a link. The switch is off by default.
- The server makes the QR code as an SVG document. SVG is a text format for vector images. The page fetch returns it in a new response field `printQrCode`. The field is null while the switch is off.
- The QR code never shows on screen.
- Admin, General gets a "Print QR Code" toggle for the switch.
- The working tree already holds most of this code. The tasks review it against the spec, close the gaps, and run the checks.

## Non-goals

- The `features.poweredBy` switch and its toggle. They sit in the same files but belong to change `02-add-powered-by-toggle`.
- The print of the version view. Its header is a separate component, `PageVersionHeader.vue`, and it gets neither the line nor the QR code.
- A QR code on screen, a QR code as a downloadable image, or a QR code in the editor preview.
- A running header or a page number. The browser prints its own, and `_print.scss` leaves them to the print dialog.
- A QR library in the frontend bundle.
- A change to the Wiki.js 2 instance or to the deployment in `greensight-wiki`.

## Capabilities

### New Capabilities

- `page-print-header`: what the header of a printed page carries. That is the last-edited line, the optional QR code of the page address, and the site switch for the QR code.

### Modified Capabilities

- None. `openspec/specs/` holds no spec yet.

## Impact

- Workspaces: backend and frontend. The blocks workspace is not touched.
- Rule files: `.claude/rules/page-paths.md` loads for `backend/api/pages.ts` and `backend/helpers/common.ts`. No rule file covers print or site features. No design under `dev/specs/` covers this subsystem.
- Backend files: `backend/api/pages.ts`, `backend/api/schemas/page.ts`, `backend/api/schemas/site.ts`, `backend/models/sites.ts`, `backend/helpers/appShell.ts`, `backend/locales/en.json`.
- Frontend files: `frontend/src/components/PageHeader.vue`, `frontend/src/pages/AdminGeneral.vue`, `frontend/src/stores/page.js`, `frontend/src/stores/site.js`.
- API: `GET /_api/sites/:siteId/pages/:pageIdOrHash` gains the field `printQrCode`. The `Site` schema gains `features.printQrCode`. `PUT /_api/sites/:siteId` accepts it through the existing `features` object.
- Stored shape: the change adds the key `features.printQrCode` to the site `config` JSONB column. JSONB is the PostgreSQL binary JSON type. No committed version holds the key, and a missing key reads as off, which is the default. The change adds no migration. The design gives the evidence.
- Permissions: the page fetch checks the page rule permission `read:pages` in the handler, as it does today. The site update checks the global permission `manage:sites` on the route, as it does today. The change adds no permission.
- Locale keys in `backend/locales/en.json`: `admin.general.printQrCode`, `admin.general.printQrCodeHint`, `common.page.printLastEditedBy`.
- Dependencies: none new. The backend already depends on `qrcode` 1.5.4 and `@types/qrcode` 1.5.6 for two-factor setup, from the npm registry.
- Secrets: the change puts no secret in an API response, a log line, or a tracked file.
- Verification tier: the check set plus a throwaway instance, under working rule C. The reason is new print-only markup that meets `_print.scss`, a stylesheet written elsewhere. An SVG without its own size collapses on paper, and only a print render shows that.

## Assumptions

- The deployed wiki runs behind Caddy with the instance setting `security.trustProxy` on. The QR code then names `https` and the public host. With the setting off, the QR code names `http`. The deployment repository owns that setting.
- The last-edited line obeys the two switches that govern the sidebar block. These are the site switch `features.lastEditedBy` and the page property "show last edited by". The fork printed the line always.

## Open Questions

- Does GreenSight accept that the printed last-edited line obeys the site and page "last edited by" switches, as the screen does? The default applied is yes. The fork printed it always.
- Does the deployment turn on `security.trustProxy`? Without it, the QR code encodes an `http` address. The default applied is that the deployment turns it on.
