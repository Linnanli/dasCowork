import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { GitManager, type GitHost, type GitRunResult } from './GitManager'
import type { GitRepositoryTargetResolver } from './GitRepositoryTargetResolver'
import { LocalGitService } from './LocalGitService'
import { git, createGitFixture, gitTarget } from './testHelpers'
import { LOCAL_GIT_PATCH_MAX_CHARACTERS } from '../../shared/localGitApi'

describe('LocalGitService', () => {
  it('creates a trusted unstaged snapshot and stages only with matching revisions', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const service = new LocalGitService({ projectService })

    const snapshot = await service.getSnapshot(gitTarget(repo), { type: 'unstaged' })

    expect(snapshot.gitRoot).toBe(repo)
    expect(snapshot.files).toMatchObject([{ path: 'tracked.txt', additions: 1 }])

    const result = await service.mutateReview({
      target: gitTarget(repo),
      source: { type: 'unstaged' },
      snapshotGeneration: snapshot.snapshotGeneration,
      action: 'stage',
      scope: 'file',
      files: [{ path: 'tracked.txt', revision: snapshot.files[0].revision }]
    })

    expect(result.status).toBe('success')
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('tracked.txt')
  })

  it('refreshes only written review paths while preserving untouched files in the next snapshot', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'second.txt'), 'second\n')
    git(repo, ['add', 'second.txt'])
    git(repo, ['commit', '-m', 'add second file'])
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(repo, 'second.txt'), 'second\nchanged\n')
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const snapshot = await service.getSnapshot(target, { type: 'unstaged' })
    const written = snapshot.files.find((file) => file.path === 'tracked.txt')
    const untouched = snapshot.files.find((file) => file.path === 'second.txt')
    expect(written).toBeDefined()
    expect(untouched).toBeDefined()

    await expect(
      service.mutateReview({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        action: 'stage',
        scope: 'file',
        files: [{ path: written!.path, revision: written!.revision }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt'] })

    const refreshed = await service.refreshReviewFiles({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: snapshot.snapshotGeneration,
      paths: ['tracked.txt']
    })

    expect(refreshed.snapshotGeneration).not.toBe(snapshot.snapshotGeneration)
    expect(refreshed.files).toEqual([])
    await expect(
      service.getFileDiff({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: refreshed.snapshotGeneration,
        file: {
          path: untouched!.path,
          revision: untouched!.revision
        }
      })
    ).resolves.toMatchObject({ file: { path: 'second.txt' } })
    await expect(
      service.getFileDiff({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: refreshed.snapshotGeneration,
        file: {
          path: written!.path,
          revision: written!.revision
        }
      })
    ).rejects.toThrow('stale-snapshot')
  })

  it('rejects review mutation targets that do not exactly match their signed snapshot', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'second.txt'), 'second\n')
    git(repo, ['add', 'second.txt'])
    git(repo, ['commit', '-m', 'add second file'])
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(repo, 'second.txt'), 'second\nchanged\n')
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const snapshot = await service.getSnapshot(target, { type: 'unstaged' })
    const [first, second] = snapshot.files
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const invalidTargets = [
      [first!],
      [...snapshot.files, { path: 'missing.txt', revision: 'forged' }],
      [first!, first!],
      snapshot.files.map((file, index) =>
        index === 0 ? { ...file, revision: 'forged-revision' } : file
      ),
      snapshot.files.map((file, index) =>
        index === 0 ? { ...file, previousPath: 'forged-previous-path' } : file
      )
    ]

    for (const files of invalidTargets) {
      await expect(
        service.mutateReview({
          target,
          source: { type: 'unstaged' },
          snapshotGeneration: snapshot.snapshotGeneration,
          action: 'stage',
          scope: 'section',
          files: files.map((file) => ({
            path: file.path,
            ...('previousPath' in file && file.previousPath !== undefined
              ? { previousPath: file.previousPath }
              : {}),
            revision: file.revision
          }))
        })
      ).resolves.toMatchObject({ status: 'error', errorCode: 'stale-snapshot' })
    }

    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')
  })

  it('rejects a section atomically when any signed file revision has drifted', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'second.txt'), 'second\n')
    git(repo, ['add', 'second.txt'])
    git(repo, ['commit', '-m', 'add second file'])
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(repo, 'second.txt'), 'second\nchanged\n')
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const snapshot = await service.getSnapshot(target, { type: 'unstaged' })
    await writeFile(join(repo, 'second.txt'), 'second\nchanged again\n')

    await expect(
      service.mutateReview({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        action: 'stage',
        scope: 'section',
        files: snapshot.files.map(({ path, previousPath, revision }) => ({
          path,
          ...(previousPath === undefined ? {} : { previousPath }),
          revision
        }))
      })
    ).resolves.toMatchObject({ status: 'error', errorCode: 'stale-snapshot' })

    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')
  })

  it('rejects an oversized review section patch before writing any file', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'second.txt'), 'second\n')
    git(repo, ['add', 'second.txt'])
    git(repo, ['commit', '-m', 'add second file'])
    const largeChange = `${'x'.repeat(Math.ceil(LOCAL_GIT_PATCH_MAX_CHARACTERS / 2))}\n`
    await writeFile(join(repo, 'tracked.txt'), largeChange)
    await writeFile(join(repo, 'second.txt'), largeChange)
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const snapshot = await service.getSnapshot(target, { type: 'unstaged' })

    await expect(
      service.mutateReview({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        action: 'stage',
        scope: 'section',
        files: snapshot.files.map(({ path, previousPath, revision }) => ({
          path,
          ...(previousPath === undefined ? {} : { previousPath }),
          revision
        }))
      })
    ).resolves.toMatchObject({ status: 'error', errorCode: 'patch-too-large' })

    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')
  })

  it('lists bounded local commit summaries from the trusted repository', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })

    await expect(service.listCommits(gitTarget(repo), 1)).resolves.toMatchObject([
      { subject: 'initial' }
    ])
  })

  it('P004-EDGE-09/P004-EDGE-10 rejects review mutation after the file revision drifts', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const service = new LocalGitService({ projectService })
    const snapshot = await service.getSnapshot(gitTarget(repo), { type: 'unstaged' })
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\nthree\n')

    const result = await service.mutateReview({
      target: gitTarget(repo),
      source: { type: 'unstaged' },
      snapshotGeneration: snapshot.snapshotGeneration,
      action: 'stage',
      scope: 'file',
      files: [{ path: 'tracked.txt', revision: snapshot.files[0].revision }]
    })

    expect(result).toMatchObject({ status: 'error', errorCode: 'stale-snapshot' })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')
  })

  it('rejects a signed snapshot when a request changes its review source', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const service = new LocalGitService({ projectService })
    const snapshot = await service.getSnapshot(gitTarget(repo), { type: 'unstaged' })

    await expect(
      service.mutateReview({
        target: gitTarget(repo),
        source: { type: 'staged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        action: 'unstage',
        scope: 'file',
        files: [{ path: 'tracked.txt', revision: snapshot.files[0].revision }]
      })
    ).resolves.toMatchObject({ status: 'error', errorCode: 'stale-snapshot' })
    await expect(
      service.getFileDiff({
        target: gitTarget(repo),
        source: { type: 'staged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        file: { path: 'tracked.txt', revision: snapshot.files[0].revision }
      })
    ).rejects.toThrow('stale-snapshot')
  })

  it('stages an untracked file from the signed review snapshot', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'new.txt'), 'new file\n')
    const service = new LocalGitService({ projectService })
    await expect(service.getSummary(gitTarget(repo))).resolves.toMatchObject({
      untrackedFileCount: 1,
      additions: 1,
      deletions: 0
    })
    const snapshot = await service.getSnapshot(gitTarget(repo), { type: 'unstaged' })
    const file = snapshot.files.find((candidate) => candidate.path === 'new.txt')
    expect(file).toBeDefined()

    await expect(
      service.mutateReview({
        target: gitTarget(repo),
        source: { type: 'unstaged' },
        snapshotGeneration: snapshot.snapshotGeneration,
        action: 'stage',
        scope: 'file',
        files: [{ path: 'new.txt', revision: file!.revision }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['new.txt'] })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('new.txt')
  })

  it('uses one canonical all-untracked read for summary and workspace state', async () => {
    const commands: string[] = []
    const host = createHost({
      async runGit(args) {
        const command = args.join(' ')
        commands.push(command)
        if (command === 'ls-files --others --exclude-standard -z') return ok('new.txt\0')
        if (command === 'diff --no-index --numstat /dev/null new.txt') {
          return ok('1\t0\tnew.txt\n')
        }
        if (
          [
            'diff --cached --name-only',
            'diff --name-only',
            'diff --numstat',
            'diff --cached --numstat',
            'diff --raw -z',
            'diff --cached --raw -z'
          ].includes(command)
        ) {
          return ok('')
        }
        if (command === 'branch --show-current') return ok('main\n')
        if (command === 'rev-parse HEAD') return ok('abc123\n')
        return fail(`unexpected command: ${command}`)
      }
    })
    const repository = new GitManager().getWorktreeRepositoryForRoot('/repo', host)
    const target = gitTarget('/repo')
    const service = new LocalGitService({
      targetResolver: {
        assertRepository: async () => ({ target, repository })
      } as unknown as GitRepositoryTargetResolver
    })

    await expect(service.getSummary(target)).resolves.toMatchObject({
      untrackedFileCount: 1,
      additions: 1,
      deletions: 0,
      branch: 'main'
    })

    expect(
      commands.filter((command) => command === 'ls-files --others --exclude-standard -z')
    ).toHaveLength(1)
  })

  it('undoes and reapplies turn patch batches', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const patch = git(repo, ['diff', '--binary'])
    const service = new LocalGitService({ projectService })

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'undo',
        turnId: 'turn_1',
        batches: [{ cwd: repo, gitRoot: repo, diff: patch }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt'] })
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\n')

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'reapply',
        turnId: 'turn_1',
        batches: [{ cwd: repo, gitRoot: repo, diff: patch }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt'] })
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\ntwo\n')
  })

  it('applies a subdirectory turn patch from its trusted batch cwd', async () => {
    const { repo, projectService } = await createGitFixture()
    const batchCwd = join(repo, 'packages', 'app')
    const path = join(batchCwd, 'tracked.txt')
    await mkdir(batchCwd, { recursive: true })
    await writeFile(path, 'one\n')
    git(repo, ['add', 'packages/app/tracked.txt'])
    git(repo, ['commit', '-m', 'add nested file'])
    await writeFile(path, 'one\ntwo\n')
    const patch = git(repo, ['diff', '--binary']).replaceAll(
      'packages/app/tracked.txt',
      'tracked.txt'
    )
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const repository = (await service.resolveTrustedRepository(target)).repository
    const initialGeneration = repository.gitReadGeneration

    await expect(
      service.applyTurnPatch({
        target,
        action: 'undo',
        turnId: 'turn_1',
        batches: [{ cwd: batchCwd, gitRoot: repo, diff: patch }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt'] })
    await expect(readFile(path, 'utf8')).resolves.toBe('one\n')
    expect(repository.gitReadGeneration).toBe(initialGeneration + 1)

    await expect(
      service.applyTurnPatch({
        target,
        action: 'reapply',
        turnId: 'turn_1',
        batches: [{ cwd: batchCwd, gitRoot: repo, diff: patch }]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt'] })
    await expect(readFile(path, 'utf8')).resolves.toBe('one\ntwo\n')
    expect(repository.gitReadGeneration).toBe(initialGeneration + 2)
  })

  it('rejects a turn patch batch from a nested Git worktree', async () => {
    const { repo, projectService } = await createGitFixture()
    const batchCwd = join(repo, 'nested-repository')
    await mkdir(batchCwd)
    git(batchCwd, ['init'])
    const service = new LocalGitService({ projectService })
    const patch = [
      'diff --git a/tracked.txt b/tracked.txt',
      '--- a/tracked.txt',
      '+++ b/tracked.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      ''
    ].join('\n')

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'reapply',
        turnId: 'turn_1',
        batches: [{ cwd: batchCwd, gitRoot: repo, diff: patch }]
      })
    ).rejects.toThrow('turn patch cwd git root does not match trusted repository')
  })

  it('rejects review writes from immutable comparison sources', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })

    await expect(
      service.mutateReview({
        target: gitTarget(repo),
        source: { type: 'commit', commitSha: 'a'.repeat(40) },
        snapshotGeneration: 'snapshot',
        action: 'revert',
        scope: 'file',
        files: [{ path: 'tracked.txt', revision: 'revision' }]
      })
    ).resolves.toMatchObject({ status: 'error', errorCode: 'unsupported-review-source-action' })
  })

  it('resolves a fixed merge base only from the trusted conversation repository', async () => {
    const { repo, projectService } = await createGitFixture()
    const baseBranch = git(repo, ['branch', '--show-current']).trim()
    git(repo, ['checkout', '-b', 'feature/review'])
    await writeFile(join(repo, 'tracked.txt'), 'feature\n')
    git(repo, ['add', 'tracked.txt'])
    git(repo, ['commit', '-m', 'feature change'])
    const service = new LocalGitService({ projectService })

    await expect(service.resolveMergeBase(gitTarget(repo), baseBranch)).resolves.toEqual({
      baseBranch,
      mergeBase: git(repo, ['merge-base', baseBranch, 'HEAD']).trim()
    })
  })
})

function createHost(overrides: Partial<GitHost>): GitHost {
  return {
    id: 'local',
    isLocal: true,
    runGit: async () => ok(''),
    ...overrides
  }
}

function ok(stdout: string): GitRunResult {
  return { success: true, code: 0, stdout, stderr: '' }
}

function fail(stderr: string): GitRunResult {
  return { success: false, code: 1, stdout: '', stderr }
}
