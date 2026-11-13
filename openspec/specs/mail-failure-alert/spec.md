# mail-failure-alert Specification

## Purpose
Tells every administrator, on every page of the wiki, that notification emails failed recently, until one administrator dismisses the alert.

## Requirements

### Requirement: Recent mail failure status route
The wiki SHALL answer `GET /_api/system/notifications/mail-alert` for a caller who holds `manage:system`. The response SHALL be `{ failedCount, dismissedAt }`. `failedCount` SHALL count the notification entries given up on in the last 24 hours. It SHALL use the rule of the failed count on Admin, Notifications. It SHALL leave out entries last updated before the last dismissal. `dismissedAt` SHALL be the time of the last dismissal or null.

#### Scenario: Failures in the last day
- **WHEN** three notification entries reached the failed state within the last 24 hours and nobody dismissed the alert
- **THEN** the route answers 200 with `failedCount` 3 and `dismissedAt` null

#### Scenario: Old failures only
- **WHEN** the only failed entries were last updated more than 24 hours ago
- **THEN** the route answers 200 with `failedCount` 0

#### Scenario: Failures before the dismissal
- **WHEN** an administrator dismissed the alert after the last failed entry was last updated
- **THEN** the route answers 200 with `failedCount` 0 and `dismissedAt` set to the dismissal time

#### Scenario: Caller without the permission
- **WHEN** a signed-in caller without `manage:system` or a guest calls the route
- **THEN** the wiki refuses the request with the error the permission hook gives for a missing global permission, and the body holds no count

#### Scenario: Personal access token
- **WHEN** a caller sends a personal access token to the route
- **THEN** the bearer hook refuses the token, because the route declares no token scope

### Requirement: Instance-wide dismissal
The wiki SHALL answer `POST /_api/system/notifications/mail-alert/dismiss` for a caller who holds `manage:system`. It SHALL store the current server time as the dismissal time for the whole instance. It SHALL answer `{ ok: true, message }`. It SHALL record the action `dismissMailAlert` of kind `admin` in the audit log. A caller without `manage:system` SHALL receive the error of the permission hook, and the dismissal time SHALL stay unchanged.

#### Scenario: Administrator dismisses the alert
- **WHEN** an administrator calls the dismiss route
- **THEN** the route answers 200 with `ok` true and the audit log holds one `dismissMailAlert` entry
- **AND** the status route answers `failedCount` 0 for every administrator

#### Scenario: A failure after the dismissal
- **WHEN** a notification entry last updated after the dismissal reaches the failed state
- **THEN** the status route counts it again

#### Scenario: Caller without the permission
- **WHEN** a caller without `manage:system` calls the dismiss route
- **THEN** the wiki refuses the request and the stored dismissal time does not change

#### Scenario: Installation on the earlier commit
- **WHEN** an installation on the commit before this change boots on this change
- **THEN** the dismissal time reads as null with no migration, and the status route counts every failed entry of the last 24 hours

### Requirement: Mail failure banner in the main layout
The main layout SHALL show a red banner to a reader who holds `manage:system` when the status route answers a `failedCount` above zero. The banner SHALL state the count, link to Admin, Notifications, and offer a Dismiss button. The banner SHALL look the same in light mode and in dark mode. The admin area, the profile, and the other layouts SHALL NOT show it.

#### Scenario: Administrator with recent failures
- **WHEN** an administrator opens a page while the status route answers `failedCount` 5
- **THEN** the banner shows the count 5, a link to Admin, Notifications, and a Dismiss button

#### Scenario: Administrator dismisses from the banner
- **WHEN** the administrator clicks Dismiss and the dismiss route answers 200
- **THEN** the banner disappears at once and stays hidden on the next page load

#### Scenario: Dismiss fails
- **WHEN** the dismiss route answers an error
- **THEN** the banner stays and the wiki shows an error message

#### Scenario: No recent failures
- **WHEN** the status route answers `failedCount` 0
- **THEN** no banner shows

#### Scenario: Reader without the permission
- **WHEN** a guest, an ordinary user, or an account with `access:admin` alone opens a page
- **THEN** no banner shows and the browser sends no request to the status route

#### Scenario: Status route fails
- **WHEN** the status route answers an error or does not answer
- **THEN** no banner shows and the page renders as usual

### Requirement: No secret in the alert
The two routes, the audit entry, and the banner SHALL NOT carry a recipient address, a mail server credential, or any other secret. The change SHALL add no secret to a tracked file.

#### Scenario: Response content
- **WHEN** an administrator reads the status route response or the `dismissMailAlert` audit entry
- **THEN** it holds only the count, the dismissal time, and the fixed message, and no address or credential
