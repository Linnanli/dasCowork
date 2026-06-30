import { describe, expect, it, vi } from 'vitest'

import { ProjectApiService } from './ProjectApiService'
import { ProjectStore, createDefaultProjectState } from './ProjectStore'

describe('ProjectApiService', () => {
  it('creates and activates a local project from validated roots', async () => {
    const store = ProjectStore.inMemory(createDefaultProjectState())
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: `/real${path}` }),
      pickWorkspaceRoot: vi.fn()
    })

    const project = await service.createLocalProject({
      name: 'Desktop App',
      sourceRoots: ['/repo', '/repo/packages/api']
    })

    expect(project).toMatchObject({
      kind: 'local',
      name: 'Desktop App',
      writableRoots: ['/real/repo', '/real/repo/packages/api'],
      defaultCwd: '/real/repo'
    })
    await expect(store.getState()).resolves.toMatchObject({
      activeLocalProjectId: project.id,
      activeProjectSelection: { projectKind: 'local', projectId: project.id },
      activeWorkspaceRoots: ['/real/repo', '/real/repo/packages/api'],
      projectWritableRoots: {
        [project.id]: ['/real/repo', '/real/repo/packages/api']
      }
    })
  })

  it('rejects local project creation without source roots', async () => {
    const store = ProjectStore.inMemory(createDefaultProjectState())
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: `/real${path}` }),
      pickWorkspaceRoot: vi.fn()
    })

    await expect(
      service.createLocalProject({
        name: 'Empty',
        sourceRoots: []
      })
    ).rejects.toThrow('Local project requires at least one source root')
  })

  it('selects a registered path root through validation before storing it as active', async () => {
    const store = ProjectStore.inMemory({
      ...createDefaultProjectState(),
      workspaceRootOptions: [
        {
          root: '/real/repo',
          label: 'Repo',
          hostId: 'local',
          addedAt: '2026-06-29T00:00:00.000Z',
          lastOpenedAt: '2026-06-29T00:00:00.000Z'
        }
      ]
    })
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: `/real${path}` }),
      pickWorkspaceRoot: vi.fn()
    })

    await service.selectProject({ projectKind: 'path', path: '/repo' })

    await expect(store.getState()).resolves.toMatchObject({
      activeProjectSelection: { projectKind: 'path', path: '/real/repo' },
      activeWorkspaceRoots: ['/real/repo'],
      workspaceRootOptions: [
        {
          root: '/real/repo',
          hostId: 'local',
          label: 'Repo'
        }
      ]
    })
  })

  it('rejects unregistered path selections from renderer-owned calls', async () => {
    const store = ProjectStore.inMemory(createDefaultProjectState())
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: `/real${path}` }),
      pickWorkspaceRoot: vi.fn()
    })

    await expect(service.selectProject({ projectKind: 'path', path: '/repo' })).rejects.toThrow(
      'Workspace root is not registered'
    )
  })

  it('creates and activates a remote project', async () => {
    const store = ProjectStore.inMemory(createDefaultProjectState())
    const validateRemoteRoot = vi.fn(async () => undefined)
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: path }),
      validateRemoteRoot,
      pickWorkspaceRoot: vi.fn()
    })

    const project = await service.createRemoteProject({
      hostId: 'ssh-devbox',
      label: 'Staging API',
      remotePath: '/srv/staging-api'
    })

    expect(validateRemoteRoot).toHaveBeenCalledWith('ssh-devbox', '/srv/staging-api')
    expect(project).toMatchObject({
      kind: 'remote',
      hostId: 'ssh-devbox',
      label: 'Staging API',
      remotePath: '/srv/staging-api'
    })
    await expect(store.getState()).resolves.toMatchObject({
      activeRemoteProjectId: project.id,
      activeProjectSelection: {
        projectKind: 'remote',
        projectId: project.id,
        hostId: 'ssh-devbox'
      },
      activeWorkspaceRoots: ['/srv/staging-api']
    })
  })

  it('renames local, remote, and path project entries', async () => {
    const store = ProjectStore.inMemory({
      ...createDefaultProjectState(),
      localProjects: {
        local1: {
          id: 'local1',
          kind: 'local',
          name: 'Old Local',
          hostId: 'local',
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
          writableRoots: ['/repo']
        }
      },
      remoteProjects: [
        {
          id: 'remote1',
          kind: 'remote',
          hostId: 'ssh-devbox',
          label: 'Old Remote',
          remotePath: '/srv/app',
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z'
        }
      ],
      workspaceRootOptions: [
        {
          root: '/repo',
          label: 'Old Path',
          hostId: 'local',
          addedAt: '2026-06-29T00:00:00.000Z',
          lastOpenedAt: '2026-06-29T00:00:00.000Z'
        }
      ]
    })
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: path }),
      pickWorkspaceRoot: vi.fn()
    })

    await service.renameProject({ projectKind: 'local', projectId: 'local1', label: 'New Local' })
    await service.renameProject({
      projectKind: 'remote',
      projectId: 'remote1',
      label: 'New Remote'
    })
    await service.renameProject({ projectKind: 'path', path: '/repo', label: 'New Path' })

    await expect(store.getState()).resolves.toMatchObject({
      localProjects: {
        local1: { name: 'New Local' }
      },
      remoteProjects: [{ id: 'remote1', label: 'New Remote' }],
      workspaceRootOptions: [{ root: '/repo', label: 'New Path' }]
    })
  })

  it('removes selected projects and clears active selection', async () => {
    const store = ProjectStore.inMemory({
      ...createDefaultProjectState(),
      activeLocalProjectId: 'local1',
      activeProjectSelection: { projectKind: 'local', projectId: 'local1' },
      activeWorkspaceRoots: ['/repo'],
      localProjects: {
        local1: {
          id: 'local1',
          kind: 'local',
          name: 'Local',
          hostId: 'local',
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
          writableRoots: ['/repo']
        }
      },
      projectOrder: ['local1'],
      pinnedProjectIds: ['local1'],
      projectWritableRoots: { local1: ['/repo'] }
    })
    const service = new ProjectApiService({
      store,
      validateLocalRoot: async (path) => ({ realPath: path }),
      pickWorkspaceRoot: vi.fn()
    })

    const state = await service.removeProject({ projectKind: 'local', projectId: 'local1' })

    expect(state.localProjects).toEqual({})
    expect(state.projectOrder).toEqual([])
    expect(state.pinnedProjectIds).toEqual([])
    expect(state.projectWritableRoots).toEqual({})
    expect(state.activeLocalProjectId).toBeUndefined()
    expect(state.activeProjectSelection).toBeUndefined()
    expect(state.activeWorkspaceRoots).toEqual([])
  })
})
