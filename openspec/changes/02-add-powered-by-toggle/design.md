# Design

## Context

See `proposal.md`, section Why, for the motivation.

`FooterNav.vue` renders the footer of every reader layout: the page view, the page version view, search, tags, and the profile layout. Each layout wraps it in `<w-footer>`. The admin layout renders it with the `generic` prop, which switches the attribution to `common.footerGeneric`.

A site keeps its settings in the `config` JSONB column of the `sites` table. The site feature flags live under `config.features`. The working tree already holds the implementation as uncommitted work in six files. The same files also hold `printQrCode` from change 03, which this design leaves alone.

The print stylesheet `frontend/src/css/_print.scss` is committed code. Its "WHAT DOES NOT GO ON PAPER" block lists `.w-footer` with `display: none !important` (line 140). So the footer, and the attribution in it, never prints today.

## Goals / Non-Goals

**Goals:**

- One boolean per site, `features.poweredBy`, that decides whether the reader footer shows the attribution.
- A site that predates the key behaves as if the key were on, with no migration.
- The admin footer and the printed page stay as they are.

**Non-Goals:**

- No server-side reader of the flag. Only the frontend draws the footer.
- No change to `_print.scss`, to the attribution text, or to the footer style.

## Decisions

### D1. The key is `features.poweredBy`, a boolean that is on by default

The source plan suggests `footerPoweredBy` at the top level of the site configuration. The working tree puts it under `features` instead, next to the other on and off switches of the General screen. The General screen saves `features` as one object, and `PUT /sites/{siteId}` merges it into the stored object. So a flag under `features` needs no new key in `SITE_CONFIG_KEYS` in `backend/api/sites.ts` and no new body property. The schema reference `Site#/properties/features` already covers it.

Alternative considered: a top-level `footerPoweredBy` key, next to `company`, `contentLicense`, and `footerExtra`. It groups the flag with the footer text fields. It needs a new entry in `SITE_CONFIG_KEYS`, a new body property, and its own `save()` line. The `features` placement is cheaper and matches the toggle list it appears in.

### D2. No migration: a missing key reads as on

This decision answers how an existing site, created before the key, receives `features.poweredBy`. It does not receive it. The key stays absent from the stored row until an administrator saves the General screen. Every reader treats the absent key as on, so the site shows the attribution as before.

Evidence from the code:

1. The server reads a site row verbatim. `reloadCache` in `backend/models/sites.ts` (lines 118 to 121) selects the rows and keys them by id. It merges nothing over them. `createSite` (line 162) and `init` (line 610) write the default `poweredBy: true` (lines 214 and 649), but only for a site created after this change.
2. The site read routes spread the stored config as it is: `...s.config` and `...site.config` in `backend/api/sites.ts` (lines 82 and 151) and in `backend/api/bootstrap.ts` (line 75). The `Site` schema property `features.poweredBy` has no `default`, so the serializer omits the missing key.
3. The site store spreads the response over its own defaults. `applySiteInfo` in `frontend/src/stores/site.js` (lines 505 to 528) builds `features` as `{ ...this.features, ...siteInfo.features }`. The state default is `poweredBy: true` (line 138). So a missing key reads as true.
4. `FooterNav.vue` (line 85) tests `siteStore.features.poweredBy !== false`. Only a stored false hides the attribution.
5. The General screen loads with `toMerged(defaultConfig(), resp)` (line 905). `defaultConfig()` holds `poweredBy: true` (line 819). So the toggle reads on for a site without the key. `save()` sends `poweredBy` explicitly (line 967).
6. `updateSite` merges the incoming config into the stored one with `mergeWith` (line 442). The first save of the General screen therefore writes the key, and every other key stays.

Precedent: no migration under `backend/db/migrations/` touches `config.features`. A search for `features` in that folder finds nothing. The flags `backlinks`, `comments`, `glossary`, `glossaryAutoLink`, and `notifications` each reach existing sites the same way, through a `!== false` read on the server. The site store comment on `notifications` states the rule: "the server reads a missing key as on".

Alternative considered: a data migration, as `20261017023116_theme-animations` and `20261014234127_navigation-parent-link` do for `theme` and `navigation` keys. Those keys needed one because some readers have no default. For example, `applySiteInfo` reads `Boolean(siteInfo.navigation.showParentLink)`, which turns a missing key into false. Every reader of `poweredBy` has a default of true, so a migration changes no behavior. It also adds a SQL file and a snapshot for nothing.

This is not a fallback for an old format (CLAUDE.md, first section, and the Do not add list). No old format exists. A missing key and a true key mean the same thing, and both are the shape the code writes. The key itself exists only in uncommitted work, so its name and type can still change freely.

Assumption: the maintainer accepts the `features` precedent over the `theme` and `navigation` precedent. If not, the fallback plan is a migration named `site-powered-by` in the style of `theme-animations`, made with `cd backend && npm run db-generate -- --name=site-powered-by --custom`. Assumption to confirm: `drizzle-kit generate` takes `--custom` for a data-only migration in this setup.

### D3. The footer hides the attribution and its gap

`FooterNav.vue` puts `v-if="showPoweredBy"` on the attribution span. The copyright or license span gets the `mr-1` gap only when the attribution follows it. The first footer line renders only when it has something to show (`hasSiteFooter || showPoweredBy`). The extra footer line stays unchanged. This matches the fork, which removed the attribution and its separator.

### D4. The admin footer ignores the flag

`showPoweredBy` is `props.generic || siteStore.features.poweredBy !== false`. The admin layout passes `generic`, so its wording stays regardless of what the site says. The admin footer is the wiki software describing itself to the person who runs it, not a reader-facing line.

### D5. Paper needs no new code

The fork removed the attribution on paper because Wiki.js 2 printed the footer. Wiki.js 3 hides `.w-footer` in print. A printed page therefore has no attribution with the flag on or off. The spec states this so that a later print change keeps it.

### D6. The General screen toggle copies its neighbors

The toggle is a `<w-item tag="label">` with a `blueprint-icon` of `heart-outline`, a `w-item-label` and caption, and a `w-toggle` bound to `state.config.features.poweredBy`. All are shared components from `frontend/src/components/shared/`. The icon file `frontend/public/_assets/icons/ultraviolet-heart-outline.svg` exists. The screen uses the existing calls: `API_CLIENT.get('sites/{id}?strict=true')` to load and `API_CLIENT.put('sites/{id}')` to save. After a save it reloads the site store with `siteStore.loadSite`, so the footer updates without a page reload. No new dark-mode rule is added, so no `.w-dark-surface` twin is needed.

### D7. Permissions

`PUT /sites/{siteId}` declares `config.permissions: ['manage:sites']`. That is a global permission, checked by the `preParsing` hook in `backend/index.ts`. The hook answers 401 to a caller with no session or key and 403 to a caller without the permission. The admin menu shows the General entry only when `userStore.can('manage:sites')`. The read routes are public, which is right, because every reader needs the flag to draw the footer. The flag is not sensitive. No route here returns module configuration, and no route gains a `config.scope`.

## Files

Backend:

- `backend/models/sites.ts`: `poweredBy: true` in the `createSite` defaults and in the `init` defaults.
- `backend/api/schemas/site.ts`: `features.poweredBy` in the shared `Site` schema, a boolean with a description. The update body reuses it through `Site#/properties/features`.
- `backend/locales/en.json`: the two keys below.

Frontend:

- `frontend/src/components/FooterNav.vue`: `showPoweredBy` and the two `v-if` changes.
- `frontend/src/pages/AdminGeneral.vue`: the toggle, the `defaultConfig()` entry, and the `save()` line.
- `frontend/src/stores/site.js`: the state default `poweredBy: true`.

Locale keys:

- `admin.general.showPoweredBy`: "Show Powered By"
- `admin.general.showPoweredByHint`: "Can the \"Powered by Wiki.js\" attribution be displayed in the page footer?"

The hint follows the question form of `admin.general.allowLastEditedByHint`.

## Risks / Trade-offs

- [Risk] A later change adds a server-side reader that tests `=== true`. That reader hides the attribution on old sites. → Mitigation: the spec requires an old site to show it, and the schema description says "On by default".
- [Risk] The shared files also hold `printQrCode` from change 03. A review or a revert of one change can touch the other. → Mitigation: the tasks review only the `poweredBy` lines. Each change lands in its own commit, so a revert removes one feature only.
- [Risk] The 2.x import does not carry the fork key `featureHidePoweredBy`. A migrated site shows the attribution until an administrator turns it off. → Mitigation: the deployment runbook in greensight-wiki lists the toggle as a step after the import.
- [Trade-off] A missing key and a true key both mean on. A stored row does not show which one it holds until the first save. This is the same for the other feature flags.

## Migration Plan

No database migration. Deploy is the normal image build. Rollback is `git revert` of the commit. A revert leaves any stored `features.poweredBy` value in the `config` JSONB column. The old code ignores it, so no reverse migration is needed.

## Open Questions

- None.
