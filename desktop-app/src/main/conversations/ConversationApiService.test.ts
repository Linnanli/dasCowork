import { describe, expect, it, vi } from 'vitest'

import { ConversationApiService, type ConversationThreadClientLike } from './ConversationApiService'
import type { ProjectState } from '../../shared/projects/projectTypes'

const baseProjectState: ProjectState = {
  workspaceRootOptions: [],
  localProjects: {
    local: {
      id: 'local',
      kind: 'local',
      name: 'Desktop App',
      hostId: 'local',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      writableRoots: ['/repo/desktop-app'],
      defaultCwd: '/repo/desktop-app'
    }
  },
  remoteProjects: [],
  projectOrder: ['local'],
  pinnedProjectIds: [],
  projectWritableRoots: { local: ['/repo/desktop-app'] },
  threadProjectAssignments: {
    'thread-local': { projectKind: 'local', projectId: 'local', cwd: '/repo/desktop-app' },
    'thread-path': {
      projectKind: 'local',
      projectId: 'path:/repo/cli',
      path: '/repo/cli',
      cwd: '/repo/cli'
    },
    'thread-quick': {
      projectKind: 'projectless',
      cwd: '/tmp/dascowork/thread-quick',
      workspaceRoot: '/tmp/dascowork/thread-quick',
      outputDirectory: '/tmp/dascowork/thread-quick/out'
    }
  },
  threadWritableRoots: {},
  threadWorkspaceRootHints: { 'thread-path': ['/repo/cli'] },
  threadProjectlessOutputDirectories: { 'thread-quick': '/tmp/dascowork/thread-quick' },
  projectlessThreadIds: ['thread-quick'],
  projectlessHints: {
    'thread-quick': { workspaceRoot: null, outputDirectory: '/tmp/dascowork/thread-quick' }
  }
}

function createClient(): ConversationThreadClientLike {
  return {
    listThreads: vi.fn(async () => [
      {
        id: 'thread-local',
        title: 'Local project thread',
        preview: 'Local project thread',
        createdAt: '2026-06-30T01:00:00.000Z',
        updatedAt: '2026-06-30T01:05:00.000Z',
        archived: false,
        running: false,
        cwd: '/repo/desktop-app'
      },
      {
        id: 'thread-path',
        title: 'Path workspace thread',
        preview: 'Path workspace thread',
        createdAt: '2026-06-30T02:00:00.000Z',
        updatedAt: '2026-06-30T02:05:00.000Z',
        archived: false,
        running: true,
        cwd: '/repo/cli'
      },
      {
        id: 'thread-quick',
        title: null,
        preview: 'Scratch prompt',
        createdAt: '2026-06-30T03:00:00.000Z',
        updatedAt: '2026-06-30T03:05:00.000Z',
        archived: false,
        running: false,
        cwd: '/tmp/dascowork/thread-quick'
      }
    ]),
    readThread: vi.fn(),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined)
  }
}

describe('ConversationApiService', () => {
  it('joins app-server thread rows with project assignments', async () => {
    const service = new ConversationApiService({
      threadClient: createClient(),
      projectStore: { getState: async () => baseProjectState }
    })

    await expect(service.getConversationList()).resolves.toMatchObject({
      loaded: true,
      error: undefined,
      archivedConversationIds: [],
      conversations: [
        {
          id: 'thread-local',
          threadId: 'thread-local',
          title: 'Local project thread',
          projectAssignment: { projectKind: 'local', projectId: 'local' },
          cwd: '/repo/desktop-app'
        },
        {
          id: 'thread-path',
          threadId: 'thread-path',
          title: 'Path workspace thread',
          projectAssignment: {
            projectKind: 'local',
            projectId: 'path:/repo/cli',
            path: '/repo/cli'
          },
          running: true
        },
        {
          id: 'thread-quick',
          threadId: 'thread-quick',
          title: null,
          projectAssignment: { projectKind: 'projectless' },
          cwd: '/tmp/dascowork/thread-quick'
        }
      ]
    })
  })

  it('refreshes after archive, unarchive, and rename actions', async () => {
    const threadClient = createClient()
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await service.archiveConversation({ conversationId: 'thread-local' })
    await service.unarchiveConversation({ conversationId: 'thread-local' })
    await service.renameConversation({ conversationId: 'thread-local', title: 'New name' })

    expect(threadClient.archiveThread).toHaveBeenCalledWith('thread-local')
    expect(threadClient.unarchiveThread).toHaveBeenCalledWith('thread-local')
    expect(threadClient.renameThread).toHaveBeenCalledWith('thread-local', 'New name')
    expect(threadClient.listThreads).toHaveBeenCalledTimes(3)
  })

  it('ensures a just-finished app-server thread is visible when thread/list lags', async () => {
    const threadClient = createClient()
    vi.mocked(threadClient.listThreads).mockResolvedValue([])
    vi.mocked(threadClient.readThread).mockResolvedValue({
      id: 'thread-fresh',
      title: null,
      preview: '',
      createdAt: '2026-06-30T04:00:00.000Z',
      updatedAt: '2026-06-30T04:05:00.000Z',
      archived: false,
      running: false,
      cwd: '/repo/desktop-app',
      turns: [
        {
          items: [
            {
              id: 'user-fresh',
              type: 'userMessage',
              content: [{ type: 'text', text: 'Fresh sidebar prompt' }]
            }
          ]
        }
      ]
    })
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await expect(
      service.refreshConversationList({ ensureThreadIds: ['thread-fresh'] })
    ).resolves.toMatchObject({
      loaded: true,
      conversations: [
        {
          id: 'thread-fresh',
          threadId: 'thread-fresh',
          title: 'Fresh sidebar prompt',
          cwd: '/repo/desktop-app'
        }
      ]
    })
    expect(threadClient.readThread).toHaveBeenCalledWith('thread-fresh', { includeTurns: true })
  })

  it('keeps getConversationList authoritative after an ensured sidebar broadcast', async () => {
    const threadClient = createClient()
    vi.mocked(threadClient.listThreads).mockResolvedValue([])
    vi.mocked(threadClient.readThread).mockResolvedValue({
      id: 'thread-fresh',
      title: null,
      preview: '',
      createdAt: '2026-06-30T04:00:00.000Z',
      updatedAt: '2026-06-30T04:05:00.000Z',
      archived: false,
      running: false,
      cwd: '/repo/desktop-app',
      turns: [
        {
          items: [
            {
              id: 'user-fresh',
              type: 'userMessage',
              content: [{ type: 'text', text: 'Fresh sidebar prompt' }]
            }
          ]
        }
      ]
    })
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await service.refreshConversationList({ ensureThreadIds: ['thread-fresh'] })
    vi.mocked(threadClient.readThread).mockClear()

    const state = await service.getConversationList()
    expect(state.conversations).toEqual([])
    expect(threadClient.readThread).not.toHaveBeenCalled()
  })

  it('propagates thread/list failures during convergence checks', async () => {
    const threadClient = createClient()
    vi.mocked(threadClient.listThreads).mockRejectedValueOnce(new Error('thread/list failed'))
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await expect(service.hasThreadInList('thread-local')).rejects.toThrow('thread/list failed')
  })

  it('does not reinsert a stale row after archive when thread/read can still return it', async () => {
    const threadClient = createClient()
    vi.mocked(threadClient.listThreads)
      .mockResolvedValueOnce([
        {
          id: 'thread-local',
          title: 'Initial sidebar prompt',
          preview: 'Initial sidebar prompt',
          createdAt: '2026-06-30T04:00:00.000Z',
          updatedAt: '2026-06-30T04:05:00.000Z',
          archived: false,
          running: false,
          cwd: '/repo/desktop-app'
        }
      ])
      .mockResolvedValueOnce([])
    vi.mocked(threadClient.readThread).mockResolvedValue({
      id: 'thread-local',
      title: null,
      preview: '',
      createdAt: '2026-06-30T04:00:00.000Z',
      updatedAt: '2026-06-30T04:05:00.000Z',
      archived: true,
      running: false,
      cwd: '/repo/desktop-app',
      turns: [
        {
          items: [
            {
              id: 'user-local',
              type: 'userMessage',
              content: [{ type: 'text', text: 'Reloaded sidebar prompt' }]
            }
          ]
        }
      ]
    })
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    await service.refreshConversationList()

    await expect(service.archiveConversation({ conversationId: 'thread-local' })).resolves.toEqual({
      loaded: true,
      conversations: [],
      archivedConversationIds: [],
      error: undefined
    })
    expect(threadClient.archiveThread).toHaveBeenCalledWith('thread-local')
    expect(threadClient.readThread).not.toHaveBeenCalled()
  })

  it('does not preserve missing known threads without an explicit ensure request', async () => {
    const threadClient = createClient()
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    // First refresh populates lastState with thread-local
    await service.refreshConversationList()

    // Second refresh: thread/list is authoritative unless a caller explicitly awaits a thread.
    vi.mocked(threadClient.listThreads).mockResolvedValueOnce([])

    const state = await service.refreshConversationList()
    expect(state.conversations).toEqual([])
    expect(threadClient.readThread).not.toHaveBeenCalled()
  })

  it('surfaces read failures for explicitly ensured threads', async () => {
    const threadClient = createClient()
    vi.mocked(threadClient.listThreads).mockResolvedValue([])
    vi.mocked(threadClient.readThread).mockRejectedValue(new Error('thread read failed'))
    const service = new ConversationApiService({
      threadClient,
      projectStore: { getState: async () => baseProjectState }
    })

    const state = await service.refreshConversationList({ ensureThreadIds: ['thread-fresh'] })
    expect(state.conversations).toEqual([])
    expect(state.loaded).toBe(false)
    expect(state.error).toBe('thread read failed')
    expect(threadClient.readThread).toHaveBeenCalledWith('thread-fresh', { includeTurns: true })
  })

  it('merges sidebar preferences with defaults', () => {
    const service = new ConversationApiService({
      threadClient: createClient(),
      projectStore: { getState: async () => baseProjectState }
    })

    expect(
      service.setPreferences({
        organizeMode: 'chronological',
        collapsedGroupIds: ['local:local']
      })
    ).toEqual({
      organizeMode: 'chronological',
      sortKey: 'updated_at',
      collapsedSectionIds: [],
      collapsedGroupIds: ['local:local']
    })
  })
})
