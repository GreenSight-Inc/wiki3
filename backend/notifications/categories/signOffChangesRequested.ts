import { versionAuthorAndOwnersOf } from '../recipients.ts'
import { snapshotOf } from '../snapshot.ts'
import type { NotificationCategory } from '../types.ts'

/**
 * An approver asked for changes to a version the recipient saved, or to a page they own. The start
 * of the approver's comment travels as the excerpt, since it is what says what to change.
 */
export const signOffChangesRequested: NotificationCategory = {
  key: 'signOffChangesRequested',
  section: 'reviews',
  events: ['page:signOffChanges'],
  scope: 'site',
  origins: ['user'],
  defaults: { inApp: true, email: true },
  priority: 31,
  recipients: versionAuthorAndOwnersOf,
  access: 'read:pages',
  groupKey: (event) => `signOffChanges:${event.data.page!.id}`,
  entry: (event) => ({
    variant: event.data.variant,
    pageId: event.data.page!.id,
    data: snapshotOf(event)
  })
}
