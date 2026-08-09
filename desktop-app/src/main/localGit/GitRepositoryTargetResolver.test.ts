import { describe, expect, it } from 'vitest'

import type { ProjectService } from '../projects/ProjectService'
import { GitHostRegistry } from './GitHostRegistry'
import { GitManager, type GitHost, type GitRunResult } from './GitManager'
import { GitRepositoryTargetResolver } from './GitRepositoryTargetResolver'

describe('GitRepositoryTargetResolver', () => {
  it('uses the active project only for a pre-send conversation', async () => {
    const repo = '/repo'
    let receivedInput: Parameters<ProjectService['resolveExistingThreadTarget']>[0] | undefined
    const resolver = createResolver(
      async (input) => {
        receivedInput = input
        return {
          hostId: 'local',
          cwd: repo,
          workspaceRoots: [repo],
          workspaceKind: 'project'
        }
      },
      new TestHostRegistry(createLocalHost(repo))
    )

    await resolver.resolve({ conversationId: 'new-conversation' })
    expect(receivedInput).toMatchObject({
      conversationId: 'new-conversation',
      allowActiveProjectFallback: true
    })

    await resolver.resolve({ conversationId: 'saved-conversation', threadId: 'thread-1' })
    expect(receivedInput).toMatchObject({
      conversationId: 'saved-conversation',
      threadId: 'thread-1',
      allowActiveProjectFallback: false
    })
  })

  it('discovers a repository from a trusted nested historical cwd', async () => {
    const repo = '/repo'
    const nested = '/repo/src/feature'
    const resolver = createResolver(
      async () => ({
        hostId: 'local',
        cwd: nested,
        workspaceRoots: [nested],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'local',
          projectId: 'nested-project',
          cwd: nested
        }
      }),
      new TestHostRegistry(createLocalHost(repo))
    )

    await expect(
      resolver.resolve({ conversationId: 'conversation', threadId: 'historical-thread' })
    ).resolves.toEqual({
      status: 'ready',
      target: {
        conversationId: 'conversation',
        threadId: 'historical-thread',
        hostId: 'local',
        cwd: nested,
        gitRoot: repo
      }
    })
  })

  it('P004-EDGE-01 returns unavailable instead of throwing for a non-repository cwd', async () => {
    const cwd = '/not-a-repository'
    const resolver = createResolver(
      async () => ({
        hostId: 'local',
        cwd,
        workspaceRoots: [cwd],
        workspaceKind: 'project'
      }),
      new TestHostRegistry(createLocalHost('/repo', { notRepository: true }))
    )

    await expect(resolver.resolve({ conversationId: 'conversation' })).resolves.toMatchObject({
      status: 'unavailable'
    })
  })

  it.each([
    {
      label: 'host',
      overrides: { hostId: 'attacker' }
    },
    {
      label: 'cwd',
      overrides: { cwd: '/tmp/forged' }
    },
    {
      label: 'git root',
      overrides: { gitRoot: '/tmp/forged' }
    }
  ])('rejects a renderer target whose $label was forged', async ({ overrides }) => {
    const repo = '/repo'
    const resolver = createResolver(
      async () => ({
        hostId: 'local',
        cwd: repo,
        workspaceRoots: [repo],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'local',
          projectId: repo,
          cwd: repo
        }
      }),
      new TestHostRegistry(createLocalHost(repo))
    )

    await expect(
      resolver.assertRepository({
        conversationId: 'conversation',
        hostId: 'local',
        cwd: repo,
        gitRoot: repo,
        ...overrides
      })
    ).rejects.toThrow('no longer matches')
  })

  it('keeps remote and local repositories isolated by host identity', async () => {
    const remoteHost = createRemoteHost('devbox', '/srv/repo')
    const hosts = new TestHostRegistry(remoteHost)
    const resolver = createResolver(
      async () => ({
        hostId: 'devbox',
        cwd: '/srv/repo/packages/app',
        workspaceRoots: ['/srv/repo'],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'remote',
          projectId: 'remote-project',
          hostId: 'devbox',
          cwd: '/srv/repo/packages/app'
        }
      }),
      hosts
    )

    const result = await resolver.resolve({ conversationId: 'remote-conversation' })
    expect(result).toEqual({
      status: 'ready',
      target: {
        conversationId: 'remote-conversation',
        hostId: 'devbox',
        cwd: '/srv/repo/packages/app',
        gitRoot: '/srv/repo'
      }
    })
  })

  it('accepts a remote Git root that canonicalizes a trusted POSIX cwd', async () => {
    const remoteHost = createRemoteHost('devbox', '/private/var/folders/repo')
    const hosts = new TestHostRegistry(remoteHost)
    const resolver = createResolver(
      async () => ({
        hostId: 'devbox',
        cwd: '/var/folders/repo/packages/app',
        workspaceRoots: ['/var/folders/repo'],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'remote',
          projectId: 'remote-project',
          hostId: 'devbox',
          cwd: '/var/folders/repo/packages/app'
        }
      }),
      hosts
    )

    await expect(resolver.resolve({ conversationId: 'remote-conversation' })).resolves.toEqual({
      status: 'ready',
      target: {
        conversationId: 'remote-conversation',
        hostId: 'devbox',
        cwd: '/var/folders/repo/packages/app',
        gitRoot: '/private/var/folders/repo'
      }
    })
  })
})

function createResolver(
  resolveExistingThreadTarget: (
    input: Parameters<ProjectService['resolveExistingThreadTarget']>[0]
  ) => Promise<{
    hostId: string
    cwd: string
    workspaceRoots: string[]
    workspaceKind: 'project'
    projectAssignment?:
      | { projectKind: 'local'; projectId: string; cwd: string }
      | {
          projectKind: 'remote'
          projectId: string
          hostId: string
          cwd: string
        }
  }>,
  hosts: GitHostRegistry
): GitRepositoryTargetResolver {
  return new GitRepositoryTargetResolver({
    projectService: { resolveExistingThreadTarget } as unknown as ProjectService,
    gitManager: new GitManager(),
    hosts
  })
}

class TestHostRegistry extends GitHostRegistry {
  constructor(private readonly host: GitHost) {
    super()
  }

  override get(hostId: string): GitHost {
    if (hostId !== this.host.id) throw new Error('Unexpected host')
    return this.host
  }
}

function createRemoteHost(id: string, root: string): GitHost {
  return createHost({
    id,
    root,
    isLocal: false,
    expectedCwd: /\/packages\/app$/u
  })
}

function createLocalHost(root: string, options: { notRepository?: boolean } = {}): GitHost {
  return createHost({ id: 'local', root, isLocal: true, ...options })
}

function createHost(options: {
  id: string
  root: string
  isLocal: boolean
  expectedCwd?: RegExp
  notRepository?: boolean
}): GitHost {
  return {
    id: options.id,
    isLocal: options.isLocal,
    platformFamily: 'posix',
    async runGit(args, cwd): Promise<GitRunResult> {
      if (args.join(' ') === 'rev-parse --show-toplevel') {
        if (options.expectedCwd) expect(cwd).toMatch(options.expectedCwd)
        if (options.notRepository) {
          return {
            success: false,
            code: 128,
            stdout: '',
            stderr: 'fatal: not a git repository (or any of the parent directories): .git'
          }
        }
        return { success: true, code: 0, stdout: `${options.root}\n`, stderr: '' }
      }
      return { success: false, code: 1, stdout: '', stderr: 'unexpected command' }
    }
  }
}
