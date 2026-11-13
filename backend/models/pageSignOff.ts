import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  groups as groupsTable,
  pageHistory as pageHistoryTable,
  pages as pagesTable,
  pageSignOffApprovers as approversTable,
  pageSignOffs as signOffsTable,
  userGroups,
  users as usersTable
} from '../db/schema.ts'
import { CustomError } from '../helpers/common.ts'
import { isLiveNow } from '../helpers/publishing.ts'
import type { AccessActor, GroupLookup } from './groups.ts'
import type { UserLookup } from './users.ts'

/**
 * Whether a page asks named approvers to sign off each version. `review` and `approve` differ only in
 * what the page header shows: a count, or Approved once every current approver signed.
 */
export const SIGN_OFF_MODES = ['off', 'review', 'approve'] as const
export type SignOffMode = (typeof SIGN_OFF_MODES)[number]

/** What an approver says about one version. */
export const SIGN_OFF_VERDICTS = ['signed', 'changesRequested'] as const
export type SignOffVerdict = (typeof SIGN_OFF_VERDICTS)[number]

/** The most approvers, users and groups together, one page may name. */
export const MAX_SIGN_OFF_APPROVERS = 50

/** The longest comment a request for changes may carry. */
export const MAX_SIGN_OFF_COMMENT = 2000

/** How much of a comment a notification quotes, as the comment events do. */
const EXCERPT_LENGTH = 240

/** The mode and the approvers a page names, as the properties panel draws them. */
export interface PageSignOffSettings {
  mode: SignOffMode
  users: UserLookup[]
  groups: GroupLookup[]
}

/** One current approver and what they said about the version asked about. */
export interface PageSignOffEntry {
  userId: string
  name: string
  verdict: SignOffVerdict | null
  comment: string | null
  at: Date | null
  /** Whether the approver holds `read:pages` on the page, without which they cannot sign. */
  canRead: boolean
}

/** Where a page's sign-off stands, as `GET …/sign-off` answers it. */
export interface PageSignOffStatus {
  mode: SignOffMode
  /** The version the counts are about: the current one, unless an older one was asked for. */
  versionId: string | null
  isLive: boolean
  required: number
  signed: number
  changesRequested: number
  isApproved: boolean
  viewer: {
    isApprover: boolean
    verdict: SignOffVerdict | null
    canManage: boolean
    canSeeList: boolean
  }
  approvers: { users: UserLookup[]; groups: GroupLookup[] } | null
  entries: PageSignOffEntry[] | null
}

/** What the status is worked out from: a page as `pages.getPage` returns it. */
export interface SignOffPage {
  id: string
  siteId: string
  title: string
  path: string
  locale: string
  tags: string[]
  publishState: string
  publishStartDate?: Date | null
  publishEndDate?: Date | null
  signOffMode: SignOffMode
}

/** Who is asking, as the route has already settled it against the page rules. */
export interface SignOffViewer {
  userId: string | null
  /** `write:pages` or `manage:pages` on the page. */
  mayEdit: boolean
  /** `manage:pages` on the page. */
  mayManage: boolean
}

/**
 * Page sign-off model
 *
 * Who signed which version of a page. Not page content: the mode is a column `pageHistory` leaves
 * out of every version, the approvers and the verdicts are tables of their own, and none of it is
 * exported, duplicated or restored. A verdict belongs to one version, and only the verdicts on the
 * current version count, so a new version clears the status without anything being deleted.
 */
class PageSignOff {
  /**
   * The mode and the approvers a page names, with what a picker shows of each.
   *
   * An approver who can no longer be offered (an account since disabled) is left out, as
   * `pageOwners.ownershipOf` leaves one out. The row stays.
   */
  async settingsOf(pageId: string): Promise<PageSignOffSettings> {
    const [page] = await WIKI.db
      .select({ mode: pagesTable.signOffMode })
      .from(pagesTable)
      .where(eq(pagesTable.id, pageId))
    const rows = await WIKI.db
      .select({
        userId: usersTable.id,
        userName: usersTable.name,
        userHandle: usersTable.handle,
        userHasAvatar: usersTable.hasAvatar,
        groupId: groupsTable.id,
        groupName: groupsTable.name
      })
      .from(approversTable)
      .leftJoin(
        usersTable,
        and(
          eq(usersTable.id, approversTable.userId),
          eq(usersTable.isActive, true),
          eq(usersTable.isSystem, false)
        )
      )
      .leftJoin(groupsTable, eq(groupsTable.id, approversTable.groupId))
      .where(eq(approversTable.pageId, pageId))
      .orderBy(sql`coalesce(${usersTable.name}, ${groupsTable.name})`)

    const users: UserLookup[] = []
    const groups: GroupLookup[] = []
    for (const row of rows) {
      if (row.userId) {
        users.push({
          id: row.userId,
          name: row.userName ?? '',
          handle: row.userHandle ?? '',
          hasAvatar: row.userHasAvatar ?? false
        })
      } else if (row.groupId) {
        groups.push({ id: row.groupId, name: row.groupName ?? '' })
      }
    }
    return { mode: (page?.mode ?? 'off') as SignOffMode, users, groups }
  }

  /**
   * Replace a page's mode and approvers, in one transaction.
   *
   * Each id has to be somebody `users.lookup` or `groups.lookup` would offer, so an approver is never
   * a disabled account, a system account or the guests group. Records no version and leaves
   * `updatedAt` alone: none of this is page content.
   *
   * Says nothing about whether the CALLER may name these approvers: that is the route's question.
   */
  async setSettings(
    pageId: string,
    { mode, users, groups }: { mode: SignOffMode; users: string[]; groups: string[] }
  ): Promise<PageSignOffSettings> {
    const userIds = [...new Set(users)]
    const groupIds = [...new Set(groups)]
    if (userIds.length + groupIds.length > MAX_SIGN_OFF_APPROVERS) {
      throw new CustomError(
        'pageSignOffTooManyApprovers',
        `A page may have at most ${MAX_SIGN_OFF_APPROVERS} approvers.`
      )
    }
    if (userIds.length > 0) {
      const found = await WIKI.models.users.lookup({ ids: userIds, limit: userIds.length })
      if (found.length !== userIds.length) {
        throw new CustomError(
          'pageSignOffApproverInvalid',
          'Every approver must be an active user.'
        )
      }
    }
    if (groupIds.length > 0) {
      const found = await WIKI.models.groups.lookup({ ids: groupIds, limit: groupIds.length })
      if (found.length !== groupIds.length) {
        throw new CustomError(
          'pageSignOffApproverInvalid',
          'Every approver group must be a group other than Guests.'
        )
      }
    }

    await WIKI.db.transaction(async (tx) => {
      // -> The page row is what two saves of the same page's approvers queue on, as for its owners
      await tx.update(pagesTable).set({ signOffMode: mode }).where(eq(pagesTable.id, pageId))
      await tx.delete(approversTable).where(eq(approversTable.pageId, pageId))
      const rows = [
        ...userIds.map((userId) => ({ pageId, userId })),
        ...groupIds.map((groupId) => ({ pageId, groupId }))
      ]
      if (rows.length > 0) {
        await tx.insert(approversTable).values(rows)
      }
    })
    return this.settingsOf(pageId)
  }

  /**
   * Everybody who is to sign the page now: the users it names, and every member of the groups it
   * names, read at the time of asking. Active accounts that are not system accounts only, each once.
   */
  async currentApproverIds(pageId: string): Promise<string[]> {
    const result = await WIKI.db.execute(sql`
      SELECT u.id FROM (
        SELECT a."userId" AS id FROM "pageSignOffApprovers" a
        WHERE a."pageId" = ${pageId} AND a."userId" IS NOT NULL
        UNION
        SELECT ug."userId" AS id FROM "pageSignOffApprovers" a
        JOIN "userGroups" ug ON ug."groupId" = a."groupId"
        WHERE a."pageId" = ${pageId}
      ) approvers
      JOIN users u ON u.id = approvers.id AND u."isActive" AND NOT u."isSystem"
      ORDER BY u.id
    `)
    return (result.rows as { id: string }[]).map((row) => row.id)
  }

  /**
   * Where a page's sign-off stands, for this viewer.
   *
   * Counts the current approvers' verdicts on one version: the current one, which is the newest in
   * the page's history, or an older one asked for by `versionId`. Only the current version can reach
   * `isApproved`. The list of approvers and their verdicts is for whoever may edit the page and for the
   * approvers themselves; everybody else who may read the page gets the counts.
   *
   * @param summary Leave the lists out, for the page payload: the header badge needs the counts only
   */
  async statusOf(
    page: SignOffPage,
    viewer: SignOffViewer,
    { versionId, summary = false }: { versionId?: string; summary?: boolean } = {}
  ): Promise<PageSignOffStatus> {
    const currentId = await WIKI.models.pageHistory.latestVersionId(page.siteId, page.id)
    const askedId = versionId ?? currentId
    const isCurrent = askedId !== null && askedId === currentId
    const isLive = isLiveNow(page)

    const approvers = await this.approversWithVerdicts(page.id, askedId)
    const signed = approvers.filter((row) => row.verdict === 'signed').length
    const changesRequested = approvers.filter((row) => row.verdict === 'changesRequested').length
    const own = viewer.userId ? approvers.find((row) => row.userId === viewer.userId) : undefined
    const canSeeList = viewer.mayEdit || viewer.mayManage || Boolean(own)

    let entries: PageSignOffEntry[] | null = null
    let configured: PageSignOffStatus['approvers'] = null
    if (canSeeList && !summary) {
      // -> An older version lists every verdict recorded on it, including from people no longer
      //    asked; the current one lists every current approver, pending or not
      const rows = isCurrent
        ? approvers
        : [
            ...approvers.filter((row) => row.verdict !== null),
            ...(await this.formerVerdicts(page.id, askedId, approvers))
          ]
      const readable = await this.readersAmong(
        page,
        rows.map((row) => row.userId)
      )
      entries = rows.map((row) => ({ ...row, canRead: readable.has(row.userId) }))
      const settings = await this.settingsOf(page.id)
      configured = { users: settings.users, groups: settings.groups }
    }

    return {
      mode: page.signOffMode,
      versionId: askedId,
      isLive,
      required: approvers.length,
      signed,
      changesRequested,
      isApproved:
        page.signOffMode === 'approve' &&
        isCurrent &&
        page.publishState !== 'draft' &&
        approvers.length > 0 &&
        signed === approvers.length,
      viewer: {
        isApprover: Boolean(own),
        verdict: own?.verdict ?? null,
        canManage: viewer.mayManage,
        canSeeList
      },
      approvers: configured,
      entries
    }
  }

  /**
   * Record an approver's verdict on the current version, replacing any they gave it before.
   *
   * Refused with 409 when there is nothing to sign: sign-off is off, the page is a draft, it has no
   * version left (the history purge took it), or `versionId` is no longer the current version — a
   * publish landed between reading and signing. Whether the approver may read the page, and whether
   * they are an approver at all, are the route's to settle first.
   */
  async recordVerdict(
    page: SignOffPage,
    {
      versionId,
      userId,
      verdict,
      comment
    }: {
      versionId: string
      userId: string
      verdict: SignOffVerdict
      comment?: string | null
    }
  ): Promise<void> {
    if (page.signOffMode === 'off') {
      throw new CustomError('pageSignOffOff', 'This page does not ask for sign-off.', 409)
    }
    if (page.publishState === 'draft') {
      throw new CustomError('pageSignOffDraft', 'A draft cannot be signed off.', 409)
    }
    const currentId = await WIKI.models.pageHistory.latestVersionId(page.siteId, page.id)
    if (!currentId) {
      throw new CustomError('pageSignOffNoVersion', 'This page has no version to sign off.', 409)
    }
    if (currentId !== versionId) {
      throw new CustomError(
        'pageSignOffStale',
        'A newer version of this page was published. Read it, then sign off again.',
        409
      )
    }
    const text = verdict === 'changesRequested' ? (comment ?? '').trim() : null
    if (verdict === 'changesRequested' && !text) {
      throw new CustomError('pageSignOffCommentMissing', 'Say what needs to change.')
    }
    if (text && text.length > MAX_SIGN_OFF_COMMENT) {
      throw new CustomError(
        'pageSignOffCommentTooLong',
        `A comment may be at most ${MAX_SIGN_OFF_COMMENT} characters.`
      )
    }

    await WIKI.db
      .insert(signOffsTable)
      .values({ pageId: page.id, versionId, userId, verdict, comment: text })
      .onConflictDoUpdate({
        target: [signOffsTable.versionId, signOffsTable.userId],
        set: { verdict, comment: text, createdAt: sql`now()` }
      })

    if (verdict === 'changesRequested' && text) {
      const [version] = await WIKI.db
        .select({ authorId: pageHistoryTable.authorId })
        .from(pageHistoryTable)
        .where(eq(pageHistoryTable.id, versionId))
      await WIKI.models.notifications.emit('page:signOffChanges', {
        siteId: page.siteId,
        actorId: userId,
        data: {
          variant: 'requested',
          page: WIKI.models.notifications.pageSnapshot(page),
          versionId,
          versionAuthorId: version?.authorId ?? null,
          excerpt: WIKI.models.comments.excerptOf(text, EXCERPT_LENGTH)
        }
      })
    }
  }

  /**
   * After a version was recorded, by a save, a move or an import: ask the approvers to sign it.
   *
   * Nothing to ask for sign-off off, for no version, or for a page that is not live right now — a
   * draft is not a publish, and a scheduled page outside its window is seen by nobody it would
   * notify. No event fires when such a window opens later.
   */
  async versionRecorded(
    siteId: string,
    page: SignOffPage,
    versionId: string | null,
    actor: { id: string }
  ): Promise<void> {
    if (page.signOffMode === 'off' || !versionId || !isLiveNow(page)) {
      return
    }
    await WIKI.models.notifications.emit('page:signOffRequest', {
      siteId,
      actorId: actor.id,
      data: {
        variant: 'requested',
        page: WIKI.models.notifications.pageSnapshot(page),
        versionId
      }
    })
  }

  /** The current approvers, by name, with their verdict on one version. */
  private async approversWithVerdicts(
    pageId: string,
    versionId: string | null
  ): Promise<Omit<PageSignOffEntry, 'canRead'>[]> {
    const ids = await this.currentApproverIds(pageId)
    if (ids.length < 1) {
      return []
    }
    const rows = await WIKI.db
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        verdict: signOffsTable.verdict,
        comment: signOffsTable.comment,
        at: signOffsTable.createdAt
      })
      .from(usersTable)
      .leftJoin(
        signOffsTable,
        and(
          eq(signOffsTable.userId, usersTable.id),
          eq(signOffsTable.pageId, pageId),
          versionId ? eq(signOffsTable.versionId, versionId) : sql`false`
        )
      )
      .where(inArray(usersTable.id, ids))
      .orderBy(usersTable.name)
    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      verdict: (row.verdict as SignOffVerdict | null) ?? null,
      comment: row.comment ?? null,
      at: row.at ?? null
    }))
  }

  /** The verdicts on an older version from people who are no longer approvers. */
  private async formerVerdicts(
    pageId: string,
    versionId: string | null,
    current: { userId: string }[]
  ): Promise<Omit<PageSignOffEntry, 'canRead'>[]> {
    if (!versionId) {
      return []
    }
    const held = new Set(current.map((row) => row.userId))
    const rows = await WIKI.db
      .select({
        userId: signOffsTable.userId,
        name: usersTable.name,
        verdict: signOffsTable.verdict,
        comment: signOffsTable.comment,
        at: signOffsTable.createdAt
      })
      .from(signOffsTable)
      .innerJoin(usersTable, eq(usersTable.id, signOffsTable.userId))
      .where(and(eq(signOffsTable.pageId, pageId), eq(signOffsTable.versionId, versionId)))
      .orderBy(usersTable.name)
    return rows
      .filter((row) => !held.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        verdict: row.verdict as SignOffVerdict,
        comment: row.comment ?? null,
        at: row.at
      }))
  }

  /**
   * Which of these users hold `read:pages` on the page, from their groups as they stand now. One
   * query for all of them, since the list is at most a few groups' worth of people.
   */
  private async readersAmong(page: SignOffPage, userIds: string[]): Promise<Set<string>> {
    if (userIds.length < 1) {
      return new Set()
    }
    const rows = await WIKI.db
      .select({
        userId: userGroups.userId,
        groupId: groupsTable.id,
        permissions: groupsTable.permissions
      })
      .from(userGroups)
      .innerJoin(groupsTable, eq(groupsTable.id, userGroups.groupId))
      .where(inArray(userGroups.userId, userIds))
    const actors = new Map<string, AccessActor>()
    for (const row of rows) {
      const actor = actors.get(row.userId) ?? { groupIds: [], permissions: [] }
      actor.groupIds.push(row.groupId)
      for (const permission of (row.permissions ?? []) as string[]) {
        if (!actor.permissions.includes(permission)) {
          actor.permissions.push(permission)
        }
      }
      actors.set(row.userId, actor)
    }
    const ref = { siteId: page.siteId, path: page.path, locale: page.locale, tags: page.tags }
    const readable = new Set<string>()
    for (const [userId, actor] of actors) {
      if (WIKI.models.groups.checkAccess(actor, 'read:pages', ref)) {
        readable.add(userId)
      }
    }
    return readable
  }
}

export const pageSignOff = new PageSignOff()
