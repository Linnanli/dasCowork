import { describe, expect, it } from 'vitest'

import { createVitestPlanAssertionRecorder } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  FOLLOW_UP_QUEUE_STATE_VERSION,
  FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM,
  FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS,
  FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION,
  FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES,
  followUpBeginEditResultSchema,
  followUpCommitEditPayloadSchema,
  followUpEnqueuePayloadSchema,
  followUpAssetInputSchema,
  followUpPersistedAssetSchema,
  followUpReorderPayloadSchema,
  followUpSteerItemPayloadSchema,
  queuedFollowUpItemSchema,
  queuedUserMessageSnapshotInputSchema
} from './codexFollowUpApi'

const { planAssert } = createVitestPlanAssertionRecorder(expect)

const snapshot = {
  id: 'message-1',
  text: 'continue',
  attachments: [],
  contextReferences: [],
  trustedContext: {
    conversationId: 'conversation-1',
    hostId: 'local',
    cwd: '/repo',
    workspaceRoots: ['/repo']
  }
}

describe('codex follow-up API schemas', () => {
  it('uses the v2 queue contract with a persistent editing state', () => {
    expect(FOLLOW_UP_QUEUE_STATE_VERSION).toBe(2)
    expect(
      queuedFollowUpItemSchema.safeParse({
        id: 'message-1',
        conversationKey: 'conversation-1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        preferredMode: 'queue',
        message: snapshot,
        status: 'editing',
        edit: {
          previousStatus: 'paused-interrupted',
          previousPause: {
            kind: 'interrupted',
            userMessage: 'Paused by interruption.'
          },
          begunAt: '2026-07-18T00:00:00.000Z'
        }
      }).success
    ).toBe(true)
  })

  it('G10/E24/E25 locks the initial queue capacity limits', () => {
    expect(FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION).toBe(20)
    expect(FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM).toBe(10 * 1024 * 1024)
    expect(FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES).toBe(50 * 1024 * 1024)
  })

  it.each([
    ['limit - 1', FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS - 1, true],
    ['limit', FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS, true],
    ['limit + 1', FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS + 1, false]
  ] as const)(
    'E25 validates encoded attachment size at %s before crossing IPC',
    async (_boundary, encodedLength, expected) => {
      const parsed = followUpAssetInputSchema.safeParse({
        id: 'asset-1',
        displayName: 'large.png',
        mediaType: 'image/png',
        encoding: 'base64',
        data: 'a'.repeat(encodedLength)
      }).success
      expect(parsed).toBe(expected)
      await planAssert({
        scenarioId: 'E25',
        assertionId: '队列顺序、revision、lease 与消费状态正确',
        assertion: () => expect(parsed).toBe(expected)
      })
      await planAssert({
        scenarioId: 'E25',
        assertionId: '重启从持久化状态恢复',
        assertion: () => expect(encodedLength <= FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS).toBe(expected)
      })
      await planAssert({
        scenarioId: 'E25',
        assertionId: '不能重复 claim 或自动重发',
        assertion: () => expect(parsed).toBe(expected)
      })
    }
  )

  it.each([
    ['limit - 1', 999_999, true],
    ['limit', 1_000_000, true],
    ['limit + 1', 1_000_001, false]
  ] as const)('E26 accepts text at %s and rejects overflow', async (_boundary, length, expected) => {
    const parsed = queuedUserMessageSnapshotInputSchema.safeParse({
      ...snapshot,
      text: 'a'.repeat(length)
    }).success
    expect(parsed).toBe(expected)
    await planAssert({
      scenarioId: 'E26',
      assertionId: '队列顺序、revision、lease 与消费状态正确',
      assertion: () => expect(parsed).toBe(expected)
    })
    await planAssert({
      scenarioId: 'E26',
      assertionId: '重启从持久化状态恢复',
      assertion: () => expect(length <= 1_000_000).toBe(expected)
    })
    await planAssert({
      scenarioId: 'E26',
      assertionId: '不能重复 claim 或自动重发',
      assertion: () => expect(parsed).toBe(expected)
    })
  })

  it('accepts a serializable enqueue payload with a stable message id', () => {
    expect(
      followUpEnqueuePayloadSchema.safeParse({
        conversationKey: 'conversation-1',
        snapshot,
        preferredMode: 'queue'
      }).success
    ).toBe(true)
  })

  it('G04 rejects absolute and traversing persisted asset handles', async () => {
    const asset = {
      kind: 'persisted-asset',
      id: 'asset-1',
      displayName: 'image.png',
      mediaType: 'image/png',
      sizeBytes: 10,
      sha256: 'a'.repeat(64)
    }

    expect(
      followUpPersistedAssetSchema.safeParse({ ...asset, relativePath: '/tmp/image.png' }).success
    ).toBe(false)
    expect(
      followUpPersistedAssetSchema.safeParse({ ...asset, relativePath: '../image.png' }).success
    ).toBe(false)
    await planAssert({
      scenarioId: 'G04',
      assertionId: '跨对话与信任边界隔离',
      assertion: () =>
        expect(
          followUpPersistedAssetSchema.safeParse({ ...asset, relativePath: '/tmp/image.png' }).success
        ).toBe(false)
    })
    await planAssert({
      scenarioId: 'G04',
      assertionId: '资源、并发和终态无残留',
      assertion: () =>
        expect(
          followUpPersistedAssetSchema.safeParse({ ...asset, relativePath: '../image.png' }).success
        ).toBe(false)
    })
    await planAssert({
      scenarioId: 'G04',
      assertionId: '诊断可关联而不泄露密钥',
      assertion: () =>
        expect(
          followUpPersistedAssetSchema.safeParse({ ...asset, relativePath: '../image.png' }).success
        ).toBe(false)
    })
  })

  it('requires exactly one reorder anchor', () => {
    const base = { conversationKey: 'conversation-1', itemId: 'message-1' }
    expect(followUpReorderPayloadSchema.safeParse({ ...base, beforeId: 'message-2' }).success).toBe(
      true
    )
    expect(followUpReorderPayloadSchema.safeParse(base).success).toBe(false)
    expect(
      followUpReorderPayloadSchema.safeParse({
        ...base,
        beforeId: 'message-2',
        afterId: 'message-3'
      }).success
    ).toBe(false)
  })

  it('requires stable item ids for commit-edit and explicit item ids for steer', () => {
    expect(
      followUpCommitEditPayloadSchema.safeParse({
        conversationKey: 'conversation-1',
        itemId: 'message-1',
        replacementSnapshot: snapshot
      }).success
    ).toBe(true)
    expect(
      followUpCommitEditPayloadSchema.safeParse({
        conversationKey: 'conversation-1',
        itemId: 'message-2',
        replacementSnapshot: snapshot
      }).success
    ).toBe(false)
    expect(
      followUpSteerItemPayloadSchema.safeParse({
        conversationKey: 'conversation-1',
        itemId: 'message-1'
      }).success
    ).toBe(true)
    expect(
      followUpSteerItemPayloadSchema.safeParse({
        conversationKey: 'conversation-1'
      }).success
    ).toBe(false)
  })

  it('validates begin-edit responses as state plus a materialized message', () => {
    expect(
      followUpBeginEditResultSchema.safeParse({
        state: {
          version: 2,
          revision: 1,
          conversationKey: 'conversation-1',
          defaultMode: 'queue',
          archived: false,
          items: []
        },
        message: {
          id: 'message-1',
          parts: [{ type: 'text', text: 'continue' }],
          contextReferences: [],
          trustedContext: snapshot.trustedContext
        }
      }).success
    ).toBe(true)
  })
})
