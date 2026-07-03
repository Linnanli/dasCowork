import { describe, expect, it, vi } from 'vitest'

import type { ThreadItem } from '@janole/ai-sdk-provider-codex-asp'

import { AppServerThreadClient, type AppServerHistoryClientLike } from './AppServerThreadClient'

type HistoryThread = Awaited<ReturnType<AppServerHistoryClientLike['readThread']>>

function createHistoryClient(threads: HistoryThread[] = []): AppServerHistoryClientLike {
  return {
    listAllThreads: vi.fn(async () => threads),
    readThread: vi.fn(async (threadId: string) => {
      const thread = threads.find((candidate) => candidate.id === threadId)
      if (!thread) throw new Error(`unexpected thread ${threadId}`)
      return thread
    }),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined)
  }
}

describe('AppServerThreadClient', () => {
  it('lists threads through the provider history client', async () => {
    const historyClient = createHistoryClient([
      historyThread({
        id: 'thread-1',
        name: 'Provider work',
        preview: 'Investigate provider',
        createdAt: 1782777600,
        updatedAt: 1782777900,
        status: { type: 'idle' },
        cwd: '/repo/app'
      })
    ])
    const client = new AppServerThreadClient({ historyClient })

    await expect(client.listThreads({ includeArchived: false })).resolves.toEqual([
      {
        id: 'thread-1',
        title: 'Provider work',
        preview: 'Investigate provider',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:05:00.000Z',
        archived: false,
        running: false,
        cwd: '/repo/app'
      }
    ])

    expect(historyClient.listAllThreads).toHaveBeenCalledWith({
      modelProviders: [],
      sortKey: 'updated_at',
      sortDirection: 'desc'
    })
  })

  it('falls back from empty names to previews and forwards archive filters', async () => {
    const historyClient = createHistoryClient([
      historyThread({
        id: 'thread-1',
        name: null,
        preview: 'First prompt',
        createdAt: 1782777600,
        updatedAt: 1782777800,
        status: { type: 'active' },
        cwd: '/repo/a'
      }),
      historyThread({
        id: 'thread-2',
        name: '',
        preview: '',
        createdAt: 1782777900,
        updatedAt: 1782777900,
        status: { type: 'idle' },
        cwd: null
      })
    ])
    const client = new AppServerThreadClient({ historyClient })

    await expect(
      client.listThreads({ includeArchived: true, sortKey: 'created_at' })
    ).resolves.toEqual([
      {
        id: 'thread-1',
        title: 'First prompt',
        preview: 'First prompt',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:03:20.000Z',
        archived: true,
        running: true,
        cwd: '/repo/a'
      },
      {
        id: 'thread-2',
        title: null,
        preview: '',
        createdAt: '2026-06-30T00:05:00.000Z',
        updatedAt: '2026-06-30T00:05:00.000Z',
        archived: true,
        running: false,
        cwd: null
      }
    ])

    expect(historyClient.listAllThreads).toHaveBeenCalledWith({
      modelProviders: [],
      sortKey: 'created_at',
      sortDirection: 'desc',
      archived: true
    })
  })

  it('maps read threads with provider-generated UI messages when turns are requested', async () => {
    const commandItem = {
      id: 'cmd_1',
      type: 'commandExecution',
      command: 'npm test',
      cwd: '/repo/app',
      processId: null,
      source: 'agent',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: 'ok',
      exitCode: 0,
      durationMs: 1200
    } satisfies Extract<ThreadItem, { type: 'commandExecution' }>
    const historyClient = createHistoryClient([
      historyThread({
        id: 'thread-1',
        name: 'History',
        preview: 'Run tests',
        cwd: '/repo/app',
        turns: [
          {
            id: 'turn_1',
            items: [
              {
                id: 'user_1',
                type: 'userMessage',
                clientId: 'client_1',
                content: [{ type: 'text', text: 'Run tests', text_elements: [] }]
              },
              commandItem
            ],
            itemsView: 'full',
            status: 'completed',
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null
          }
        ]
      })
    ])
    const client = new AppServerThreadClient({ historyClient })

    await expect(client.readThread('thread-1', { includeTurns: true })).resolves.toMatchObject({
      id: 'thread-1',
      title: 'History',
      turns: expect.any(Array),
      messages: [
        {
          id: 'client_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Run tests', state: 'done' }]
        },
        {
          id: 'turn_1:assistant',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'codex_command_execution',
              toolCallId: 'cmd_1',
              input: { command: 'npm test', cwd: '/repo/app' },
              state: 'output-available',
              providerExecuted: true
            }
          ]
        }
      ]
    })
    expect(historyClient.readThread).toHaveBeenCalledWith('thread-1', { includeTurns: true })
  })

  it('forwards archive, unarchive, rename, and read requests', async () => {
    const historyClient = createHistoryClient([historyThread({ id: 'thread-1', name: 'Renamed' })])
    const client = new AppServerThreadClient({ historyClient })

    await client.archiveThread('thread-1')
    await client.unarchiveThread('thread-1')
    await client.renameThread('thread-1', 'Renamed')
    await client.readThread('thread-1')

    expect(historyClient.archiveThread).toHaveBeenCalledWith('thread-1')
    expect(historyClient.unarchiveThread).toHaveBeenCalledWith('thread-1')
    expect(historyClient.renameThread).toHaveBeenCalledWith('thread-1', 'Renamed')
    expect(historyClient.readThread).toHaveBeenCalledWith('thread-1', { includeTurns: false })
  })
})

function historyThread(overrides: Partial<HistoryThread> = {}): HistoryThread {
  return {
    id: 'thread',
    name: null,
    preview: 'Prompt',
    createdAt: 1782777600,
    updatedAt: 1782777900,
    status: { type: 'idle' },
    cwd: '/repo',
    turns: [],
    ...overrides
  }
}
