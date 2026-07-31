import { describe, expect, it, vi } from 'vitest'

import { GitManager, type GitHost, type GitRunResult } from './GitManager'
import { invalidateLocalGitWatchCaches } from './LocalGitWatchInvalidation'

describe('invalidateLocalGitWatchCaches', () => {
  it('preserves path-scoped untracked reconciliation for mixed index and working-tree events', async () => {
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'ls-files --others --exclude-standard -z') return ok('new.txt\0')
        if (command === 'ls-files --stage --others --exclude-standard -z -- new.txt') {
          return ok('100644 0123456789012345678901234567890123456789 0\tnew.txt\0')
        }
        return fail(`unexpected command: ${command}`)
      }
    })
    const manager = new GitManager()
    const target = {
      conversationId: 'conversation-1',
      hostId: 'local',
      cwd: '/repo',
      gitRoot: '/repo'
    }
    const worktree = manager.getWorktreeRepositoryForRoot(target.gitRoot, host)

    await expect(worktree.listUntrackedPaths()).resolves.toEqual(['new.txt'])
    invalidateLocalGitWatchCaches(manager, { get: () => host }, target, {
      changeTypes: ['index', 'working-tree'],
      changedPaths: ['new.txt']
    })

    await expect(worktree.listUntrackedPaths()).resolves.toEqual([])
    expect(host.runGit.mock.calls.map(([args]) => args.join(' '))).toEqual([
      'ls-files --others --exclude-standard -z',
      'ls-files --stage --others --exclude-standard -z -- new.txt'
    ])
  })

  it('fully invalidates untracked paths for an index-only event', async () => {
    let untrackedReadCount = 0
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') !== 'ls-files --others --exclude-standard -z') {
          return fail(`unexpected command: ${args.join(' ')}`)
        }
        untrackedReadCount += 1
        return ok(untrackedReadCount === 1 ? 'new.txt\0' : '')
      }
    })
    const manager = new GitManager()
    const target = {
      conversationId: 'conversation-1',
      hostId: 'local',
      cwd: '/repo',
      gitRoot: '/repo'
    }
    const worktree = manager.getWorktreeRepositoryForRoot(target.gitRoot, host)

    await expect(worktree.listUntrackedPaths()).resolves.toEqual(['new.txt'])
    invalidateLocalGitWatchCaches(manager, { get: () => host }, target, {
      changeTypes: ['index']
    })

    await expect(worktree.listUntrackedPaths()).resolves.toEqual([])
    expect(host.runGit).toHaveBeenCalledTimes(2)
  })
})

function createHost(overrides: Partial<GitHost>): GitHost & { runGit: ReturnType<typeof vi.fn> } {
  const runGit = overrides.runGit ?? (async () => ok(''))
  return {
    id: 'local',
    isLocal: true,
    ...overrides,
    runGit: vi.fn(runGit)
  }
}

function ok(stdout: string): GitRunResult {
  return { success: true, code: 0, stdout, stderr: '' }
}

function fail(stderr: string): GitRunResult {
  return { success: false, code: 1, stdout: '', stderr }
}
