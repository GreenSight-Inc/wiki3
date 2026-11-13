---
paths:
  - "backend/models/pageSignOff.ts"
  - "backend/api/pageSignOff.ts"
  - "backend/api/schemas/pageSignOff.ts"
  - "backend/notifications/categories/signOff*.ts"
  - "frontend/src/components/PageSignOffDialog.vue"
---

# Page sign-off

Named approvers sign off each version of a page, set in the **Sign-off** section of its properties
panel. `models/pageSignOff.ts`, `api/pageSignOff.ts`; on the frontend `PageSignOffDialog.vue`, the
badge in `PageHeader.vue` and the section in `PagePropertiesDialog.vue`. Not approval rules or edit
suggestions (`models/approvals.ts`), which decide who publishes: a sign-off records agreement with
what was published, after the fact, and never holds a save back.

- **The stored shape.** `pages.signOffMode` (`off`, `review` or `approve`, default `off`),
  `pageSignOffApprovers` (users and groups, mixed on one page, at most 50) and `pageSignOffs` (one
  verdict per approver per version, `signed` or `changesRequested` with a comment). Added by the
  migration `page-sign-off`. `review` and `approve` differ only in what the header shows.
- **A verdict belongs to one version.** The current version is `pageHistory.latestVersionId`, and
  the status counts only the verdicts on it. A new version of any kind (a save, a move, an import)
  clears the status by being newer, and nothing is deleted. `pageSignOffs.versionId` has no foreign
  key, so the verdicts on an older version stay readable through `GET …/sign-off?versionId=`.
- **The current approvers are read at each check**: the users named plus every member of the groups
  named, active and not system accounts, each once (`currentApproverIds`, and `approversOf` for the
  fan-out). A new member of a group is pending at once. An empty set is never approved.
- **The history purge** can delete every version of a page that nobody edited. The page then has no
  current version: the status says so, the badge is not approved, and every verdict answers 409 until
  the next save records a version.
- **Not page content.** `signOffMode` is in `EXCLUDED_FROM_META` and `NOT_REPORTED_AS_CHANGED`
  (`models/pageHistory.ts`), so no version carries it and a restore never switches sign-off on or
  off. `restorePage` writes explicit columns, so a restored page starts at `off` with no approvers.
  Storage export and duplication leave all of it out.
- **`versionRecorded` is the one hook after a version**, called from `updatePage` and `movePage`
  beside their notification emits. It asks for sign-off only while the mode is not `off` and the page
  is live now (`isLiveNow` in `helpers/publishing.ts`, the twin of `liveCondition`). A scheduled page
  whose window opens later sends nothing.

## Permissions

| Act | Permission | Kind | Where checked |
| --- | --- | --- | --- |
| Set mode and approvers | `manage:pages` on the page | page rule | handler, `mayOnPage` |
| Name a user not yet an approver | a `LIST_USERS_PERMISSIONS` rung or `manage:system` | global | handler, `actor.permissions` |
| Name a group not yet an approver | a `LIST_GROUPS_PERMISSIONS` rung or `manage:system` | global | handler, `actor.permissions` |
| Read the status and counts | `read:pages` on the page, plus `unpublishedFor(req)` | page rule | handler |
| See names and verdicts | `write:pages` or `manage:pages` on the page, or a current approver | page rule | model, from the route's viewer |
| Record a verdict | signed in, a current approver, `read:pages` on the page | page rule | handler |
| Receive either notification | `read:pages` on the page | page rule | fan-out, category `access` |

- **409 for a verdict on anything but the current version**, and for mode `off`, a draft, or no
  version at all. The verdict carries the `versionId` the approver read, which closes the race with a
  publish landing in between.
- **423 for `PUT …/sign-off` on a page locked against edits** (`pages.assertEditable`, after the
  permission check). A verdict goes through regardless of the lock, since it changes nothing the lock
  holds.
- An approver without `read:pages` stays in the required set as pending, marked `canRead: false` in
  the list, and gets no notification. The audit entries carry the page and the version, never the
  comment. No response carries an email address.

## Notifications

`signOffRequested` (`page:signOffRequest`, origins `user` and `import`, recipients `approversOf`) and
`signOffChangesRequested` (`page:signOffChanges`, origin `user`, recipients
`versionAuthorAndOwnersOf`: the author of the version, carried as `data.versionAuthorId`, plus the
page owners). Both are in the `reviews` section, both check `read:pages`, both coalesce per page, and
the start of the comment travels as `excerpt`.
