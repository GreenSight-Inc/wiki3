import { approversOf } from '../recipients.ts'
import { snapshotOf } from '../snapshot.ts'
import type { NotificationCategory } from '../types.ts'

/**
 * A page the recipient signs off has a new version, saved, moved or imported while the page is live.
 *
 * Coalesced per page, so several publishes before the approver looks are one entry. The approver
 * still has to hold `read:pages` on the page: one who cannot read it cannot sign it either, and is
 * told nothing. Whoever made the change is left out by the fan-out, as for every category.
 */
export const signOffRequested: NotificationCategory = {
  key: 'signOffRequested',
  section: 'reviews',
  events: ['page:signOffRequest'],
  scope: 'site',
  origins: ['user', 'import'],
  defaults: { inApp: true, email: true },
  priority: 32,
  recipients: approversOf,
  access: 'read:pages',
  groupKey: (event) => `signOff:${event.data.page!.id}`,
  entry: (event) => ({
    variant: event.data.variant,
    pageId: event.data.page!.id,
    data: snapshotOf(event)
  })
}
