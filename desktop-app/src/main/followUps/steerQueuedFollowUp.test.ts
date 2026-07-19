import { CodexSteerError } from '@janole/ai-sdk-provider-codex-asp'
import { describe, expect, it, vi } from 'vitest'

import type { CodexChatRuntimeService } from '../codexChatRuntimeService'
import type { ConversationFollowUpQueueService } from './ConversationFollowUpQueueService'
import { steerQueuedFollowUp } from './steerQueuedFollowUp'

function createFixture(): {
  queue: ConversationFollowUpQueueService
  runtime: Pick<CodexChatRuntimeService, 'steerConversation'>
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
    steerConversation: vi.fn(async () => ({ turnId: 'turn-1' }))
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

  it('returns the uncertain state when an accepted steer cannot be committed locally', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(queue.commitClaim).mockRejectedValueOnce(new Error('disk full'))

    const result = await steerQueuedFollowUp(queue, runtime, {
      conversationKey: 'conversation-1',
      itemId: 'follow-up-1'
    })

    expect(result).toMatchObject({ revision: 3 })
    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({
        status: 'paused-recovery-uncertain',
        kind: 'recovery-uncertain'
      })
    )
  })

  it('rejects instead of returning an unpersisted state when both settlement writes fail', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(queue.commitClaim).mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(queue.failClaim).mockRejectedValueOnce(new Error('disk still full'))

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('disk still full')

    expect(runtime.steerConversation).toHaveBeenCalledOnce()
    expect(queue.getState).not.toHaveBeenCalled()
  })

  it('returns an uncertain state for an in-flight transport result instead of inviting retry', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerConversation).mockRejectedValueOnce(
      new CodexSteerError('steer_result_unknown', 'result unknown')
    )

    const result = await steerQueuedFollowUp(queue, runtime, {
      conversationKey: 'conversation-1',
      itemId: 'follow-up-1'
    })

    expect(result).toMatchObject({ revision: 3 })
    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({
        status: 'paused-recovery-uncertain',
        kind: 'recovery-uncertain'
      })
    )
    expect(queue.commitClaim).not.toHaveBeenCalled()
  })

  it('rejects instead of returning an unpersisted state when unknown-result settlement fails', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerConversation).mockRejectedValueOnce(
      new CodexSteerError('steer_result_unknown', 'result unknown')
    )
    vi.mocked(queue.failClaim).mockRejectedValueOnce(new Error('disk full'))

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('disk full')

    expect(queue.getState).not.toHaveBeenCalled()
  })

  it('returns a definitely inactive preflight steer to the queue', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerConversation).mockRejectedValueOnce(
      new CodexSteerError('session_inactive', 'session inactive')
    )

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('session inactive')

    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({ status: 'queued', kind: 'turn-race' })
    )
  })

  it('returns unsupported active turn kinds to the queue', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerConversation).mockRejectedValueOnce(
      new CodexSteerError('unsupported_active_turn_kind', 'review turns cannot be steered')
    )

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow('review turns cannot be steered')

    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({ status: 'queued', kind: 'turn-race' })
    )
  })

  it('clamps persisted steer errors to the queue schema limit', async () => {
    const { queue, runtime } = createFixture()
    vi.mocked(runtime.steerConversation).mockRejectedValueOnce(new Error('x'.repeat(2_100)))

    await expect(
      steerQueuedFollowUp(queue, runtime, {
        conversationKey: 'conversation-1',
        itemId: 'follow-up-1'
      })
    ).rejects.toThrow()

    expect(queue.failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({
        userMessage: `${'x'.repeat(1_999)}…`
      })
    )
  })
})
