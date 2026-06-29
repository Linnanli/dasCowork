import { describe, expect, it } from 'vitest'

import type { CodexApprovalResponse } from '../../shared/codexIpcApi'
import { ApprovalCoordinator, type ApprovalDispatch } from './ApprovalCoordinator'

describe('ApprovalCoordinator', () => {
  it('approves using approval thread context, not active project', async () => {
    const sentApprovals: ApprovalDispatch[] = []
    const coordinator = new ApprovalCoordinator({
      activeProjectCwd: '/other',
      sendApproval: async (approval) => {
        sentApprovals.push(approval)
      }
    })

    coordinator.registerApproval({
      id: 'approval_1',
      kind: 'command',
      createdAt: '2026-06-29T00:00:00.000Z',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        hostId: 'local',
        cwd: '/repo'
      }
    })

    await coordinator.approve('approval_1')

    expect(sentApprovals[0]).toMatchObject({
      id: 'approval_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      hostId: 'local',
      cwd: '/repo'
    })
  })

  it('preserves approval context when dispatching explicit responses', async () => {
    let sentApproval: ApprovalDispatch | undefined
    const coordinator = new ApprovalCoordinator({
      sendApproval: async (approval) => {
        sentApproval = approval
      }
    })
    const response: CodexApprovalResponse = { action: 'decline', reason: 'Nope' }

    const request = coordinator.registerApproval({
      id: 'approval_2',
      kind: 'file-change',
      createdAt: '2026-06-29T00:00:00.000Z',
      params: {
        threadId: 'thread_2',
        turnId: 'turn_2',
        hostId: 'local',
        grantRoot: '/workspace'
      }
    })
    await coordinator.respond('approval_2', response)

    expect(request.context).toMatchObject({ cwd: '/workspace' })
    expect(sentApproval).toMatchObject({
      id: 'approval_2',
      cwd: '/workspace',
      response
    })
  })
})
