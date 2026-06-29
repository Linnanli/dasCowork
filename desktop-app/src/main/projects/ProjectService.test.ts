import { describe, expect, it, vi } from 'vitest'

import type { ResolvedExecutionTarget } from '../../shared/projects/projectTypes'
import {
  ProjectService,
  type ProjectServiceDependencies,
  type ThreadReader
} from './ProjectService'
import {
  ProjectStore,
  createDefaultProjectState,
  type ProjectState
} from './ProjectStore'

const now = '2026-06-29T00:00:00.000Z'

type ProjectServiceFixture = {
  service: ProjectService
  readThread: ReturnType<typeof vi.fn<ThreadReader>>
  validateLocalRoot: ReturnType<typeof vi.fn<ProjectServiceDependencies['validateLocalRoot']>>
  validateRemoteRoot: ReturnType<typeof vi.fn<ProjectServiceDependencies['validateRemoteRoot']>>
  createProjectlessWorkspace: ReturnType<
    typeof vi.fn<ProjectServiceDependencies['createProjectlessWorkspace']>
  >
}

function makeProjectService(state: Partial<ProjectState> = {}): ProjectServiceFixture {
  const store = ProjectStore.inMemory({
    ...createDefaultProjectState(),
    ...state
  })
  const validateLocalRoot = vi.fn(async (path: string) => ({ realPath: path }))
  const validateRemoteRoot = vi.fn(async () => undefined)
  const createProjectlessWorkspace = vi.fn(async () => ({
    cwd: '/tmp/codex/projectless/work',
    workspaceRoot: '/tmp/codex/projectless',
    outputDirectory: '/tmp/codex/projectless/out'
  }))
  const readThread = vi.fn(async () => ({ thread: { cwd: '/thread/cwd' } }))

  return {
    service: new ProjectService({
      store,
      validateLocalRoot,
      validateRemoteRoot,
      createProjectlessWorkspace,
      readThread
    }),
    readThread,
    validateLocalRoot,
    validateRemoteRoot,
    createProjectlessWorkspace
  }
}

describe('ProjectService', () => {
  it('resolves local project to cwd and workspace roots', async () => {
    const { service } = makeProjectService({
      localProjects: {
        p1: {
          id: 'p1',
          kind: 'local',
          name: 'App',
          hostId: 'local',
          createdAt: now,
          updatedAt: now,
          writableRoots: ['/repo', '/repo/packages/api']
        }
      }
    })

    await expect(
      service.resolveNewThreadTarget({
        selection: { projectKind: 'local', projectId: 'p1' },
        prompt: 'fix tests'
      })
    ).resolves.toMatchObject({
      hostId: 'local',
      cwd: '/repo',
      workspaceRoots: ['/repo', '/repo/packages/api'],
      workspaceKind: 'project',
      projectAssignment: { projectKind: 'local', projectId: 'p1', cwd: '/repo' }
    })
  })

  it('uses local project defaultCwd when provided', async () => {
    const { service } = makeProjectService({
      localProjects: {
        p1: {
          id: 'p1',
          kind: 'local',
          name: 'App',
          hostId: 'local',
          createdAt: now,
          updatedAt: now,
          writableRoots: ['/repo', '/repo/packages/api'],
          defaultCwd: '/repo/packages/api'
        }
      }
    })

    await expect(
      service.resolveNewThreadTarget({
        selection: { projectKind: 'local', projectId: 'p1' },
        prompt: 'fix api'
      })
    ).resolves.toMatchObject({
      cwd: '/repo/packages/api',
      workspaceRoots: ['/repo', '/repo/packages/api'],
      projectAssignment: { projectKind: 'local', projectId: 'p1', cwd: '/repo/packages/api' }
    })
  })

  it('resolves remote project to host and remote root', async () => {
    const { service, validateRemoteRoot } = makeProjectService({
      remoteProjects: [
        {
          id: 'r1',
          kind: 'remote',
          hostId: 'ssh-prod',
          label: 'Prod',
          remotePath: '/srv/app',
          createdAt: now,
          updatedAt: now
        }
      ]
    })

    await expect(
      service.resolveNewThreadTarget({
        selection: { projectKind: 'remote', projectId: 'r1', hostId: 'ssh-prod' },
        prompt: 'inspect logs'
      })
    ).resolves.toEqual({
      hostId: 'ssh-prod',
      cwd: '/srv/app',
      workspaceRoots: ['/srv/app'],
      workspaceKind: 'project',
      projectAssignment: {
        projectKind: 'remote',
        projectId: 'r1',
        hostId: 'ssh-prod',
        cwd: '/srv/app'
      }
    })
    expect(validateRemoteRoot).toHaveBeenCalledWith('ssh-prod', '/srv/app')
  })

  it('normalizes path selections through local validation', async () => {
    const { service, validateLocalRoot } = makeProjectService()
    validateLocalRoot.mockResolvedValueOnce({ realPath: '/real/repo' })

    await expect(
      service.resolveNewThreadTarget({
        selection: { projectKind: 'path', path: '~/repo' },
        prompt: 'start here'
      })
    ).resolves.toEqual({
      hostId: 'local',
      cwd: '/real/repo',
      workspaceRoots: ['/real/repo'],
      workspaceKind: 'project',
      projectAssignment: {
        projectKind: 'local',
        projectId: '/real/repo',
        path: '/real/repo',
        cwd: '/real/repo'
      }
    })
    expect(validateLocalRoot).toHaveBeenCalledWith('~/repo')
  })

  it('creates projectless workspace when no project is selected', async () => {
    const { service, createProjectlessWorkspace } = makeProjectService()

    await expect(
      service.resolveNewThreadTarget({
        prompt: 'scratch work'
      })
    ).resolves.toEqual({
      hostId: 'local',
      cwd: '/tmp/codex/projectless/work',
      workspaceRoots: ['/tmp/codex/projectless'],
      workspaceKind: 'projectless',
      projectAssignment: {
        projectKind: 'projectless',
        cwd: '/tmp/codex/projectless/work',
        workspaceRoot: '/tmp/codex/projectless',
        outputDirectory: '/tmp/codex/projectless/out'
      }
    })
    expect(createProjectlessWorkspace).toHaveBeenCalledWith({ prompt: 'scratch work' })
  })

  it('resolves existing thread from stored assignment before app-server cwd', async () => {
    const { service, readThread } = makeProjectService({
      threadProjectAssignments: {
        c1: {
          projectKind: 'local',
          projectId: 'p1',
          cwd: '/assigned/cwd'
        }
      }
    })

    await expect(
      service.resolveExistingThreadTarget({
        conversationId: 'c1',
        threadId: 't1'
      })
    ).resolves.toMatchObject({
      hostId: 'local',
      cwd: '/assigned/cwd',
      workspaceRoots: ['/assigned/cwd'],
      workspaceKind: 'project'
    })
    expect(readThread).not.toHaveBeenCalled()
  })

  it('falls back to app-server thread cwd for existing threads', async () => {
    const { service, readThread } = makeProjectService()

    await expect(
      service.resolveExistingThreadTarget({
        conversationId: 'c1',
        threadId: 't1'
      })
    ).resolves.toEqual({
      hostId: 'local',
      cwd: '/thread/cwd',
      workspaceRoots: ['/thread/cwd'],
      workspaceKind: 'project'
    } satisfies ResolvedExecutionTarget)
    expect(readThread).toHaveBeenCalledWith('t1')
  })

  it('does not use active project for existing thread continuation by default', async () => {
    const { service, readThread } = makeProjectService({
      activeLocalProjectId: 'p1',
      localProjects: {
        p1: {
          id: 'p1',
          kind: 'local',
          name: 'App',
          hostId: 'local',
          createdAt: now,
          updatedAt: now,
          writableRoots: ['/active/repo']
        }
      }
    })
    readThread.mockResolvedValueOnce({ thread: { cwd: null } })

    await expect(
      service.resolveExistingThreadTarget({
        conversationId: 'c1',
        threadId: 't1'
      })
    ).resolves.toBeNull()
  })

  it('does not use active project for existing thread continuation even when fallback is allowed', async () => {
    const { service, readThread } = makeProjectService({
      activeLocalProjectId: 'p1',
      localProjects: {
        p1: {
          id: 'p1',
          kind: 'local',
          name: 'App',
          hostId: 'local',
          createdAt: now,
          updatedAt: now,
          writableRoots: ['/active/repo']
        }
      }
    })
    readThread.mockResolvedValueOnce({ thread: { cwd: null } })

    await expect(
      service.resolveExistingThreadTarget({
        conversationId: 'c1',
        threadId: 't1',
        allowActiveProjectFallback: true
      })
    ).resolves.toBeNull()
  })

  it('uses active project fallback for brand-new home composer state', async () => {
    const { service, readThread } = makeProjectService({
      activeLocalProjectId: 'p1',
      localProjects: {
        p1: {
          id: 'p1',
          kind: 'local',
          name: 'App',
          hostId: 'local',
          createdAt: now,
          updatedAt: now,
          writableRoots: ['/active/repo']
        }
      }
    })

    await expect(
      service.resolveExistingThreadTarget({
        conversationId: 'c1',
        allowActiveProjectFallback: true
      })
    ).resolves.toMatchObject({
      hostId: 'local',
      cwd: '/active/repo',
      workspaceRoots: ['/active/repo'],
      workspaceKind: 'project'
    })
    expect(readThread).not.toHaveBeenCalled()
  })
})
