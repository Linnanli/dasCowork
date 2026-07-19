import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION,
  type QueuedUserMessageSnapshotInput
} from '../../shared/codexFollowUpApi'
import { ConversationFollowUpQueueService } from './ConversationFollowUpQueueService'
import {
  ConversationFollowUpQueueStore,
  createDefaultConversationFollowUpQueueStoreState
} from './ConversationFollowUpQueueStore'
import { FollowUpAssetStore } from './FollowUpAssetStore'

function snapshot(id: string, conversationId = 'conversation-1'): QueuedUserMessageSnapshotInput {
  return {
    id,
    text: `follow up ${id}`,
    attachments: [],
    contextReferences: [],
    trustedContext: {
      conversationId,
      hostId: 'local',
      cwd: '/repo',
      workspaceRoots: ['/repo']
    }
  }
}

function snapshotWithImage(
  id: string,
  conversationId: string,
  contents: string
): QueuedUserMessageSnapshotInput {
  const value = snapshot(id, conversationId)
  value.attachments = [
    {
      kind: 'inline-asset',
      id: `${id}-image`,
      displayName: `${id}.png`,
      mediaType: 'image/png',
      encoding: 'base64',
      data: Buffer.from(contents).toString('base64')
    }
  ]
  return value
}

async function createService(): Promise<{
  directory: string
  store: ConversationFollowUpQueueStore
  assetStore: FollowUpAssetStore
  service: ConversationFollowUpQueueService
  dispose: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'follow-up-service-'))
  let timestamp = 0
  let lease = 0
  const store = ConversationFollowUpQueueStore.inMemory()
  const assetStore = new FollowUpAssetStore(join(directory, 'assets'))
  const service = new ConversationFollowUpQueueService({
    store,
    assetStore,
    now: () => `2026-07-18T00:00:00.${String(timestamp++).padStart(3, '0')}Z`,
    createLeaseToken: () => `lease-${++lease}`
  })
  return {
    directory,
    store,
    assetStore,
    service,
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}

describe('ConversationFollowUpQueueService', () => {
  it('serializes concurrent clients into one ordered, monotonically versioned queue', async () => {
    const fixture = await createService()
    const revisions: number[] = []
    const unsubscribe = fixture.service.subscribe((event) => revisions.push(event.revision))

    try {
      await Promise.all([
        fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue'),
        fixture.service.enqueue('conversation-1', snapshot('message-2'), 'steer')
      ])
      const state = await fixture.service.getState('conversation-1')

      expect(state.items.map((item) => item.id)).toEqual(['message-1', 'message-2'])
      expect(state.items.map((item) => item.preferredMode)).toEqual(['queue', 'steer'])
      expect(revisions).toEqual([1, 2])
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('enforces the per-conversation item limit before mutating resources', async () => {
    const fixture = await createService()

    try {
      for (let index = 0; index < FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION; index += 1) {
        await fixture.service.enqueue('conversation-1', snapshot(`message-${index}`), 'queue')
      }
      await expect(
        fixture.service.enqueue('conversation-1', snapshot('message-overflow'), 'queue')
      ).rejects.toThrow('at most 20')
      expect((await fixture.service.getState('conversation-1')).items).toHaveLength(20)
    } finally {
      await fixture.dispose()
    }
  })

  it('rejects a snapshot whose routing identity does not match the queue', async () => {
    const fixture = await createService()

    try {
      await expect(
        fixture.service.enqueue('conversation-1', snapshot('message-1', 'conversation-2'), 'queue')
      ).rejects.toThrow('does not belong')
      expect((await fixture.service.getState('conversation-1')).items).toEqual([])
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps committed queue state when stale asset cleanup fails', async () => {
    const fixture = await createService()
    const prepare = fixture.assetStore.prepare.bind(fixture.assetStore)
    vi.spyOn(fixture.assetStore, 'prepare').mockImplementationOnce(async (...args) => {
      const transaction = await prepare(...args)
      return {
        ...transaction,
        finalize: vi.fn().mockRejectedValue(new Error('cleanup failed'))
      }
    })

    try {
      await expect(
        fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      ).resolves.toMatchObject({
        items: [{ id: 'message-1' }]
      })
      expect((await fixture.service.getState('conversation-1')).items).toHaveLength(1)
    } finally {
      await fixture.dispose()
    }
  })

  it('grants only one head lease and rejects a stale lease', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-start', 'message-1')

      expect(claim.leaseToken).toBe('lease-1')
      expect(claim.item.status).toBe('sending')
      await expect(
        fixture.service.claimHead('conversation-1', 'turn-start', 'message-1')
      ).rejects.toThrow('delivery is being confirmed')
      await expect(
        fixture.service.commitClaim('conversation-1', 'message-1', 'stale')
      ).rejects.toThrow('stale')

      const state = await fixture.service.commitClaim(
        'conversation-1',
        'message-1',
        claim.leaseToken
      )
      expect(state.items).toEqual([])
    } finally {
      await fixture.dispose()
    }
  })

  it('rejects head-changing actions while a delivery lease is active', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.claimHead('conversation-1', 'turn-steer', 'message-1')

      await expect(fixture.service.requestSendNow('conversation-1', 'message-2')).rejects.toThrow(
        'delivery is being confirmed'
      )
      await expect(
        fixture.service.reorder('conversation-1', 'message-2', { beforeId: 'message-1' })
      ).rejects.toThrow('delivery is being confirmed')
      expect(
        (await fixture.service.getState('conversation-1')).items.map((item) => item.id)
      ).toEqual(['message-1', 'message-2'])
    } finally {
      await fixture.dispose()
    }
  })

  it('prevents a second head claim while any queue item has a delivery lease', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.claimItemForSteer('conversation-1', 'message-2')

      await expect(
        fixture.service.claimHead('conversation-1', 'turn-start', 'message-1')
      ).rejects.toThrow('delivery is being confirmed')
    } finally {
      await fixture.dispose()
    }
  })

  it('claims, materializes, and commits a non-head item without reordering the rest', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-3'), 'queue')

      const claim = await fixture.service.claimItemForSteer('conversation-1', 'message-2')
      expect(claim.item).toMatchObject({ id: 'message-2', status: 'steering' })
      expect(
        (await fixture.service.getState('conversation-1')).items.map((item) => [
          item.id,
          item.status
        ])
      ).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'steering'],
        ['message-3', 'queued']
      ])
      expect((await fixture.service.materializeClaimMessage(claim)).id).toBe('message-2')

      const committed = await fixture.service.commitClaim(
        'conversation-1',
        'message-2',
        claim.leaseToken
      )
      expect(committed.items.map((item) => item.id)).toEqual(['message-1', 'message-3'])
    } finally {
      await fixture.dispose()
    }
  })

  it('materializes a queued non-head item without claiming or reordering it', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')

      const message = await fixture.service.materializeItem('conversation-1', 'message-2')
      const state = await fixture.service.getState('conversation-1')

      expect(message).toMatchObject({
        id: 'message-2',
        parts: [{ type: 'text', text: 'follow up message-2' }]
      })
      expect(state.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'queued']
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('does not steer past a paused or failed queue item', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      const headClaim = await fixture.service.claimHead('conversation-1', 'turn-start', 'message-1')
      await fixture.service.failClaim('conversation-1', 'message-1', headClaim.leaseToken, {
        status: 'paused-recovery-uncertain',
        kind: 'recovery-uncertain',
        userMessage: 'Delivery result is unknown.'
      })

      await expect(
        fixture.service.claimItemForSteer('conversation-1', 'message-2')
      ).rejects.toThrow('Resolve paused or failed queue items')
    } finally {
      await fixture.dispose()
    }
  })

  it('restores a rejected non-head steer in its original position', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-3'), 'queue')
      const claim = await fixture.service.claimItemForSteer('conversation-1', 'message-2')

      const failed = await fixture.service.failClaim(
        'conversation-1',
        'message-2',
        claim.leaseToken,
        {
          status: 'queued',
          kind: 'turn-race',
          userMessage: 'The turn ended.'
        }
      )

      expect(failed.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'queued'],
        ['message-3', 'queued']
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('begins, commits, and cancels durable editing without changing item identity or order', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      const begun = await fixture.service.beginEdit('conversation-1', 'message-2')

      expect(begun.message).toMatchObject({ id: 'message-2' })
      expect(begun.state.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'editing']
      ])

      const cancelled = await fixture.service.cancelEdit('conversation-1', 'message-2')
      expect(cancelled.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'queued']
      ])

      await fixture.service.beginEdit('conversation-1', 'message-2')
      const replacement = { ...snapshot('message-2'), text: 'updated follow up' }
      const committed = await fixture.service.commitEdit('conversation-1', 'message-2', replacement)
      expect(committed.items.map((item) => item.id)).toEqual(['message-1', 'message-2'])
      expect(committed.items[1]).toMatchObject({
        id: 'message-2',
        status: 'queued',
        message: { text: 'updated follow up' }
      })
      expect(committed.items[1].edit).toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('allows only one durable edit reservation per conversation', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.beginEdit('conversation-1', 'message-1')

      await expect(fixture.service.beginEdit('conversation-1', 'message-2')).rejects.toThrow(
        'Finish or cancel the current follow-up edit'
      )

      const state = await fixture.service.getState('conversation-1')
      expect(state.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'editing'],
        ['message-2', 'queued']
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('resumes the same durable edit reservation without changing its revision', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      const begun = await fixture.service.beginEdit('conversation-1', 'message-1')
      const resumed = await fixture.service.beginEdit('conversation-1', 'message-1')

      expect(resumed.state.revision).toBe(begun.state.revision)
      expect(resumed.state.items[0]).toMatchObject({
        id: 'message-1',
        status: 'editing',
        edit: begun.state.items[0]?.edit
      })
      expect(resumed.message).toEqual(begun.message)
    } finally {
      await fixture.dispose()
    }
  })

  it('materializes an existing durable edit reservation so editing can continue after restart', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.beginEdit('conversation-1', 'message-1')

      const resumed = await fixture.service.beginEdit('conversation-1', 'message-1')

      expect(resumed.message).toMatchObject({ id: 'message-1' })
      expect(resumed.state.items[0]).toMatchObject({
        id: 'message-1',
        status: 'editing'
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('retries a failed non-head item in place', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      const claim = await fixture.service.claimItemForSteer('conversation-1', 'message-2')
      await fixture.service.failClaim('conversation-1', 'message-2', claim.leaseToken, {
        status: 'paused-failed',
        kind: 'steer-rejected',
        userMessage: 'Steer rejected.'
      })

      const retried = await fixture.service.retry('conversation-1', 'message-2')

      expect(retried.items.map((item) => [item.id, item.status])).toEqual([
        ['message-1', 'queued'],
        ['message-2', 'queued']
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('cancelEdit restores the exact paused status and pause metadata', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-start')
      await fixture.service.failClaim('conversation-1', 'message-1', claim.leaseToken, {
        kind: 'send-failed',
        userMessage: 'Could not start the turn.'
      })

      await fixture.service.beginEdit('conversation-1', 'message-1')
      const cancelled = await fixture.service.cancelEdit('conversation-1', 'message-1')

      expect(cancelled.items[0]).toMatchObject({
        status: 'paused-failed',
        pause: {
          kind: 'send-failed',
          userMessage: 'Could not start the turn.'
        }
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps a failed head blocking later items until retry', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-start')
      await fixture.service.failClaim('conversation-1', 'message-1', claim.leaseToken, {
        kind: 'send-failed',
        userMessage: 'Could not start the turn.'
      })

      await expect(fixture.service.requestSendNow('conversation-1', 'message-2')).rejects.toThrow(
        'must be resolved'
      )
      await expect(
        fixture.service.claimHead('conversation-1', 'turn-start', 'message-2')
      ).rejects.toThrow('expected message-1')

      const retried = await fixture.service.retry('conversation-1', 'message-1')
      expect(retried.items[0].status).toBe('queued')
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps a paused head fixed while allowing later items to reorder', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-3'), 'queue')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-start')
      await fixture.service.failClaim('conversation-1', 'message-1', claim.leaseToken, {
        kind: 'send-failed',
        userMessage: 'Could not start the turn.'
      })

      await expect(
        fixture.service.reorder('conversation-1', 'message-1', { afterId: 'message-2' })
      ).rejects.toThrow('paused queue head')
      await expect(
        fixture.service.reorder('conversation-1', 'message-2', { beforeId: 'message-1' })
      ).rejects.toThrow('paused queue head')
      const reordered = await fixture.service.reorder('conversation-1', 'message-3', {
        beforeId: 'message-2'
      })
      expect(reordered.items.map((item) => item.id)).toEqual([
        'message-1',
        'message-3',
        'message-2'
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('pauses after interruption and resumes only interrupted items', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      const paused = await fixture.service.interrupt('conversation-1')
      expect(paused.items[0].status).toBe('paused-interrupted')
      await expect(fixture.service.claimHead('conversation-1', 'turn-start')).rejects.toThrow(
        'not claimable'
      )

      const resumed = await fixture.service.resume('conversation-1')
      expect(resumed.items[0].status).toBe('queued')
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps edited and newly enqueued items paused until explicit resume', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.interrupt('conversation-1')

      const edited = await fixture.service.edit(
        'conversation-1',
        'message-1',
        snapshot('message-1')
      )
      expect(edited.items[0].status).toBe('paused-interrupted')

      const enqueued = await fixture.service.enqueue(
        'conversation-1',
        snapshot('message-2'),
        'queue'
      )
      expect(enqueued.items.map((item) => item.status)).toEqual([
        'paused-interrupted',
        'paused-interrupted'
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('preserves an unconfirmed delivery lease when interrupt races with acceptance', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await fixture.service.enqueue('conversation-1', snapshot('message-2'), 'queue')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-start')

      const paused = await fixture.service.interrupt('conversation-1')

      expect(paused.items[0].status).toBe('sending')
      expect(paused.items[0].lease?.token).toBe(claim.leaseToken)
      expect(paused.items[1].status).toBe('paused-interrupted')
      const settled = await fixture.service.commitClaim(
        'conversation-1',
        'message-1',
        claim.leaseToken
      )
      expect(settled.items).toMatchObject([
        {
          id: 'message-2',
          status: 'paused-interrupted',
          pause: { kind: 'interrupted' }
        }
      ])
    } finally {
      await fixture.dispose()
    }
  })

  it('pauses a definitely rejected in-flight delivery when interrupt wins the race', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('conversation-1', snapshot('message-1'), 'steer')
      const claim = await fixture.service.claimHead('conversation-1', 'turn-steer')
      await fixture.service.interrupt('conversation-1')

      const failed = await fixture.service.failClaim(
        'conversation-1',
        'message-1',
        claim.leaseToken,
        {
          status: 'queued',
          kind: 'turn-race',
          userMessage: 'The turn ended.'
        }
      )

      expect(failed.items[0]).toMatchObject({
        status: 'paused-interrupted',
        pause: { kind: 'interrupted' }
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('migrates a local key atomically, de-duplicates ids, and preserves source order', async () => {
    const fixture = await createService()

    try {
      await fixture.service.enqueue('local-1', snapshot('shared', 'local-1'), 'queue')
      await fixture.service.enqueue('local-1', snapshot('source-only', 'local-1'), 'queue')
      await fixture.service.enqueue('thread-1', snapshot('shared', 'thread-1'), 'steer')
      await fixture.service.enqueue('thread-1', snapshot('target-only', 'thread-1'), 'queue')

      const migrated = await fixture.service.migrateConversationKey('local-1', 'thread-1')
      expect(migrated.items.map((item) => item.id)).toEqual([
        'shared',
        'target-only',
        'source-only'
      ])
      expect(migrated.items.find((item) => item.id === 'source-only')?.conversationKey).toBe(
        'thread-1'
      )
      expect(
        migrated.items.find((item) => item.id === 'source-only')?.message.trustedContext.threadId
      ).toBe('thread-1')
      expect((await fixture.service.getState('local-1')).items).toEqual([])
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps same-id assets isolated while migration discards only the duplicate source asset', async () => {
    const fixture = await createService()

    try {
      const source = await fixture.service.enqueue(
        'local-1',
        snapshotWithImage('shared', 'local-1', 'source image'),
        'queue'
      )
      const target = await fixture.service.enqueue(
        'thread-1',
        snapshotWithImage('shared', 'thread-1', 'target image'),
        'queue'
      )
      const sourceAttachment = source.items[0].message.attachments[0]
      const targetAttachment = target.items[0].message.attachments[0]
      if (
        sourceAttachment.kind !== 'persisted-asset' ||
        targetAttachment.kind !== 'persisted-asset'
      ) {
        throw new Error('expected persisted assets')
      }

      await expect(fixture.assetStore.validate([sourceAttachment])).resolves.toBeUndefined()
      await expect(fixture.assetStore.validate([targetAttachment])).resolves.toBeUndefined()

      await fixture.service.migrateConversationKey('local-1', 'thread-1')

      await expect(fixture.assetStore.validate([sourceAttachment])).rejects.toThrow()
      await expect(fixture.assetStore.validate([targetAttachment])).resolves.toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('edits and cleans an attachment after its conversation key migrates', async () => {
    const fixture = await createService()

    try {
      const queued = await fixture.service.enqueue(
        'local-1',
        snapshotWithImage('message-1', 'local-1', 'original image'),
        'queue'
      )
      const originalAttachment = queued.items[0].message.attachments[0]
      if (originalAttachment.kind !== 'persisted-asset') {
        throw new Error('expected persisted asset')
      }

      const migrated = await fixture.service.migrateConversationKey('local-1', 'thread-1')
      const migratedItem = migrated.items[0]
      const edited = await fixture.service.edit('thread-1', 'message-1', {
        ...migratedItem.message,
        text: 'edited after migration'
      })
      const editedAttachment = edited.items[0].message.attachments[0]
      if (editedAttachment.kind !== 'persisted-asset') {
        throw new Error('expected persisted asset')
      }

      expect(editedAttachment.relativePath).not.toBe(originalAttachment.relativePath)
      await expect(fixture.assetStore.validate([originalAttachment])).rejects.toThrow()
      await expect(fixture.assetStore.validate([editedAttachment])).resolves.toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('preserves default mode, archived queues, and recovery state across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-restart-'))
    const statePath = join(directory, 'queue.json')
    const assetsPath = join(directory, 'assets')

    try {
      const first = new ConversationFollowUpQueueService({
        store: ConversationFollowUpQueueStore.onDisk(statePath),
        assetStore: new FollowUpAssetStore(assetsPath),
        createLeaseToken: () => 'lease-1'
      })
      await first.setDefaultMode('steer')
      await first.enqueue('conversation-1', snapshot('message-1'), 'queue')
      await first.setArchived('conversation-1', true)
      await first.setArchived('conversation-1', false)
      await first.claimHead('conversation-1', 'turn-steer')

      const reloaded = new ConversationFollowUpQueueService({
        store: ConversationFollowUpQueueStore.onDisk(statePath),
        assetStore: new FollowUpAssetStore(assetsPath)
      })
      const state = await reloaded.getState('conversation-1')

      expect(state.defaultMode).toBe('steer')
      expect(state.items[0].status).toBe('paused-recovery-uncertain')
      expect(state.items[0].lease).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['turn-start', 'turn-steer'] as const)(
    'keeps accepted %s image history durable after queue cleanup and restart reconciliation',
    async (operation) => {
      const fixture = await createService()
      const withAsset = snapshot('message-1')
      withAsset.attachments = [
        {
          kind: 'inline-asset',
          id: 'image-1',
          displayName: 'image.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('image').toString('base64')
        }
      ]

      try {
        const queued = await fixture.service.enqueue(
          'conversation-1',
          withAsset,
          operation === 'turn-steer' ? 'steer' : 'queue'
        )
        const attachment = queued.items[0].message.attachments[0]
        expect(attachment.kind).toBe('persisted-asset')
        if (attachment.kind !== 'persisted-asset') throw new Error('expected persisted asset')
        await expect(fixture.assetStore.validate([attachment])).resolves.toBeUndefined()

        const claim = await fixture.service.claimHead('conversation-1', operation)
        const message = await fixture.service.materializeClaimMessage(claim)
        expect(message.parts[0]).toEqual({ type: 'text', text: 'follow up message-1' })
        expect(message.parts[1]).toMatchObject({
          type: 'file',
          filename: 'image.png',
          mediaType: 'image/png'
        })
        const historyUrl =
          message.parts[1]?.type === 'file' ? String(message.parts[1].url) : undefined
        expect(historyUrl).toMatch(/^file:/u)
        if (!historyUrl) throw new Error('expected durable history URL')
        await expect(readFile(fileURLToPath(historyUrl), 'utf8')).resolves.toBe('image')

        await fixture.service.commitClaim('conversation-1', 'message-1', claim.leaseToken)
        await expect(fixture.assetStore.validate([attachment])).rejects.toThrow()

        const reloaded = new ConversationFollowUpQueueService({
          store: fixture.store,
          assetStore: fixture.assetStore
        })
        await reloaded.getState('conversation-1')
        await expect(readFile(fileURLToPath(historyUrl), 'utf8')).resolves.toBe('image')
      } finally {
        await fixture.dispose()
      }
    }
  )

  it('persists an attachment failure when preparing the next queued turn', async () => {
    const fixture = await createService()

    try {
      const queued = await fixture.service.enqueue(
        'conversation-1',
        snapshotWithImage('message-1', 'conversation-1', 'image'),
        'queue'
      )
      const attachment = queued.items[0].message.attachments[0]
      if (attachment.kind !== 'persisted-asset') throw new Error('expected persisted asset')
      await fixture.assetStore.deleteAssets([attachment])

      await expect(
        fixture.service.materializeQueuedMessage('conversation-1', 'message-1')
      ).rejects.toThrow()

      const state = await fixture.service.getState('conversation-1')
      expect(state.items[0]).toMatchObject({
        id: 'message-1',
        status: 'paused-failed',
        pause: {
          kind: 'attachment-unavailable'
        }
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps in-memory state isolated from caller mutation', async () => {
    const initial = createDefaultConversationFollowUpQueueStoreState()
    const store = ConversationFollowUpQueueStore.inMemory(initial)
    const state = await store.getState()
    state.defaultMode = 'steer'
    expect((await store.getState()).defaultMode).toBe('queue')
  })
})
