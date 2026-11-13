import { audit } from '../helpers/audit.ts'
import { LIST_GROUPS_PERMISSIONS, LIST_USERS_PERMISSIONS } from '../models/groups.ts'
import {
  MAX_SIGN_OFF_APPROVERS,
  MAX_SIGN_OFF_COMMENT,
  SIGN_OFF_MODES,
  SIGN_OFF_VERDICTS
} from '../models/pageSignOff.ts'
import { actorFrom, mayOnPage, unpublishedFor, userRequired } from './pages.ts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Page } from '../models/pages.ts'
import type { SignOffMode, SignOffVerdict, SignOffViewer } from '../models/pageSignOff.ts'

const pageParams = {
  type: 'object',
  properties: {
    siteId: { type: 'string', format: 'uuid' },
    pageId: { type: 'string', format: 'uuid' }
  },
  required: ['siteId', 'pageId']
}

/** Who is asking, settled against the page rules of this page. */
function viewerOf(req: FastifyRequest, page: Page): SignOffViewer {
  const mayManage = mayOnPage(req, 'manage:pages', page)
  return {
    userId: actorFrom(req)?.id ?? null,
    mayEdit: mayManage || mayOnPage(req, 'write:pages', page),
    mayManage
  }
}

/**
 * Page Sign-off API Routes
 *
 * Who is asked to sign off each version of a page, and what they said. Not page content: a save
 * never carries it and no version records it. The page payload carries a summary for the header
 * badge (`signOff`); the lists are read here. See `.claude/rules/page-sign-off.md`.
 */
async function routes(app: FastifyInstance) {
  /**
   * GET PAGE SIGN-OFF STATUS
   */
  app.get<{
    Params: { siteId: string; pageId: string }
    Querystring: { versionId?: string }
  }>(
    '/sites/:siteId/pages/:pageId/sign-off',
    {
      config: {
        scope: 'pages'
      },
      /*
        No route-level `permissions`: reading the status takes `read:pages` on the page, and the list
        of approvers `write:pages` or `manage:pages` on it, or being an approver -- page rules, which
        the group-wide list that hook reads cannot answer.
      */
      schema: {
        summary: "Get a page's sign-off status",
        description:
          'Where the sign-off of a page stands: its mode, the current version, the counts of required, signed and changes-requested approvers, whether it is approved, and where the requester stands.\n\nNeeds `read:pages` on the page, and a page that is not live is answered as missing to whoever may not edit it. The approvers and their verdicts are listed only for a requester holding `write:pages` or `manage:pages` on the page, or one of its current approvers; null for anybody else.\n\n`versionId` asks about an older version instead: the verdicts recorded on it, which stay after a new version clears the status.',
        tags: ['Pages'],
        params: pageParams,
        querystring: {
          type: 'object',
          properties: {
            versionId: { type: 'string', format: 'uuid' }
          }
        },
        response: {
          200: { $ref: 'PageSignOffStatus#' }
        }
      }
    },
    async (req, reply) => {
      const page = await WIKI.models.pages.getPage({
        siteId: req.params.siteId,
        id: req.params.pageId,
        unpublished: unpublishedFor(req)
      })
      // -> Not there, rather than refused: whether a page exists is not news to somebody who cannot read it
      if (!page || !mayOnPage(req, 'read:pages', page)) {
        return reply.notFound('This page does not exist.')
      }
      return WIKI.models.pageSignOff.statusOf(page, viewerOf(req, page), {
        versionId: req.query.versionId
      })
    }
  )

  /**
   * SET PAGE SIGN-OFF
   */
  app.put<{
    Params: { siteId: string; pageId: string }
    Body: { mode: SignOffMode; users?: string[]; groups?: string[] }
  }>(
    '/sites/:siteId/pages/:pageId/sign-off',
    {
      config: {
        scope: 'pages'
      },
      /*
        No route-level `permissions`: who may change a page's sign-off is whoever may manage the page,
        which is a page rule and not something the group-wide list that hook reads can answer.
      */
      schema: {
        summary: "Set a page's sign-off mode and approvers",
        description:
          'Replaces the sign-off mode of a page and its approvers: users and groups, together at most 50. A group stands for every one of its members at the time of each check.\n\nNeeds `manage:pages` on the page. Naming a user who is not an approver yet needs `list:users` (or `read:users`, `write:users`, `manage:users`) as well, and naming a new group `list:groups` (or `read:groups`, `write:groups`, `manage:groups`). Keeping or removing an approver needs neither.\n\nAn approver must be an active user, or a group other than Guests. Refused with 423 while the page is locked against edits. Records no page version.',
        tags: ['Pages'],
        params: pageParams,
        body: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: [...SIGN_OFF_MODES] },
            users: {
              type: 'array',
              maxItems: MAX_SIGN_OFF_APPROVERS,
              items: { type: 'string', format: 'uuid' }
            },
            groups: {
              type: 'array',
              maxItems: MAX_SIGN_OFF_APPROVERS,
              items: { type: 'string', format: 'uuid' }
            }
          }
        },
        response: {
          200: {
            description: "The page's sign-off as it now stands",
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              signOff: { $ref: 'PageSignOffStatus#' }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const actor = actorFrom(req)
      if (!actor) {
        return reply.unauthorized(userRequired(req, "Changing a page's sign-off"))
      }
      const page = await WIKI.models.pages.getPage({
        siteId: req.params.siteId,
        id: req.params.pageId
      })
      if (!page) {
        return reply.notFound('This page does not exist.')
      }
      if (!mayOnPage(req, 'manage:pages', page)) {
        return reply.forbidden('You are not allowed to manage this page.')
      }
      // -> Who signs it off is among its properties, which a lock holds as it holds the page itself
      WIKI.models.pages.assertEditable(page)

      const users = [...new Set(req.body.users ?? [])]
      const groups = [...new Set(req.body.groups ?? [])]
      if (users.length + groups.length > MAX_SIGN_OFF_APPROVERS) {
        return reply.badRequest(`A page may have at most ${MAX_SIGN_OFF_APPROVERS} approvers.`)
      }
      /*
        Naming somebody takes being able to find them. Compared against the approvers the page has,
        per kind, so that somebody who cannot look users up can still keep or remove the ones there.
      */
      const current = await WIKI.models.pageSignOff.settingsOf(page.id)
      const mayList = (needed: string[]) =>
        ['manage:system', ...needed].some((permission) => actor.permissions.includes(permission))
      const heldUsers = new Set(current.users.map((user) => user.id))
      const heldGroups = new Set(current.groups.map((group) => group.id))
      if (users.some((id) => !heldUsers.has(id)) && !mayList(LIST_USERS_PERMISSIONS)) {
        return reply.forbidden(
          'You are not allowed to look up users, so you cannot name them as approvers.'
        )
      }
      if (groups.some((id) => !heldGroups.has(id)) && !mayList(LIST_GROUPS_PERMISSIONS)) {
        return reply.forbidden(
          'You are not allowed to look up groups, so you cannot name them as approvers.'
        )
      }

      const settings = await WIKI.models.pageSignOff.setSettings(page.id, {
        mode: req.body.mode,
        users,
        groups
      })

      await audit(req, 'page', 'updatePageSignOff', {
        pageId: page.id,
        siteId: req.params.siteId,
        locale: page.locale,
        path: page.path,
        mode: settings.mode
      })

      const signOff = await WIKI.models.pageSignOff.statusOf(
        { ...page, signOffMode: settings.mode },
        viewerOf(req, page)
      )
      return { ok: true, signOff }
    }
  )

  /**
   * RECORD A SIGN-OFF VERDICT
   */
  app.post<{
    Params: { siteId: string; pageId: string }
    Body: { versionId: string; verdict: SignOffVerdict; comment?: string }
  }>(
    '/sites/:siteId/pages/:pageId/sign-off/verdict',
    {
      config: {
        scope: 'pages'
      },
      /*
        No route-level `permissions`: a verdict takes `read:pages` on the page and being one of its
        current approvers, neither of which the group-wide list that hook reads can answer.
      */
      schema: {
        summary: 'Sign off a version of a page, or ask for changes',
        description:
          'Records the requester’s verdict on the current version of a page: `signed`, or `changesRequested` with a comment of 1 to 2000 characters, which tells the author of that version and the page’s owners. A second verdict on the same version replaces the first.\n\nNeeds a signed-in requester (or a personal access token) who is a current approver and holds `read:pages` on the page; a page that is not live is answered as missing to whoever may not edit it. Refused with 409 when sign-off is off, the page is a draft, it has no version, or `versionId` is not the current version. A lock against edits does not refuse a verdict.',
        tags: ['Pages'],
        params: pageParams,
        body: {
          type: 'object',
          required: ['versionId', 'verdict'],
          properties: {
            versionId: { type: 'string', format: 'uuid' },
            verdict: { type: 'string', enum: [...SIGN_OFF_VERDICTS] },
            comment: { type: 'string', maxLength: MAX_SIGN_OFF_COMMENT }
          }
        },
        response: {
          200: {
            description: "The page's sign-off after the verdict",
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              signOff: { $ref: 'PageSignOffStatus#' }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const actor = actorFrom(req)
      if (!actor) {
        return reply.unauthorized(userRequired(req, 'Signing off a page'))
      }
      const page = await WIKI.models.pages.getPage({
        siteId: req.params.siteId,
        id: req.params.pageId,
        unpublished: unpublishedFor(req)
      })
      if (!page || !mayOnPage(req, 'read:pages', page)) {
        return reply.notFound('This page does not exist.')
      }
      // -> Before the approver check: with sign-off off there is nobody to be one
      if (page.signOffMode === 'off') {
        return reply.conflict('This page does not ask for sign-off.')
      }
      const approverIds = await WIKI.models.pageSignOff.currentApproverIds(page.id)
      if (!approverIds.includes(actor.id)) {
        return reply.forbidden('You are not one of the approvers of this page.')
      }
      /*
        No `assertEditable`: a verdict records agreement with a version and changes nothing about the
        page, so a lock against edits does not hold it back.
      */
      const { versionId, verdict, comment } = req.body
      await WIKI.models.pageSignOff.recordVerdict(page, {
        versionId,
        userId: actor.id,
        verdict,
        comment
      })

      // -> The version, never the comment: `meta` carries identity, not content
      await audit(req, 'page', verdict === 'signed' ? 'signOffPage' : 'requestSignOffChanges', {
        pageId: page.id,
        siteId: req.params.siteId,
        locale: page.locale,
        path: page.path,
        versionId
      })

      const signOff = await WIKI.models.pageSignOff.statusOf(page, viewerOf(req, page))
      return { ok: true, signOff }
    }
  )
}

export default routes
