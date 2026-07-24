import { describe, expect, it, vi } from 'vitest'

import type { CodexChatRuntimeService } from '../codexChatRuntimeService'
import type { ConversationFollowUpQueueService } from './ConversationFollowUpQueueService'
import { steerQueuedFollowUp } from './steerQueuedFollowUp'

function createFixture(): {
  queue: ConversationFollowUpQueueService
  runtime: Pick<CodexChatRuntimeService, 'steerClaimedFollowUp'>
} {
  const item = {
    id: 'follow-up-1',
    conversationKey: 'conversation-1',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    preferredMode: 'steer' as const,
    message: {
      id: 'follow-up-1',
      text: 'change direction',
      attachments: [],
      contextReferences: [],
      trustedContext: {
        conversationId: 'conversation-1',
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo']
      }
    },
    status: 'steering' as const,
    lease: {
      token: 'lease-1',
      operation: 'turn-steer' as const,
      claimedAt: '2026-07-18T00:00:00.000Z',
      owner: 'main'
    }
  }
  const state = {
    version: 2 as const,
    revision: 2,
    conversationKey: 'conversation-1',
    defaultMode: 'queue' as const,
    archived: false,
    items: [item]
  }
  const queue = {
    claimItemForSteer: vi.fn(async () => ({
      conversationKey: 'conversation-1',
      item,
      leaseToken: 'lease-1'
    })),
    materializeClaimMessage: vi.fn(async () => ({
      id: item.id,
      parts: [{ type: 'text' as const, text: item.message.text }],
      contextReferences: [],
      trustedContext: item.message.trustedContext
    })),
    getState: vi.fn(async () => state),
    commitClaim: vi.fn(async () => ({ ...state, revision: 3, items: [] })),
    failClaim: vi.fn(async () => ({ ...state, revision: 3 }))
  } as unknown as ConversationFollowUpQueueService
  const runtime = {
    steerClaimedFollowUp: vi.fn(async () => ({ turnId: 'turn-1' }))
  }
  return { queue, runtime }
}

describe('steerQueuedFollowUp', () => {
  it('claims the explicitly selected item instead of implicitly claiming the head', async () => {
    const { queue, runtime } = createFixture()

    await steerQueuedFollowUp(queue, runtime, {
      conversationKey: 'conversation-1',
      itemId: 'follow-up-1'
    })

    expect(queue.claimItemForSteer).toHaveBeenCalledWith('conversation-1', 'follow-up-1')
  })

  it('keeps the queue claim leased until a canonical user message acknowledges it', async () => {
    const { queue, runtime } = createFixture()

    const result = await steerQueuedFollowUp(queue, runtime, {
      conversationKey: 'conversation-1',
      itemId: 'follow-up-1'
    })

    expect(result).toMatchObject({
      delivery: 'pending-ack',
      clientUserMessageId: 'follow-up-1',
      targetTurnId: 'turn-1'
    })
    expect(runtime.steerClaimedFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ leaseToken: 'lease-1' }),
      expect.objectContaining({ id: 'follow-up-1', role: 'user' })
    )
    expect(queue.commitClaim).not.toHaveBeenCalled()
    expect(queue.failClaim).not.toHaveBeenCalled()
    expect(queue.getState).not.toHaveBeenCalled()
  })

  it('does not settle the lease again when the runtime rejects after taking ownership', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerClaimedFollowUp).mockRejectedValueOnce(new Error('turn ended'))

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('turn ended')

    expect(queue.failClaim).not.toHaveBeenCalled()
    expect(queue.commitClaim).not.toHaveBeenCalled()
    expect(queue.getState).not.toHaveBeenCalled()
  })

  it('returns materialization failures to the queue before runtime ownership begins', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(queue.materializeClaimMessage).mockRejectedValueOnce(new Error('asset missing'))

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('asset missing')

    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({ kind: 'attachment-unavailable' })
    )
    expect(runtime.steerClaimedFollowUp).not.toHaveBeenCalled()
  })
})
