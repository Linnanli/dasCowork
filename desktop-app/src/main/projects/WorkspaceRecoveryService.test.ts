import { describe, expect, it, vi } from 'vitest'

import type {
  ManagedWorktreeMetadata,
  ProjectState
} from '../../shared/projects/projectTypes'
import { ProjectStore, createDefaultProjectState } from './ProjectStore'
import { WorkspaceRecoveryService } from './WorkspaceRecoveryService'

const metadata: ManagedWorktreeMetadata = {
  workspaceKind: 'managed-worktree',
  managedByApp: true,
  repositoryRoot: '/repo',
  worktreePath: '/worktrees/fix-123',
  branch: 'fix-123',
  ref: 'main',
  createdFrom: 'conversation-fork',
  recoverable: true
}

function stateWithAssignment(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...createDefaultProjectState(),
    threadProjectAssignments: {
      thread_1: {
        projectKind: 'local',
        projectId: 'project_1',
        cwd: metadata.worktreePath,
        path: metadata.worktreePath,
        managedWorktree: metadata
      }
    },
    ...overrides
  }
}

function createService({
  state = stateWithAssignment(),
  directories = new Set<string>(),
  git = vi.fn(async (_cwd: string, args: readonly string[]) => ({
    stdout: gitOutput(_cwd, args),
    stderr: ''
  }))
}: {
  state?: ProjectState
  directories?: Set<string>
  git?: ReturnType<typeof vi.fn>
} = {}): {
  service: WorkspaceRecoveryService
  store: ReturnType<typeof ProjectStore.inMemory>
  git: ReturnType<typeof vi.fn>
  lstat: ReturnType<typeof vi.fn>
  realpath: ReturnType<typeof vi.fn>
} {
  const store = ProjectStore.inMemory(state)
  const lstat = vi.fn(async (path: string) => {
    if (!directories.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { isDirectory: () => true }
  })
  const realpath = vi.fn(async (path: string) => path)
  const service = new WorkspaceRecoveryService({
    store,
    lstat: lstat as never,
    realpath: realpath as never,
    runGit: git as (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  })
  return { service, store, git, lstat, realpath }
}

describe('WorkspaceRecoveryService', () => {
  it('does not offer restore for an ordinary missing local directory without managed metadata', async () => {
    const { service } = createService({
      state: stateWithAssignment({
        threadProjectAssignments: {
          thread_1: { projectKind: 'local', projectId: 'project_1', cwd: '/gone' }
        }
      })
    })

    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'gone',
      message: '原工作区已不可用。请选择项目并新建任务继续。'
    })
  })

  it('reports remote and projectless tasks without exposing a local restore action', async () => {
    const remote = createService({
      state: stateWithAssignment({
        threadProjectAssignments: {
          thread_1: {
            projectKind: 'remote',
            projectId: 'remote_1',
            hostId: 'host_1',
            cwd: '/remote/project'
          }
        }
      })
    })
    const projectless = createService({
      state: stateWithAssignment({
        threadProjectAssignments: {
          thread_1: {
            projectKind: 'projectless',
            cwd: '/generated',
            workspaceRoot: '/generated',
            outputDirectory: '/generated/out'
          }
        }
      })
    })

    await expect(remote.service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toMatchObject({
      state: 'remote-unavailable'
    })
    await expect(projectless.service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'not-applicable'
    })
  })

  it('only marks a missing app-managed worktree restorable after repo, branch, and ref checks', async () => {
    const { service, git } = createService()

    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'restorable'
    })
    expect(git).toHaveBeenCalledWith('/repo', ['rev-parse', '--show-toplevel'])
    expect(git).toHaveBeenCalledWith('/repo', ['show-ref', '--verify', 'refs/heads/fix-123'])
    expect(git).toHaveBeenCalledWith('/repo', ['rev-parse', '--verify', 'main^{commit}'])
  })

  it('rejects incomplete metadata instead of guessing a restore command', async () => {
    const { service, git } = createService({
      state: stateWithAssignment({
        threadProjectAssignments: {
          thread_1: {
            projectKind: 'local',
            projectId: 'project_1',
            cwd: metadata.worktreePath,
            managedWorktree: { ...metadata, branch: '../escape' }
          }
        }
      })
    })

    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toMatchObject({
      state: 'checking-failed'
    })
    expect(git).not.toHaveBeenCalled()
  })

  it('accepts a normal slash-delimited branch but treats inaccessible paths as checking failures', async () => {
    const state = stateWithAssignment({
      threadProjectAssignments: {
        thread_1: {
          projectKind: 'local',
          projectId: 'project_1',
          cwd: metadata.worktreePath,
          managedWorktree: { ...metadata, branch: 'feature/fix-123' }
        }
      }
    })
    const { service, git } = createService({
      state,
      git: vi.fn(async (_cwd: string, args: readonly string[]) => {
        if (args[0] === 'show-ref') return { stdout: 'abcdef refs/heads/feature/fix-123\n', stderr: '' }
        return { stdout: gitOutput(_cwd, args), stderr: '' }
      })
    })

    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'restorable'
    })
    expect(git).toHaveBeenCalledWith('/repo', ['show-ref', '--verify', 'refs/heads/feature/fix-123'])

    const inaccessible = createService({
      state,
      directories: new Set([metadata.worktreePath])
    })
    inaccessible.lstat.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(
      inaccessible.service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })
    ).resolves.toMatchObject({ state: 'checking-failed' })
  })

  it('recognizes a verified existing managed worktree as available', async () => {
    const { service } = createService({ directories: new Set(['/worktrees/fix-123', '/repo', '/repo/.git']) })

    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'available'
    })
  })

  it('restores only the saved worktree branch and persists the verified assignment', async () => {
    const directories = new Set<string>()
    const git = vi.fn(async (cwd: string, args: readonly string[]) => {
      if (args[0] === 'worktree' && args[1] === 'add') directories.add(metadata.worktreePath)
      return { stdout: gitOutput(cwd, args), stderr: '' }
    })
    const { service, store } = createService({ directories, git })

    await expect(service.restore({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'available'
    })
    expect(git).toHaveBeenCalledWith('/repo', [
      'worktree',
      'add',
      '/worktrees/fix-123',
      'fix-123'
    ])
    await expect(store.getState()).resolves.toMatchObject({
      threadProjectAssignments: {
        thread_1: { cwd: '/worktrees/fix-123', path: '/worktrees/fix-123' }
      }
    })
  })

  it('keeps a safe restore failure visible until a retry succeeds', async () => {
    const git = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'worktree') throw new Error('private git details')
      return { stdout: gitOutput(_cwd, args), stderr: '' }
    })
    const { service } = createService({ git })

    await expect(service.restore({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toEqual({
      state: 'restore-failed',
      message: '恢复工作区失败。请重试，或选择项目后新建任务。'
    })
    await expect(service.inspect({ conversationId: 'conversation_1', threadId: 'thread_1' })).resolves.toMatchObject({
      state: 'restore-failed'
    })
  })
})

function gitOutput(cwd: string, args: readonly string[]): string {
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
    return `${cwd}\n`
  }
  if (args[0] === 'branch') return 'fix-123\n'
  if (args[0] === 'show-ref') return 'abcdef refs/heads/fix-123\n'
  if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return '/repo/.git\n'
  return 'abcdef\n'
}
