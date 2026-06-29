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
})
