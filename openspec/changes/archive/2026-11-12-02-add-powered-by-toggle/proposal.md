# Proposal

## Why

Every reader page of a Wiki.js 3 site ends with the line "Powered by Wiki.js". The GreenSight Wiki.js 2 fork has a site toggle that removes this line, and the company wants a clean footer after the move to 3.x. Wiki.js 3 has no such switch (source plan section D).

## What Changes

- A new site feature flag `features.poweredBy`, a boolean. It is on by default for a new site and for the default site that a fresh install creates.
- A new toggle "Show Powered By" in the Features list of Admin > General. It reads and writes `features.poweredBy` through the existing site update route.
- The reader footer drops the attribution when the flag is off. The copyright or license line and the extra footer content stay. The gap before the attribution goes with it, and an empty footer line is not drawn.
- The footer of the admin area keeps its own wording ("Powered by Wiki.js, an open source project.") regardless of what the flag says.
- On paper, nothing changes. The print stylesheet already hides the whole footer, so a printed page carries no attribution with the flag on or off.
- The site schema documents the new key, so the site read route returns it and the site update route accepts it.

The working tree already holds this implementation as uncommitted work. The change reviews it against the spec, completes any gap, and runs the checks.

## Capabilities

### New Capabilities

- `site-footer-attribution`: whether the reader footer of a site shows the "Powered by Wiki.js" attribution. It also covers the admin switch, the admin footer, and paper.

### Modified Capabilities

- None. `openspec list --specs` reports no specs yet.

## Impact

- Workspaces: backend and frontend. Blocks are not touched.
- Backend files: `backend/models/sites.ts` (the defaults of `createSite` and `init`), `backend/api/schemas/site.ts` (the `Site` schema, `features.poweredBy`), `backend/locales/en.json` (two keys).
- Frontend files: `frontend/src/components/FooterNav.vue`, `frontend/src/pages/AdminGeneral.vue`, `frontend/src/stores/site.js`.
- Rule files and designs: no file under `.claude/rules/` covers the site footer or the site feature flags. No design under `dev/specs/` covers them. `dev/specs/wkbackup.md` lists the 2.x site keys the importer reads, and the fork key `featureHidePoweredBy` is not one of them.
- Shared files: the same six files also carry the `printQrCode` feature of change `03-add-print-header-and-qr-code`. That code is out of scope here and is neither reviewed nor changed by this change.
- Stored shape: the change adds an optional key to the `config` JSONB column of the `sites` table. Sites made by committed code do not hold the key. Every reader treats a missing key as on, which is the default. So an existing site shows the attribution as before, and the change adds no migration. `design.md` gives the evidence. The key itself exists only in uncommitted work.
- API: `GET /sites/{siteIdorHostname}` (public) and `GET /bootstrap` return `features.poweredBy` when the site holds it. `PUT /sites/{siteId}` accepts it. No new route.
- Permissions: `manage:sites`, a global permission, guards `PUT /sites/{siteId}` and the General screen. The change adds no permission and checks no page rule permission.
- Locale keys in `backend/locales/en.json`: `admin.general.showPoweredBy` and `admin.general.showPoweredByHint`. The existing keys `common.footerPoweredBy` and `common.footerGeneric` stay unchanged.
- Dependencies: none.
- Verification tier: the check set alone (Working rules, rule C). The change adds a toggle that copies its neighbors and a `v-if` in an existing component. No new markup meets a stylesheet written elsewhere, and the save flow is the existing one.
- Secrets: the change adds no secret to an API response, a log line, or a tracked file.

## Non-goals

- No change to the admin area footer wording.
- No change to the print stylesheet. The footer stays off paper as it is today.
- No import of the fork key `featureHidePoweredBy` from a 2.x `.wkbackup` package. After the import, an administrator sets the toggle by hand.
- No instance-wide switch. The flag is per site.
- No change to the attribution text, its link, or its look.
- No work on `printQrCode` or any other part of change 03.
- No migration. See the stored shape item above.

## Open Questions

- None.

Assumptions:

- The company still wants the attribution hidden. The source plan section D makes the port conditional on this, and the toggle defaults to on in either case.
- An existing site that lacks the key shows the attribution, the same as a new site. This matches the other site feature flags, which have no migration either.
