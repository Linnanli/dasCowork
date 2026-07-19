import { describe, expect, it } from 'vitest'

import {
  FOLLOW_UP_QUEUE_STATE_VERSION,
  FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM,
  FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION,
  FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES,
  followUpBeginEditResultSchema,
  followUpCommitEditPayloadSchema,
  followUpEnqueuePayloadSchema,
  followUpAssetInputSchema,
  followUpPersistedAssetSchema,
  followUpReorderPayloadSchema,
  followUpSteerItemPayloadSchema,
  queuedFollowUpItemSchema
} from './codexFollowUpApi'

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

  it('locks the initial queue capacity limits', () => {
    expect(FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION).toBe(20)
    expect(FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM).toBe(10 * 1024 * 1024)
    expect(FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES).toBe(50 * 1024 * 1024)
  })

  it('rejects oversized base64 before the payload crosses the IPC boundary', () => {
    const maximumEncodedLength = Math.ceil(FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM / 3) * 4
    expect(
      followUpAssetInputSchema.safeParse({
        id: 'asset-1',
        displayName: 'large.png',
        mediaType: 'image/png',
        encoding: 'base64',
        data: 'a'.repeat(maximumEncodedLength + 1)
      }).success
    ).toBe(false)
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

  it('rejects absolute and traversing persisted asset handles', () => {
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
