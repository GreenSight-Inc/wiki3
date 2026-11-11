# Proposal

## Why

The Wiki.js 2 fork shows a red banner to every administrator when an email fails to send. Wiki.js 3 counts failed notification emails only on Admin, Notifications, so an administrator who never opens that screen does not learn that mail is failing.

**This change is conditional.** The source plan rates the need as low. The user decides go or no-go after a read-only query on the legacy wiki: `SELECT value FROM settings WHERE key = 'mailFailure';`. Task 1.1 is that gate. No implementation task starts before it records a go.

## What Changes

- A new admin route `GET /_api/system/notifications/mail-alert` returns the count of notification emails that failed recently and were not dismissed.
- A new admin route `POST /_api/system/notifications/mail-alert/dismiss` hides the banner for every administrator until the next failure. The dismissal is audited.
- A new component in the main layout shows a red banner to an administrator when the count is above zero. It has a link to Admin, Notifications and a Dismiss button.
- "Recently" reuses the 24-hour window and the failed condition behind the existing `emailsFailed24h` counter on Admin, Notifications.
- A new instance setting `notifications.mailAlertDismissedAt` holds the time of the last dismissal. Its default is null in `backend/base.yml`.
- A new audit action `dismissMailAlert` (kind `admin`).

## Non-goals

- Mail that is not a notification email: the welcome mail, the password reset, and the test mail. The 3.x mailer records no failure for these.
- A banner for mail that is not configured. Admin, Notifications already says so, and no notification email is attempted then.
- Per-administrator dismissal. The dismissal is instance-wide, as in the fork.
- A Prometheus gauge for failed emails. The metrics endpoint has none today (see Impact).
- Bounces after the relay accepted a mail.
- A new global permission.

## Capabilities

### New Capabilities

- `mail-failure-alert`: The administrator banner for recently failed notification emails, its status route, and its instance-wide dismissal.

### Modified Capabilities

None. `openspec/specs/` holds no capability yet.

## Impact

- Workspaces: backend and frontend. The change does not touch blocks.
- Rule file: `.claude/rules/notifications.md`. Design: `dev/specs/notifications.md`, section 12.2. The change adds a line to each about the banner.
- Backend files: `backend/api/notifications.ts`, `backend/api/schemas/notifications.ts`, `backend/models/notifications.ts`, `backend/models/auditLog.ts`, `backend/base.yml`, `backend/locales/en.json`.
- Frontend files: a new `frontend/src/components/MailAlertBanner.vue` and an edit of `frontend/src/layouts/MainLayout.vue`.
- Stored shape: the change adds one key to the `notifications` settings blob, which committed code holds. A new setting with a fixed default goes into `backend/base.yml`, which merges under the stored settings on every boot (CLAUDE.md first section). So the change adds no migration and no startup check. No table or column changes.
- Permissions: `manage:system`, a global permission, on both routes and on the banner. It is the permission of `GET /system/notifications` and of Admin, Mail today. No new permission.
- Locale keys: `admin.notifications.mailAlert.message`, `admin.notifications.mailAlert.openSettings`, `admin.notifications.mailAlert.dismiss`, `admin.notifications.mailAlert.dismissFailed`, and `admin.audit.actions.dismissMailAlert`.
- New dependencies: none.
- Verification tier: the check set plus a throwaway instance (working rule C). The banner is new UI inside the main layout shell, whose stylesheet lives elsewhere. Dismissal is a flow with real state.
- Uncommitted work in the tree: `backend/locales/en.json` carries uncommitted keys from changes 01 to 03. This change adds its keys next to their `admin.notifications.*` and `admin.audit.actions.*` neighbors and leaves those keys alone.
- The source plan names an alert rule on the Prometheus endpoint as a zero-code alternative. The code contradicts it: `backend/models/metrics.ts` exposes no gauge for notification email. That alternative needs a new gauge or an alert on the log line `Failed to send a notification email`.

## Assumptions

- The banner unit is a notification entry, as in `emailsFailed24h`. One digest mail can carry up to 50 entries, so the count can exceed the number of mails.
- An administrator is an account whose groups hold `manage:system`. An account with `access:admin` alone does not see the banner.

## Open Questions

- Go or no-go for the whole change. The user decides after the query in task 1.1. The default is no-go until the user records a go.
- Does the user accept that the dismissal is instance-wide, so one administrator hides the banner for all of them? The default is yes, as in the fork.
