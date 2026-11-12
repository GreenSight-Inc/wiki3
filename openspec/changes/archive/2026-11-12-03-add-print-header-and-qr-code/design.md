# Design

## Context

See proposal.md, section Why, for the motivation. The specs in `specs/page-print-header/spec.md` hold the requirements.

The current state, from the code in the working copy:

- `frontend/src/css/_print.scss` turns the app shell into normal flow on paper. It hides `.page-sidebar`, `.page-header-actions`, and the rest of the chrome. It keeps the title, the description, the icon, and the breadcrumbs.
- The "Last edited by" block lives in the page sidebar in `frontend/src/pages/Index.vue`. Two switches gate it: the site switch `features.lastEditedBy` and the page property `showLastEditedBy`.
- The backend depends on `qrcode` 1.5.4 and `@types/qrcode` 1.5.6 in `backend/package.json`. `backend/models/users.ts` uses it for two-factor setup. `frontend/src/components/SetupTfaDialog.vue` draws that server-made SVG with `v-html`.
- The frontend has no QR library. The blocks workspace has `uqr` 0.1.3 for `blocks/block-qr-code`, which is a block that authors embed in pages. It is not part of the app shell.
- `originOf(req)` in `backend/helpers/common.ts` returns `req.protocol` and `req.host` of the request. `urlOf` in `backend/helpers/appShell.ts` builds the canonical link from that origin and `WIKI.models.pages.urlFor(siteId, locale, path)`.
- With the instance setting `security.trustProxy` off, `req.protocol` ignores `X-Forwarded-Proto`. `backend/base.yml` sets it off. `backend/index.ts` reads it per request.

The working tree already holds an implementation in uncommitted diffs. The same diffs carry the `poweredBy` switch of change `02-add-powered-by-toggle`. This design covers only the print header and the QR code.

## Goals / Non-Goals

**Goals:**

- One server-made QR code per page fetch, only on sites that turn it on.
- A print header that needs no new library in the frontend bundle.
- No migration and no startup check, with the evidence below.

**Non-Goals:**

- Any change to the version view header, `PageVersionHeader.vue`.
- A configurable size or position of the QR code.
- A separate endpoint for the QR code.

## Decisions

### D1. The server makes the QR code with the existing `qrcode` package

`printQrCodeFor` in `backend/api/pages.ts` calls `QRCode.toString(url, { type: 'svg', margin: 1, width: 74, errorCorrectionLevel: 'M' })`.

- `width: 74` writes the `width` and `height` attributes onto the root `svg` element. The fork used 74 pixels. An SVG sized only by a stylesheet collapses on paper.
- `margin: 1` is a quiet zone of one module. The quiet zone is the blank border a reader needs. The code sits on the white sheet, so a wider zone only shrinks the modules.
- `errorCorrectionLevel: 'M'` is the library default. It recovers about 15 percent of damaged modules.

Alternatives considered:

- A QR library in the frontend bundle. It adds a dependency, and the backend already has one.
- The `uqr` package from the blocks workspace. The frontend cannot import from another workspace, because each workspace has its own `node_modules`.
- A PNG as a data URI in an `img` element. The fork found that browsers leave such images off the printed sheet.

### D2. The QR code comes with the page fetch

The single page route `GET /_api/sites/:siteId/pages/:pageIdOrHash` adds `printQrCode` to its response. The field is an SVG string or null. The shared `Page` schema in `backend/api/schemas/page.ts` declares it as `type: ['string', 'null']`.

Alternative considered: a fetch on the `beforeprint` browser event. The print dialog does not wait for an asynchronous request, so the first print has no code. The payload cost is about 2.5 KB of SVG text per fetch, and only on sites with the switch on. A local run of `qrcode` 1.5.4 on a 70 character address gave 2456 characters.

The field rides on the `...pageFields` spread at the end of the handler. Every page answers there, the locked page included, so an unlock keeps the code that the first fetch brought.

### D3. The address is the request origin plus the canonical path

The QR code encodes `originOf(req)` followed by `encodeURI(WIKI.models.pages.urlFor(siteId, locale, path))`. This is the same rule as the canonical link of the page.

- The site hostname is not used. A site bound to the catch-all hostname `*` has no hostname of its own.
- `urlFor` applies the locale prefix as the site settings decide.
- `printQrCodeFor` calls `urlOf`, which `backend/helpers/appShell.ts` exports, so one rule builds both addresses.

Alternative considered: the configured site hostname with a fixed `https` scheme. It fails for the catch-all site and for a wiki reached on two hosts.

### D4. Inline SVG in a flex item of the header row

`frontend/src/components/PageHeader.vue` draws the SVG with `v-html` in `div.page-header-print-qr`, a flex item at the end of the header row. The element carries `aria-hidden="true"`. A float is not used, because the print layout drops floated elements.

The `v-html` content is safe. The `qrcode` library writes only path data for the modules. The encoded text never appears in the SVG markup, so a forged `Host` header cannot inject markup. `SetupTfaDialog.vue` uses the same pattern with the same lint comment.

### D5. The print rules live in the scoped style of `PageHeader.vue`

Both new elements have `display: none` on screen. Under `@media print`, the line shows as a block in 9 pt type with color `#333`. The QR item shows as a flex item with `break-inside: avoid`.

- The source plan proposed `_print.scss`. The scoped style is better, because the screen rule `display: none` belongs to the component, and no `_print.scss` rule competes with these classes.
- The color is explicit. In the dark theme the header paints a light foreground, which prints white on white paper otherwise.
- No screen rule for dark mode is added, so no `.w-dark-surface` twin is needed.

### D6. The last-edited line uses the screen switches and the reader's date

`printLastEditedBy` in `PageHeader.vue` returns an empty string in three cases. The editor is active, or `siteStore.features.lastEditedBy` or `pageStore.showLastEditedBy` is off, or the author or the date is missing. Otherwise it returns `t('common.page.printLastEditedBy', { name, date })`. The date comes from `userStore.formatDate(pageStore.updatedAt)`, which applies the date pattern and the time zone of the reader.

The fork printed the line always. This design follows the screen, so that an administrator who hides the editor on screen also hides it on paper. The proposal records this as an open question.

### D7. The frontend asks the site switch as well

`printQrCode` in `PageHeader.vue` returns `pageStore.printQrCode` only while `siteStore.features.printQrCode` is on and the editor is closed. An administrator who turns the switch off sees it take effect with no reload. Turning it on takes effect at the next page load.

### D8. Stored shape: no migration and no startup check

The key `features.printQrCode` lives in the site `config` JSONB column. The evidence that existing sites need no migration:

1. The defaults in `backend/models/sites.ts` apply only in `createSite`, through `toMerged`, and in `init`, which seeds a fresh installation.
2. `reloadCache` loads the raw rows into `WIKI.sites` with no merge of defaults. An existing site therefore has no `printQrCode` key after the upgrade.
3. The server tests `WIKI.sites[siteId]?.config?.features?.printQrCode !== true` and returns null. A missing key reads as off, which is the default.
4. `GET /_api/bootstrap` spreads `site.config` into the response. The frontend `applySiteInfo` in `frontend/src/stores/site.js` spreads `siteInfo.features` over the state defaults, where `printQrCode` is `false`.
5. `AdminGeneral.vue` sends `printQrCode: state.config.features?.printQrCode ?? false` on save. `updateSite` merges the patch into the stored settings with `mergeWith`, so the first save writes the key.
6. The key exists only in uncommitted work. CLAUDE.md, first section, needs no migration for such a shape.
7. `backend/base.yml` holds instance settings, not site settings, so it does not apply. The value is a fixed default, so `core/startupChecks.ts` does not apply either.

### D9. Permissions

- The page fetch keeps the page rule permission `read:pages`. The handler checks it with `mayOnPage`. The route keeps `config.scope: 'pages'`, so a personal access token with the pages scope receives the field too.
- The site update `PUT /_api/sites/:siteId` keeps the global permission `manage:sites` in `config.permissions` on the route. The admin General screen is part of `manage:sites`.
- The change adds no permission.

### Files by workspace

Backend:

- `backend/api/pages.ts`: `printQrCodeFor` and the response field. Reuses the `Page` schema.
- `backend/api/schemas/page.ts`: `printQrCode` on the `Page` schema.
- `backend/api/schemas/site.ts`: `features.printQrCode` on the `Site` schema.
- `backend/models/sites.ts`: the default `printQrCode: false` in `createSite` and in `init`.
- `backend/helpers/appShell.ts`: export `urlOf` for D3.
- `backend/locales/en.json`: three keys.

Frontend:

- `frontend/src/components/PageHeader.vue`: the line, the QR item, and the print rules. Uses `usePageStore`, `useSiteStore`, `useUserStore`, and `useEditorStore`.
- `frontend/src/stores/page.js`: the state field `printQrCode`, reset to null in `pageNotFound`. It arrives with `pageLoad` through the existing `API_CLIENT.get` call to `sites/:siteId/pages/:pageIdOrHash`.
- `frontend/src/stores/site.js`: the default `printQrCode: false`.
- `frontend/src/pages/AdminGeneral.vue`: a `w-item` with `blueprint-icon icon="qr"` and a `w-toggle`, in `defaultConfig` and in `save`. The icon file `frontend/public/_assets/icons/ultraviolet-qr.svg` exists.

### Locale keys

```
admin.general.printQrCode       Print QR Code
admin.general.printQrCodeHint   Can printed pages show a QR code of their address in the page header?
common.page.printLastEditedBy   Last edited by {name} on {date}
```

`common.page.printLastEditedBy` follows its neighbor `common.page.printFormat`. The hint is worded as a question that starts with `Can`, like its neighbors.

## Risks / Trade-offs

- Risk: the instance setting `security.trustProxy` is off behind Caddy. The QR code then encodes `http`, and a phone gets a redirect or an error. Mitigation: the deployment turns the setting on. The canonical link has the same need.
- Risk: every page fetch on a site with the switch on pays for one QR encode. A local run measured about 0.3 ms per encode for a 70 character address. Mitigation: the switch is off by default.
- Risk: a save that changes the path keeps the old code in the store. Mitigation: the router then replaces the route. The route watcher in `Index.vue` runs `pageLoad` again, and that brings a new code. Task 3.3 checks this.
- Risk: the version view prints no last-edited line and no QR code. Mitigation: it has its own header and is a non-goal.
- Risk: API and MCP callers receive an extra field. Mitigation: the field is null by default and holds no secret.

## Migration Plan

- Deploy: the change ships with the next image build. No migration runs. Existing sites read the switch as off.
- Turn on: an administrator opens Admin, General and turns on "Print QR Code".
- Rollback: `git revert` of the commit. A saved `features.printQrCode` key stays in the stored site settings as an inert key. The reverted code never reads it, so no reverse migration is needed.

## Assumptions

- The deployed wiki turns on `security.trustProxy`, and Caddy passes the original `Host` header.
- A 74 pixel code with a one-module quiet zone scans from a sheet at arm's length. The fork used the same size.

## Open Questions

- Does the printed line follow the site and page "last edited by" switches? Default applied: yes, as D6 says.
- Does the deployment turn on `security.trustProxy`? Default applied: yes. The deployment repository owns this.
