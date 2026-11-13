# Design

## Context

See proposal.md, section Why, for the motivation and the go or no-go gate.

The current code, as read on 2026-11-10:

- `notifications.status()` in `backend/models/notifications.ts` computes `emailsFailed24h`. It counts rows of the `notifications` table with `emailState = 'failed'` and `updatedAt` within the last 24 hours. `GET /system/notifications` returns it, and `AdminNotifications.vue` shows it in red when it is above zero.
- The mail drain in `backend/notifications/mailer.ts` logs `Failed to send a notification email` on each failed send. It retries after `RETRY_DELAY` (600 seconds). After `MAX_ATTEMPTS` (3) it marks the rows `failed`. The failure update does not touch `updatedAt`, which is the inbox sort key and the time the entry last absorbed an event.
- The counted unit is a notification entry, not a mail. One digest mail carries up to 50 entries. The schema description of `emailsFailed24h` says "Emails" and is loose about it.
- Only notification mail records a failure. The welcome mail, the password reset, and the test mail leave no row.
- `backend/models/metrics.ts` exposes no gauge for notification email. The plan's zero-code alternative of a Prometheus alert does not work without a code change.
- The 2.x fork (`dev/docs/fork-features.md` in the 2.x fork repository, section Mail-failure alert) shows the banner to every administrator. One dismissal clears it for all of them until the next failure.
- `MainLayout.vue` holds the header, the sidebar, and the page view. It has no admin-only element today. `WBanner` in `frontend/src/components/shared/` carries no color of its own.

## Goals / Non-Goals

**Goals:**

- One definition of "recently failed", shared by the admin counter and the banner.
- One cheap request per app load for an administrator, and none for anyone else.
- No migration and no new table or column.

**Non-Goals:**

- A precise failure timestamp per entry. See Risks.
- Polling. The banner checks once per full app load, not per route change and not on a timer.

## Decisions

### D1. The permission is `manage:system`

The banner and both routes need `manage:system`, a global permission. The routes check it with `config.permissions: ['manage:system']`. The frontend checks it with `userStore.can('manage:system')`, which answers true only for a group that holds it. This matches `GET /system/notifications` and every route in `backend/api/mail.ts`. The banner links to screens that need it, so a weaker permission shows a link the reader cannot open.

Alternative: `access:admin`. Rejected, because that permission does not open Admin, Notifications or Admin, Mail, and the data comes from a `manage:system` area. No new permission is proposed.

### D2. The dismissal is instance-wide

The dismissal time lives in the `notifications` settings blob as `mailAlertDismissedAt`, an ISO 8601 string or null. One administrator dismisses for all. This matches the fork. An administrator who missed the failure still sees the red count on Admin, Notifications.

Stored-shape consequence: the `notifications` blob is a committed shape. A new key with a fixed default goes into `backend/base.yml`, which `core/config.ts` merges under the stored settings on every boot (CLAUDE.md first section). So `mailAlertDismissedAt: null` goes into `base.yml` under `defaults.config.notifications`. An installation on the earlier commit reads null after the upgrade, with no migration and no startup check. The dismiss route writes the blob through `WIKI.configSvc.saveToDb(['notifications'])`, which also emits `reloadConfig` to the other instances of a cluster.

The key stays out of `NOTIFICATION_SETTINGS_FIELDS`, so `PUT /system/notifications` cannot set it and `getConfig()` does not return it. `updateConfig()` spreads the previous blob, so a settings save keeps the dismissal time.

Alternative: per administrator. It needs a column on `users` or a key in a per-user JSON blob. That is a stored shape change with a migration, and each administrator dismisses alone. Rejected as more cost for a low-need feature.

### D3. "Recently" is the window of `emailsFailed24h`

A new private helper in `backend/models/notifications.ts`, `failedSinceCondition(since)`, returns the Drizzle condition `emailState = 'failed' AND updatedAt >= since`. `status()` calls it with `now() - interval '24 hours'`, which leaves its result unchanged. The new `mailAlert()` calls it with `greatest(now() - interval '24 hours', dismissedAt)`. Both read one definition.

Alternative: record a failure time on each row in the `data` JSON. Rejected, because it changes what the drain writes, and old failed rows lack the key. The brief asks to reuse what the code computes.

### D4. A dedicated route, not a new field on `GET /system/notifications`

The plan suggests a status field on `GET /system/notifications`. That route returns all settings and runs four count queries. The banner fetch runs on every app load of every administrator. A dedicated route runs one count and returns two fields. The existing route and its `NotificationStatus` schema stay unchanged.

Routes, both in `backend/api/notifications.ts` next to the two `/system/notifications` routes:

- `GET /system/notifications/mail-alert`. `config.permissions: ['manage:system']`. No `config.scope`, because it is an admin route. Calls `reply.preventCache()`. Response 200 is `{ $ref: 'NotificationMailAlert#' }`.
- `POST /system/notifications/mail-alert/dismiss`. `config.permissions: ['manage:system']`. No `config.scope`. Calls `WIKI.models.notifications.dismissMailAlert()`, then `audit(req, 'admin', 'dismissMailAlert', {})`. Response 200 is `{ ok, message }`, as the PUT route answers. A failed save answers `reply.internalServerError('Failed to dismiss the mail alert.')`.

The new schema `NotificationMailAlert` goes into `backend/api/schemas/notifications.ts` after `NotificationStatus`: `failedCount` (integer) and `dismissedAt` (string, format date-time, nullable). The schema file already registers in `backend/api/index.ts`, so no registration changes. Neither route returns module configuration, so no sensitive prop needs masking.

### D5. The banner component

`frontend/src/components/MailAlertBanner.vue` is a new component in script setup form with a plain HTML template.

- It reads `useUserStore()` and runs only when `userStore.can('manage:system')` is true. It watches that value, so a login inside the app triggers the check.
- It calls `API_CLIENT.get('system/notifications/mail-alert').json()` once. A failure is silent and shows no banner.
- Its state is component-local (`reactive`), as in `AdminNotifications.vue`. No new Pinia store, since no other component reads it.
- It renders `<w-banner dense inline-actions class="bg-negative text-white rounded-none">` with a `<w-icon>`, the message, a `<w-btn flat>` that routes to `/_admin/notifications`, and a `<w-btn flat>` Dismiss with the named handler `dismiss`.
- `dismiss` calls `API_CLIENT.post('system/notifications/mail-alert/dismiss')`. On success it clears the count. On failure it calls `notify({ type: 'negative', message: t('admin.notifications.mailAlert.dismissFailed'), caption: apiErrorMessage(err) })`.
- The colors are the same in both themes, so the component adds no `body--dark` rule and needs no `.w-dark-surface` twin.

`MainLayout.vue` places `<mail-alert-banner />` inside `<w-header>`, directly under `<header-nav />`. This assumes the header grows with its content and the page view below adjusts. Task 3.4 checks the assumption on a throwaway instance. If the header has a fixed height, the fallback is the top of `<w-page-container>`, before `<router-view />`.

### D6. Locale keys

Next to the `admin.notifications.*` neighbors in `backend/locales/en.json`:

| Key | English |
| --- | ------- |
| `admin.notifications.mailAlert.message` | `Notification email is failing. {count} notifications were not emailed in the last 24 hours.` |
| `admin.notifications.mailAlert.openSettings` | `Notification Settings` |
| `admin.notifications.mailAlert.dismiss` | `Dismiss` |
| `admin.notifications.mailAlert.dismissFailed` | `Failed to dismiss the mail alert.` |

Next to `admin.audit.actions.updateNotificationSettings`: `admin.audit.actions.dismissMailAlert` with `Dismissed the mail failure alert`. The key `dismissMailAlert` goes into the `admin` group of `AUDIT_ACTIONS` in `backend/models/auditLog.ts`, which the type check enforces.

### D7. Documentation

`.claude/rules/notifications.md` gets one bullet on the banner, its permission, and the instance-wide dismissal. `dev/specs/notifications.md` section 12.1 gets a row for `notifications.mailAlertDismissedAt`, and section 12.2 a paragraph on the banner. `.claude/rules/notifications.md` adds `frontend/src/components/MailAlertBanner.vue` to its `paths:` list.

## Risks / Trade-offs

- [A failure hidden by a dismissal] An entry fails up to about 23 minutes after its `updatedAt`. An entry last updated before a dismissal that fails after it does not show. → Mitigation: Admin, Notifications still counts it, and the next entry that fails shows the banner. Recorded as an assumption.
- [Count is entries, not mails] The banner can say 12 when one mail failed. → Mitigation: the message says "notifications", not "emails".
- [Header placement] A banner inside the header can push the page view or overlap it. → Mitigation: the throwaway instance check in task 3.4 and the fallback in D5.
- [Stale banner] The banner checks once per app load, so a failure during a long session shows only after a reload. → Accepted for a low-need feature.
- [Instance-wide dismissal] One administrator hides the alert for all. → Accepted, as in the fork. Listed as an open question.

## Migration Plan

No migration. `backend/base.yml` supplies the default. Rollback is `git revert` of the commit. A revert leaves the key `mailAlertDismissedAt` in the stored `notifications` blob. The reverted code never reads it, and `updateConfig()` carries it along harmlessly. No reverse migration is needed. A revert also leaves `dismissMailAlert` rows in the audit log, which then show the raw action key.

## Assumptions

- `userStore.can('manage:system')` is the correct frontend test. It reads the global list from `users/whoami`.
- The header in `MainLayout.vue` grows with its content. Task 3.4 confirms it.
- The throwaway instance needs Node.js 26, so it runs in the dev container or under a Node.js 26 install. The laptop has Node.js 24.19.0.

## Open Questions

- Go or no-go. Answered on 2026-11-13: go. The query of task 1.1 returned zero rows.
- Instance-wide dismissal. Answered on 2026-11-13: instance-wide, as D2 says.
