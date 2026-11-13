import { SIGN_OFF_MODES, SIGN_OFF_VERDICTS } from '../../models/pageSignOff.ts'
import type { FastifyInstance } from 'fastify'

export async function registerSchemas(app: FastifyInstance): Promise<void> {
  /**
   * PAGE SIGN-OFF APPROVER - A user or a group a page asks to sign off
   */
  app.addSchema({
    $id: 'PageSignOffApprover',
    type: 'object',
    description:
      'A user or a group named as an approver: what a picker shows of it, and never an email address. `handle` and `hasAvatar` are for a user only.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      handle: { type: 'string' },
      hasAvatar: { type: 'boolean' }
    }
  })

  /**
   * PAGE SIGN-OFF ENTRY - One approver and their verdict on one version
   */
  app.addSchema({
    $id: 'PageSignOffEntry',
    type: 'object',
    description:
      'One approver and what they said about the version asked about. `verdict`, `comment` and `at` are null while they have said nothing. `canRead` is false for an approver without `read:pages` on the page, who cannot sign it and stays pending.',
    properties: {
      userId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      verdict: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...SIGN_OFF_VERDICTS] }] },
      comment: { type: ['string', 'null'] },
      at: { type: ['string', 'null'], format: 'date-time' },
      canRead: { type: 'boolean' }
    }
  })

  /**
   * PAGE SIGN-OFF STATUS - Where a page's sign-off stands
   */
  app.addSchema({
    $id: 'PageSignOffStatus',
    type: 'object',
    description:
      'Where the sign-off of a page stands. The counts are the current approvers’ verdicts on `versionId`, which is the current version unless an older one was asked for. Only the current version is ever approved. `approvers` and `entries` are null for a reader who may not see who the approvers are.',
    properties: {
      mode: { type: 'string', enum: [...SIGN_OFF_MODES] },
      versionId: { type: ['string', 'null'], format: 'uuid' },
      isLive: { type: 'boolean' },
      required: { type: 'integer' },
      signed: { type: 'integer' },
      changesRequested: { type: 'integer' },
      isApproved: { type: 'boolean' },
      viewer: {
        type: 'object',
        properties: {
          isApprover: { type: 'boolean' },
          verdict: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...SIGN_OFF_VERDICTS] }] },
          canManage: { type: 'boolean' },
          canSeeList: { type: 'boolean' }
        }
      },
      approvers: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              users: { type: 'array', items: { $ref: 'PageSignOffApprover#' } },
              groups: { type: 'array', items: { $ref: 'PageSignOffApprover#' } }
            }
          }
        ]
      },
      entries: {
        anyOf: [{ type: 'null' }, { type: 'array', items: { $ref: 'PageSignOffEntry#' } }]
      }
    }
  })
}
