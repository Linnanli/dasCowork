import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  ConversationFollowUpQueueStore,
  createDefaultConversationFollowUpQueueStoreState,
  type ConversationFollowUpQueueStoreState
} from './ConversationFollowUpQueueStore'
import type { QueuedFollowUpItem } from '../../shared/codexFollowUpApi'

function item(status: 'queued' | 'sending' | 'paused-failed' | 'editing'): QueuedFollowUpItem {
  return {
    id: 'message-1',
    conversationKey: 'conversation-1',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    preferredMode: 'queue' as const,
    status,
    message: {
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
    },
    ...(status === 'sending'
      ? {
          lease: {
            token: 'lease-1',
            operation: 'turn-start' as const,
            claimedAt: '2026-07-18T00:00:00.000Z',
            owner: 'runtime'
          }
        }
      : {}),
    ...(status === 'editing'
      ? {
          edit: {
            previousStatus: 'queued' as const,
            begunAt: '2026-07-18T00:00:00.000Z'
          }
        }
      : {})
  }
}

function stateWith(
  status: 'queued' | 'sending' | 'paused-failed' | 'editing'
): ConversationFollowUpQueueStoreState {
  return {
    ...createDefaultConversationFollowUpQueueStoreState(),
    revision: 2,
    defaultMode: 'steer' as const,
    conversations: {
      'conversation-1': {
        archived: false,
        items: [item(status)]
      }
    }
  }
}

describe('ConversationFollowUpQueueStore', () => {
  it('persists queue order, status, revision, and default mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-store-'))
    const filePath = join(directory, 'state.json')

    try {
      const store = ConversationFollowUpQueueStore.onDisk(filePath)
      await store.setState(stateWith('paused-failed'))
      const reloaded = ConversationFollowUpQueueStore.onDisk(filePath)
      const state = await reloaded.getState()

      expect(state.defaultMode).toBe('steer')
      expect(state.revision).toBe(2)
      expect(state.conversations['conversation-1'].items[0].status).toBe('paused-failed')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('migrates a durable v1 file to v2 without losing queued items', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-store-'))
    const filePath = join(directory, 'state.json')
    const legacyState = {
      ...stateWith('paused-failed'),
      version: 1
    }

    try {
      await writeFile(filePath, JSON.stringify(legacyState), 'utf8')
      const store = ConversationFollowUpQueueStore.onDisk(filePath)
      const migrated = await store.getState()

      expect(migrated.version).toBe(2)
      expect(migrated.revision).toBe(2)
      expect(migrated.defaultMode).toBe('steer')
      expect(migrated.conversations['conversation-1'].items).toMatchObject([
        { id: 'message-1', status: 'paused-failed' }
      ])
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        version: 2,
        conversations: {
          'conversation-1': {
            items: [{ id: 'message-1', status: 'paused-failed' }]
          }
        }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps an editing reservation durable across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-store-'))
    const filePath = join(directory, 'state.json')

    try {
      const store = ConversationFollowUpQueueStore.onDisk(filePath)
      await store.setState(stateWith('editing'))
      const recovered = await ConversationFollowUpQueueStore.onDisk(filePath).getState()

      expect(recovered.conversations['conversation-1'].items[0]).toMatchObject({
        status: 'editing',
        edit: { previousStatus: 'queued' }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('recovers an unconfirmed delivery as recovery-uncertain without retaining its lease', async () => {
    const store = ConversationFollowUpQueueStore.inMemory(stateWith('sending'))
    const recovered = (await store.getState()).conversations['conversation-1'].items[0]

    expect(recovered.status).toBe('paused-recovery-uncertain')
    expect(recovered.pause?.kind).toBe('recovery-uncertain')
    expect(recovered.lease).toBeUndefined()
  })

  it('serializes overlapping disk writes in invocation order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-store-'))
    const filePath = join(directory, 'state.json')
    let releaseFirst = (): void => undefined
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const started: number[] = []

    try {
      const store = ConversationFollowUpQueueStore.onDisk(filePath, {
        writeJsonAtomically: async (target, state) => {
          started.push(state.revision)
          if (state.revision === 1) await firstBlocked
          await writeFile(target, JSON.stringify(state), 'utf8')
        }
      })
      const first = store.setState({ ...stateWith('queued'), revision: 1 })
      const second = store.setState({ ...stateWith('queued'), revision: 2 })
      await Promise.resolve()
      expect(started).toEqual([1])
      releaseFirst()
      await Promise.all([first, second])

      expect(started).toEqual([1, 2])
      expect(
        (JSON.parse(await readFile(filePath, 'utf8')) as ConversationFollowUpQueueStoreState)
          .revision
      ).toBe(2)
    } finally {
      releaseFirst()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps the last durable in-memory state when a disk write fails', async () => {
    const writeJsonAtomically = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'))
    const store = ConversationFollowUpQueueStore.onDisk('/virtual/follow-ups.json', {
      writeJsonAtomically
    })

    await store.setState({ ...stateWith('queued'), revision: 1 })
    await expect(store.setState({ ...stateWith('paused-failed'), revision: 2 })).rejects.toThrow(
      'disk full'
    )

    const current = await store.getState()
    expect(current.revision).toBe(1)
    expect(current.conversations['conversation-1'].items[0].status).toBe('queued')
  })
})
