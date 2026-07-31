import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { LocalGitHost } from './GitHostRegistry'
import {
  GitManager,
  GitReviewSnapshotStaleError,
  type GitAppEvent,
  type GitHost,
  type GitRunOptions,
  type GitRunResult
} from './GitManager'
import { computeWorkspaceStateHash } from './reviewSnapshot'

describe('GitManager', () => {
  it('discovers and memoizes worktree roots by host id and root', async () => {
    const host = createHost({
      async runGit(args, cwd) {
        if (args.join(' ') === 'rev-parse --show-toplevel') {
          return ok(cwd.startsWith('/repo') ? '/repo\n' : '/other\n')
        }
        return fail('unexpected command')
      }
    })
    const manager = new GitManager()

    const first = await manager.getWorktreeRepository('/repo/packages/app', host)
    const second = await manager.getWorktreeRepository('/repo/packages/app', host)
    const sameRootDifferentCwd = await manager.getWorktreeRepository('/repo/other', host)
    const otherHostRepo = await manager.getWorktreeRepository('/repo/packages/app', {
      ...host,
      id: 'remote'
    })

    expect(first).toBe(second)
    expect(first).toBe(sameRootDifferentCwd)
    expect(first).not.toBe(otherHostRepo)
    expect(first?.root).toBe('/repo')
    expect(first?.host).toBe(host)
    expect(host.runGit).toHaveBeenCalledTimes(3)
  })

  it('discovers common dir repositories and origin URLs', async () => {
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'rev-parse --show-toplevel') return ok('/repo\n')
        if (command === 'rev-parse --git-common-dir') return ok('.git\n')
        if (command === 'config --get remote.origin.url') return ok('git@example.com:repo.git\n')
        return fail('unexpected command')
      }
    })
    const manager = new GitManager()

    const repo = await manager.getRepoRepository('/repo/nested', host)
    const sameRepo = await manager.getRepoRepository('/repo/nested', host)

    expect(repo).toBe(sameRepo)
    expect(repo?.getCommonDir()).toBe('/repo/.git')
    await expect(repo?.getOriginUrl()).resolves.toBe('git@example.com:repo.git')
    await expect(repo?.getOriginUrl()).resolves.toBe('git@example.com:repo.git')
    expect(host.runGit).toHaveBeenCalledTimes(3)
  })

  it('resolves relative common dirs with the remote host platform family', async () => {
    const host = createHost({
      platformFamily: 'windows',
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'rev-parse --show-toplevel') return ok('C:\\repo\n')
        if (command === 'rev-parse --git-common-dir') return ok('.git\n')
        return fail('unexpected command')
      }
    })

    const repo = await new GitManager().getRepoRepository('C:\\repo\\nested', host)

    expect(repo?.getCommonDir()).toBe('C:\\repo\\.git')
  })

  it('returns null for non-git directories without throwing', async () => {
    const host = createHost({
      async runGit() {
        return { success: false, code: 128, stdout: '', stderr: 'fatal: not a git repository' }
      }
    })

    await expect(new GitManager().getWorktreeRepository('/tmp/plain', host)).resolves.toBeNull()
  })

  it('preserves filesystem roots when Git reports the repository root', async () => {
    const posixHost = createHost({
      async runGit() {
        return ok('/\n')
      }
    })
    const windowsHost = createHost({
      platformFamily: 'windows',
      async runGit() {
        return ok('C:\\\n')
      }
    })

    await expect(new GitManager().getWorktreeRepository('/', posixHost)).resolves.toMatchObject({
      root: '/'
    })
    await expect(
      new GitManager().getWorktreeRepository('C:\\', windowsHost)
    ).resolves.toMatchObject({ root: 'C:\\' })
  })

  it('retry-caches permission cwd failures for one second and can be invalidated', async () => {
    vi.useFakeTimers()
    try {
      const host = createHost({
        async runGit() {
          return {
            success: false,
            code: 1,
            stdout: '',
            stderr: 'fatal: unable to read current working directory: Operation not permitted'
          }
        }
      })
      const manager = new GitManager()

      await expect(manager.getWorktreeRepository('/blocked', host)).rejects.toThrow(
        'Failed to resolve git root'
      )
      await expect(manager.getWorktreeRepository('/blocked', host)).rejects.toThrow(
        'Failed to resolve git root'
      )
      expect(host.runGit).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1001)
      await expect(manager.getWorktreeRepository('/blocked', host)).rejects.toThrow(
        'Failed to resolve git root'
      )
      expect(host.runGit).toHaveBeenCalledTimes(2)

      manager.invalidateStableMetadata()
      await expect(manager.getWorktreeRepository('/blocked', host)).rejects.toThrow(
        'Failed to resolve git root'
      )
      expect(host.runGit).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('increments worktree read generations for lifecycle events and mutation invalidation', async () => {
    const events = new EventSourceFake()
    const manager = new GitManager(events)
    const host = createHost({
      async runGit() {
        return ok('/repo\n')
      }
    })
    const worktree = await manager.getWorktreeRepository('/repo', host)
    expect(worktree?.gitReadGeneration).toBe(0)

    events.emit({ type: 'foreground' })
    expect(worktree?.gitReadGeneration).toBe(0)

    events.emit({ type: 'background' })
    events.emit({ type: 'foreground' })
    expect(worktree?.gitReadGeneration).toBe(1)

    events.emit({ type: 'turnComplete' })
    expect(worktree?.gitReadGeneration).toBe(2)

    await manager.invalidateGitReadCachesForMutation('/repo', host)
    expect(worktree?.gitReadGeneration).toBe(3)
  })

  it('advances review snapshots and rejects retired snapshot operations as stale', async () => {
    let releaseOperation: (() => void) | undefined
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') === 'rev-parse --git-path objects') return ok('.git/objects\n')
        if (args.join(' ') === 'rev-parse --git-path index') return ok('.git/index\n')
        if (args.join(' ') === 'rev-parse --shared-index-path') return ok('')
        await new Promise<void>((resolve) => {
          releaseOperation = resolve
        })
        return ok('done\n')
      },
      createTempDirectory: vi
        .fn()
        .mockResolvedValueOnce('/tmp/codex-review-objects-1')
        .mockResolvedValueOnce('/tmp/codex-index-1'),
      copyFile: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)
    const snapshot = worktree.reviewSnapshot

    const operation = snapshot.withTempIndex((env) =>
      snapshot.git(['status'], { env: { USER_ENV: '1', ...env } })
    )
    await vi.waitFor(() => expect(releaseOperation).toBeDefined())

    worktree.invalidateGitReadCachesForMutation()
    expect(worktree.reviewSnapshot.generation).toBe(1)
    expect(() => worktree.requireReviewSnapshot(0)).toThrow(GitReviewSnapshotStaleError)

    releaseOperation?.()
    await expect(operation).rejects.toThrow(GitReviewSnapshotStaleError)
    expect(host.runGit).toHaveBeenCalledWith(
      ['status'],
      '/repo',
      expect.objectContaining({
        env: {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify('/repo/.git/objects'),
          GIT_OBJECT_DIRECTORY: '/tmp/codex-review-objects-1',
          GIT_INDEX_FILE: '/tmp/codex-index-1/index',
          USER_ENV: '1'
        }
      })
    )
    await vi.waitFor(() =>
      expect(host.remove).toHaveBeenCalledWith('/tmp/codex-review-objects-1', {
        recursive: true,
        force: true
      })
    )
    expect(host.remove).toHaveBeenCalledWith('/tmp/codex-index-1', {
      recursive: true,
      force: true
    })
  })

  it('forwards WorktreeRepository.git through host.runGit with root cwd and options', async () => {
    const host = createHost({
      async runGit() {
        return ok('main\n')
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)
    const options: GitRunOptions = { timeoutMs: 100, input: 'input' }

    await expect(worktree.git(['branch', '--show-current'], options)).resolves.toMatchObject({
      success: true,
      stdout: 'main\n'
    })
    expect(host.runGit).toHaveBeenCalledWith(['branch', '--show-current'], '/repo', options)
  })

  it('creates generation-scoped review query keys and deterministic git diff commands', async () => {
    const host = createHost({
      async runGit() {
        return ok('diff output')
      }
    })
    const snapshot = new GitManager().getWorktreeRepositoryForRoot('/repo', host).reviewSnapshot

    await expect(snapshot.gitDiff(['--cached'], { binary: true })).resolves.toMatchObject({
      success: true
    })
    expect(snapshot.queryKey('review-file', 'src/a.ts')).toEqual([
      'git',
      'local',
      '/repo',
      'review-file',
      'review',
      '0',
      'src/a.ts'
    ])
    expect(host.runGit).toHaveBeenCalledWith(
      [
        '-c',
        'diff.mnemonicPrefix=false',
        '-c',
        'diff.noprefix=false',
        '-c',
        'core.quotePath=false',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--color=never',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--binary',
        '--cached'
      ],
      '/repo',
      expect.objectContaining({ maxOutputBytes: 32 * 1024 * 1024 })
    )
  })

  it('caches scoped config reads and enables worktree config before retrying a write', async () => {
    let worktreeConfigEnabled = false
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'config --get remote.origin.url') return ok('git@example.com:repo.git\n')
        if (command === 'config --worktree feature.flag true') {
          return worktreeConfigEnabled
            ? ok('')
            : fail('this working tree has no worktreeConfig extension')
        }
        if (command === 'config extensions.worktreeConfig true') {
          worktreeConfigEnabled = true
          return ok('')
        }
        return fail(`unexpected command: ${command}`)
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    await expect(worktree.getConfigValue('remote.origin.url')).resolves.toBe(
      'git@example.com:repo.git\n'
    )
    await expect(worktree.getConfigValue('remote.origin.url')).resolves.toBe(
      'git@example.com:repo.git\n'
    )
    await expect(worktree.setConfigValueForScope('feature.flag', 'true', 'worktree')).resolves.toBe(
      true
    )
    expect(host.runGit).toHaveBeenCalledTimes(4)
  })

  it('invalidates cached reads only for the matching lifecycle reason', async () => {
    const host = createHost({
      async runGit() {
        return ok('')
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)
    const head = vi.fn(async () => 'head-1')
    const config = vi.fn(async () => 'config-1')
    const shortLived = vi.fn(async () => 'status-1')

    await Promise.all([
      worktree.readCached('head', [], head, {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: ['head'] }
      }),
      worktree.readCached('config', [], config, {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: ['config'] }
      }),
      worktree.readCached('status', [], shortLived, {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: 'short-lived' }
      })
    ])

    worktree.invalidateGitReadCachesForRepoChange('head')
    await worktree.readCached('head', [], head, { staleTime: Infinity })
    await worktree.readCached('config', [], config, { staleTime: Infinity })
    await worktree.readCached('status', [], shortLived, { staleTime: Infinity })
    expect(head).toHaveBeenCalledTimes(2)
    expect(config).toHaveBeenCalledOnce()
    expect(shortLived).toHaveBeenCalledTimes(2)
  })

  it('caches workspace state hashes until a working-tree change invalidates them', async () => {
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'ls-files --others --exclude-standard -z') return ok('new-file.txt\0')
        if (command === 'diff --raw -z') return ok('')
        if (command === 'diff --cached --raw -z') return ok('')
        if (command === 'rev-parse HEAD') return ok('abc123\n')
        return fail(`unexpected command: ${command}`)
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    const first = await computeWorkspaceStateHash(worktree)
    const second = await computeWorkspaceStateHash(worktree)

    expect(second).toBe(first)
    expect(host.runGit).toHaveBeenCalledTimes(4)

    worktree.invalidateGitReadCachesForRepoChange('working-tree')
    await expect(computeWorkspaceStateHash(worktree)).resolves.toBe(first)
    expect(host.runGit).toHaveBeenCalledTimes(8)
  })

  it('coalesces concurrent all-untracked reads for the same untracked generation', async () => {
    let releaseList: (() => void) | undefined
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') === 'ls-files --others --exclude-standard -z') {
          await new Promise<void>((resolve) => {
            releaseList = resolve
          })
          return ok('new.txt\0')
        }
        return fail(`unexpected command: ${args.join(' ')}`)
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    const first = worktree.listUntrackedPaths()
    const second = worktree.listUntrackedPaths()
    await vi.waitFor(() => expect(releaseList).toBeDefined())
    expect(host.runGit).toHaveBeenCalledTimes(1)
    releaseList?.()

    await expect(first).resolves.toEqual(['new.txt'])
    await expect(second).resolves.toEqual(['new.txt'])
  })

  it('retries an all-untracked read when invalidation happens while the first command is in flight', async () => {
    let releaseStaleList: (() => void) | undefined
    let listCount = 0
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') !== 'ls-files --others --exclude-standard -z') {
          return fail(`unexpected command: ${args.join(' ')}`)
        }
        listCount += 1
        if (listCount === 1) {
          await new Promise<void>((resolve) => {
            releaseStaleList = resolve
          })
          return ok('stale.txt\0')
        }
        return ok('fresh.txt\0')
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    const read = worktree.listUntrackedPaths()
    await vi.waitFor(() => expect(releaseStaleList).toBeDefined())
    worktree.invalidateUntrackedPathsCache()
    releaseStaleList?.()

    await expect(read).resolves.toEqual(['fresh.txt'])
    expect(host.runGit).toHaveBeenCalledTimes(2)
  })

  it('keeps all-untracked TTL for twenty seconds after a slow read', async () => {
    vi.useFakeTimers()
    try {
      let listCount = 0
      const host = createHost({
        async runGit(args) {
          if (args.join(' ') !== 'ls-files --others --exclude-standard -z') {
            return fail(`unexpected command: ${args.join(' ')}`)
          }
          listCount += 1
          if (listCount === 1) vi.setSystemTime(7_001)
          return ok(`file-${listCount}.txt\0`)
        }
      })
      const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

      vi.setSystemTime(0)
      await expect(worktree.listUntrackedPaths()).resolves.toEqual(['file-1.txt'])
      vi.setSystemTime(27_000)
      await expect(worktree.listUntrackedPaths()).resolves.toEqual(['file-1.txt'])
      vi.setSystemTime(27_002)
      await expect(worktree.listUntrackedPaths()).resolves.toEqual(['file-2.txt'])
      expect(host.runGit).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('selectively reconciles reliable untracked path invalidations against a full cache', async () => {
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'ls-files --others --exclude-standard -z') return ok('a.txt\0b.txt\0')
        if (command === 'ls-files --stage --others --exclude-standard -z -- b.txt c.txt') {
          return ok('c.txt\0')
        }
        return fail(`unexpected command: ${command}`)
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    await expect(worktree.listUntrackedPaths()).resolves.toEqual(['a.txt', 'b.txt'])
    worktree.invalidateUntrackedPathsCache(['b.txt', 'c.txt'])
    await expect(worktree.listUntrackedPaths()).resolves.toEqual(['a.txt', 'c.txt'])

    expect(host.runGit).toHaveBeenCalledTimes(2)
  })

  it('falls back to a full all-untracked invalidation for ignore-file path changes', async () => {
    let listCount = 0
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') !== 'ls-files --others --exclude-standard -z') {
          return fail(`unexpected command: ${args.join(' ')}`)
        }
        listCount += 1
        return ok(listCount === 1 ? 'ignored.txt\0' : '')
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    await expect(worktree.listUntrackedPaths()).resolves.toEqual(['ignored.txt'])
    worktree.invalidateUntrackedPathsCache(['.gitignore'])
    await expect(worktree.listUntrackedPaths()).resolves.toEqual([])

    expect(host.runGit).toHaveBeenCalledTimes(2)
  })

  it('keeps short-lived and all-untracked generations independent', async () => {
    const host = createHost({
      async runGit() {
        return ok('')
      }
    })
    const worktree = new GitManager().getWorktreeRepositoryForRoot('/repo', host)

    worktree.clearShortLivedGitReadCaches()
    expect(worktree.gitReadGeneration).toBe(1)
    expect(worktree.untrackedGeneration).toBe(0)

    worktree.invalidateUntrackedPathsCache()
    expect(worktree.gitReadGeneration).toBe(1)
    expect(worktree.untrackedGeneration).toBe(1)
  })

  it('copies the current index into a temporary review index and cleans it up', async () => {
    const host = createHost({
      async runGit(args) {
        if (args.join(' ') === 'rev-parse --git-path objects') return ok('.git/objects\n')
        if (args.join(' ') === 'rev-parse --git-path index') return ok('.git/index\n')
        return ok('')
      },
      createTempDirectory: vi
        .fn()
        .mockResolvedValueOnce('/tmp/codex-review-objects-1')
        .mockResolvedValueOnce('/tmp/codex-index-1'),
      copyFile: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    })
    const snapshot = new GitManager().getWorktreeRepositoryForRoot('/repo', host).reviewSnapshot

    await expect(snapshot.withTempIndex(async (env) => env)).resolves.toMatchObject({
      GIT_INDEX_FILE: '/tmp/codex-index-1/index',
      GIT_OBJECT_DIRECTORY: '/tmp/codex-review-objects-1'
    })
    expect(host.copyFile).toHaveBeenCalledWith(
      '/repo/.git/index',
      '/tmp/codex-index-1/index',
      expect.objectContaining({ signal: snapshot.signal })
    )
    expect(host.remove).toHaveBeenCalledWith('/tmp/codex-index-1', {
      recursive: true,
      force: true
    })
    snapshot.retire()
  })

  it('copies a shared index and resolves non-.git git paths through git-dir', async () => {
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        if (command === 'rev-parse --git-path objects') return ok('.git/objects\n')
        if (command === 'rev-parse --git-path index') return ok('worktrees/app/index\n')
        if (command === 'rev-parse --git-dir') return ok('.git/worktrees/app\n')
        if (command === 'rev-parse --shared-index-path') return ok('.git/sharedindex.abc\n')
        return fail(`unexpected command: ${command}`)
      },
      statFile: vi.fn(async () => ({ size: 1, mtimeMs: 2, ctimeMs: 3, ino: 4 })),
      createTempDirectory: vi
        .fn()
        .mockResolvedValueOnce('/tmp/codex-review-objects-1')
        .mockResolvedValueOnce('/tmp/codex-index-1'),
      copyFile: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    })
    const snapshot = new GitManager().getWorktreeRepositoryForRoot('/repo', host).reviewSnapshot

    await snapshot.withTempIndex(async () => undefined)

    expect(host.copyFile).toHaveBeenCalledWith(
      '/repo/.git/worktrees/app/worktrees/app/index',
      '/tmp/codex-index-1/index',
      expect.anything()
    )
    expect(host.copyFile).toHaveBeenCalledWith(
      '/repo/.git/sharedindex.abc',
      '/tmp/codex-index-1/sharedindex.abc',
      expect.anything()
    )
  })

  it('runs Git successfully through a temporary split index', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'dascowork-split-index-'))
    try {
      runGit(repo, ['init'])
      runGit(repo, ['config', 'user.email', 'test@example.com'])
      runGit(repo, ['config', 'user.name', 'Test User'])
      await writeFile(join(repo, 'tracked.txt'), 'one\n')
      runGit(repo, ['add', 'tracked.txt'])
      runGit(repo, ['commit', '-m', 'initial'])
      runGit(repo, ['update-index', '--split-index'])

      const host = new LocalGitHost()
      const snapshot = new GitManager().getWorktreeRepositoryForRoot(repo, host).reviewSnapshot
      const result = await snapshot.withTempIndex((env) =>
        host.runGit(['status', '--short'], repo, { env })
      )

      expect(runGit(repo, ['rev-parse', '--shared-index-path']).trim()).not.toBe('')
      expect(result).toMatchObject({ success: true, stdout: '' })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('runs Git through temporary indexes for separate git dirs and linked worktrees', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dascowork-git-dir-'))
    const repo = join(parent, 'repo')
    const gitDirectory = join(parent, 'git-directory')
    const linkedWorktree = join(parent, 'linked-worktree')
    try {
      runGit(parent, ['init', '--separate-git-dir', gitDirectory, repo])
      runGit(repo, ['config', 'user.email', 'test@example.com'])
      runGit(repo, ['config', 'user.name', 'Test User'])
      await writeFile(join(repo, 'tracked.txt'), 'one\n')
      runGit(repo, ['add', 'tracked.txt'])
      runGit(repo, ['commit', '-m', 'initial'])
      runGit(repo, ['worktree', 'add', '-b', 'linked', linkedWorktree])

      const host = new LocalGitHost()
      const manager = new GitManager()
      for (const root of [repo, linkedWorktree]) {
        const snapshot = manager.getWorktreeRepositoryForRoot(root, host).reviewSnapshot
        const result = await snapshot.withTempIndex((env) =>
          host.runGit(['status', '--short'], root, { env })
        )
        expect(result).toMatchObject({ success: true, stdout: '' })
      }
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

function createHost(overrides: Partial<GitHost>): GitHost {
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

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

class EventSourceFake {
  private readonly listeners = new Set<(event: GitAppEvent) => void>()

  subscribe(listener: (event: GitAppEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: GitAppEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
