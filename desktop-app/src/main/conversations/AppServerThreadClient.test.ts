import { describe, expect, it, vi } from 'vitest'

import { AppServerThreadClient, type AppServerJsonRpcClientLike } from './AppServerThreadClient'

function createJsonRpcClient(responses: Record<string, unknown>): AppServerJsonRpcClientLike {
  const request = vi.fn(async (method: string) => {
    const response = responses[method]
    if (response === undefined) throw new Error(`unexpected method ${method}`)
    return response
  }) as AppServerJsonRpcClientLike['request']
  const client: AppServerJsonRpcClientLike = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    notification: vi.fn(async () => undefined),
    request
  }
  return client
}

describe('AppServerThreadClient', () => {
  it('initializes the app-server client before listing threads', async () => {
    const jsonRpc = createJsonRpcClient({
      initialize: {},
      'thread/list': {
        data: [
          {
            id: 'thread-1',
            sessionId: 'thread-1',
            name: 'Provider work',
            preview: 'Investigate provider',
            createdAt: 1782777600,
            updatedAt: 1782777900,
            status: { type: 'idle' },
            cwd: '/repo/app'
          }
        ],
        nextCursor: null
      }
    })
    const client = new AppServerThreadClient({
      createClient: () => jsonRpc
    })

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

    expect(jsonRpc.connect).toHaveBeenCalledOnce()
    expect(jsonRpc.request).toHaveBeenNthCalledWith(
      1,
      'initialize',
      expect.objectContaining({
        clientInfo: expect.objectContaining({ name: 'dascowork_desktop_sidebar' })
      })
    )
    expect(jsonRpc.notification).toHaveBeenCalledWith('initialized')
    expect(jsonRpc.request).toHaveBeenCalledWith(
      'thread/list',
      expect.objectContaining({
        modelProviders: [],
        sortKey: 'updated_at',
        sortDirection: 'desc'
      })
    )
    expect(jsonRpc.disconnect).toHaveBeenCalledOnce()
  })

  it('falls back from empty names to previews and paginates thread/list', async () => {
    const jsonRpc: AppServerJsonRpcClientLike = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      notification: vi.fn(async () => undefined),
      request: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          data: [
            {
              id: 'thread-1',
              name: null,
              preview: 'First prompt',
              createdAt: 1782777600,
              updatedAt: 1782777800,
              status: { type: 'active', activeFlags: [] },
              cwd: '/repo/a'
            }
          ],
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: 'thread-2',
              name: '',
              preview: '',
              createdAt: 1782777900,
              updatedAt: 1782777900,
              status: { type: 'idle' },
              cwd: null
            }
          ],
          nextCursor: null
        })
    }
    const client = new AppServerThreadClient({ createClient: () => jsonRpc })

    await expect(client.listThreads({ includeArchived: true })).resolves.toEqual([
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

    expect(jsonRpc.request).toHaveBeenCalledWith(
      'thread/list',
      expect.objectContaining({ cursor: 'cursor-1', modelProviders: [], archived: true })
    )
  })

  it('sends archive, unarchive, set name, and read requests', async () => {
    const jsonRpc = createJsonRpcClient({
      initialize: {},
      'thread/archive': {},
      'thread/unarchive': {},
      'thread/name/set': {},
      'thread/read': {
        thread: {
          id: 'thread-1',
          name: 'Renamed',
          preview: 'Prompt',
          createdAt: 1782777600,
          updatedAt: 1782777900,
          status: { type: 'idle' },
          cwd: '/repo/app'
        }
      }
    })
    const client = new AppServerThreadClient({ createClient: () => jsonRpc })

    await client.archiveThread('thread-1')
    await client.unarchiveThread('thread-1')
    await client.renameThread('thread-1', 'Renamed')
    await client.readThread('thread-1')

    expect(jsonRpc.request).toHaveBeenCalledWith('thread/archive', { threadId: 'thread-1' })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/unarchive', { threadId: 'thread-1' })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/name/set', {
      threadId: 'thread-1',
      name: 'Renamed'
    })
    expect(jsonRpc.request).toHaveBeenCalledWith('thread/read', {
      threadId: 'thread-1',
      includeTurns: false
    })
  })
})
