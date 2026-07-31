import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalGitService } from './LocalGitService'
import { createGitFixture, git, gitTarget } from './testHelpers'

describe('LocalGitService integration', () => {
  it('stages, unstages, and reverts every file in a multi-file review section', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'second.txt'), 'alpha\n')
    git(repo, ['add', 'second.txt'])
    git(repo, ['commit', '-m', 'add second file'])
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(repo, 'second.txt'), 'alpha\nbeta\n')

    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const unstaged = await service.getSnapshot(target, { type: 'unstaged' })
    expect(unstaged.files.map((file) => file.path)).toEqual(['second.txt', 'tracked.txt'])

    await expect(
      service.mutateReview({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: unstaged.snapshotGeneration,
        action: 'stage',
        scope: 'section',
        files: reviewTargets(unstaged.files)
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['second.txt', 'tracked.txt'] })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim().split('\n')).toEqual([
      'second.txt',
      'tracked.txt'
    ])

    const staged = await service.getSnapshot(target, { type: 'staged' })
    await expect(
      service.mutateReview({
        target,
        source: { type: 'staged' },
        snapshotGeneration: staged.snapshotGeneration,
        action: 'unstage',
        scope: 'section',
        files: reviewTargets(staged.files)
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['second.txt', 'tracked.txt'] })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')

    const reverted = await service.getSnapshot(target, { type: 'unstaged' })
    await expect(
      service.mutateReview({
        target,
        source: { type: 'unstaged' },
        snapshotGeneration: reverted.snapshotGeneration,
        action: 'revert',
        scope: 'section',
        files: reviewTargets(reverted.files)
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['second.txt', 'tracked.txt'] })
    expect(git(repo, ['diff', '--name-only']).trim()).toBe('')
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\n')
    await expect(readFile(join(repo, 'second.txt'), 'utf8')).resolves.toBe('alpha\n')
  })

  it('P004-EDGE-08/P004-EDGE-09/P004-EDGE-13 safely unstages a gitlink and reports a partial staged revert without overwriting drift', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`])

    const gitlinkSnapshot = await service.getSnapshot(target, { type: 'staged' })
    const gitlink = gitlinkSnapshot.files.find((file) => file.path === 'vendor/submodule')
    expect(gitlink).toBeDefined()
    await expect(
      service.mutateReview({
        target,
        source: { type: 'staged' },
        snapshotGeneration: gitlinkSnapshot.snapshotGeneration,
        action: 'unstage',
        scope: 'file',
        files: reviewTargets([gitlink!])
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['vendor/submodule'] })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')

    await writeFile(join(repo, 'tracked.txt'), 'staged\n')
    git(repo, ['add', 'tracked.txt'])
    await writeFile(join(repo, 'tracked.txt'), 'worktree drift\n')
    const stagedSnapshot = await service.getSnapshot(target, { type: 'staged' })
    const tracked = stagedSnapshot.files.find((file) => file.path === 'tracked.txt')
    expect(tracked).toBeDefined()

    await expect(
      service.mutateReview({
        target,
        source: { type: 'staged' },
        snapshotGeneration: stagedSnapshot.snapshotGeneration,
        action: 'revert',
        scope: 'file',
        files: reviewTargets([tracked!])
      })
    ).resolves.toMatchObject({
      status: 'partial-success',
      appliedPaths: ['tracked.txt'],
      conflictedPaths: ['tracked.txt']
    })
    expect(git(repo, ['diff', '--cached', '--name-only']).trim()).toBe('')
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('worktree drift\n')
  })

  it('undoes and reapplies root and subdirectory batches in a real repository', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })
    const nestedCwd = join(repo, 'packages', 'app')
    await mkdir(nestedCwd, { recursive: true })
    await writeFile(join(nestedCwd, 'nested.txt'), 'alpha\n')
    git(repo, ['add', 'packages/app/nested.txt'])
    git(repo, ['commit', '-m', 'add nested file'])

    await writeFile(join(repo, 'tracked.txt'), 'one\nroot change\n')
    await writeFile(join(nestedCwd, 'nested.txt'), 'alpha\nnested change\n')
    const rootPatch = git(repo, ['diff', '--binary', '--', 'tracked.txt'])
    const nestedPatch = git(repo, ['diff', '--binary', '--', 'packages/app/nested.txt']).replaceAll(
      'packages/app/nested.txt',
      'nested.txt'
    )

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'undo',
        turnId: 'turn_1',
        batches: [
          { cwd: repo, gitRoot: repo, diff: rootPatch },
          { cwd: nestedCwd, gitRoot: repo, diff: nestedPatch }
        ]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['nested.txt', 'tracked.txt'] })
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\n')
    await expect(readFile(join(nestedCwd, 'nested.txt'), 'utf8')).resolves.toBe('alpha\n')

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'reapply',
        turnId: 'turn_1',
        batches: [
          { cwd: repo, gitRoot: repo, diff: rootPatch },
          { cwd: nestedCwd, gitRoot: repo, diff: nestedPatch }
        ]
      })
    ).resolves.toMatchObject({ status: 'success', appliedPaths: ['tracked.txt', 'nested.txt'] })
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\nroot change\n')
    await expect(readFile(join(nestedCwd, 'nested.txt'), 'utf8')).resolves.toBe(
      'alpha\nnested change\n'
    )
  })

  it.each([
    {
      label: 'outside repository cwd',
      createBatch: async (repo: string) => ({
        cwd: await mkdtemp(join(tmpdir(), 'dascowork-turn-patch-outside-')),
        gitRoot: repo,
        diff: patchFor('tracked.txt', 'one', 'two')
      }),
      message: 'turn patch cwd must stay inside the trusted repository'
    },
    {
      label: 'same host different repository cwd',
      createBatch: async () => {
        const otherRepo = await mkdtemp(join(tmpdir(), 'dascowork-turn-patch-other-'))
        git(otherRepo, ['init'])
        return { cwd: otherRepo, gitRoot: otherRepo, diff: patchFor('tracked.txt', 'one', 'two') }
      },
      message: 'turn patch cwd must stay inside the trusted repository'
    },
    {
      label: 'nested repository root mismatch',
      createBatch: async (repo: string) => {
        const nestedRepo = join(repo, 'nested-repo')
        await mkdir(nestedRepo)
        git(nestedRepo, ['init'])
        return { cwd: nestedRepo, gitRoot: repo, diff: patchFor('tracked.txt', 'one', 'two') }
      },
      message: 'turn patch cwd git root does not match trusted repository'
    },
    {
      label: 'forged git root',
      createBatch: async (repo: string) => ({
        cwd: repo,
        gitRoot: join(repo, 'forged-root'),
        diff: patchFor('tracked.txt', 'one', 'two')
      }),
      message: 'turn patch git root does not match trusted repository'
    },
    {
      label: 'absolute patch path',
      createBatch: async (repo: string) => ({
        cwd: repo,
        gitRoot: repo,
        diff: [
          'diff --git a/tracked.txt b/tracked.txt',
          '--- /tmp/tracked.txt',
          '+++ /tmp/tracked.txt',
          '@@ -1 +1 @@',
          '-one',
          '+two',
          ''
        ].join('\n')
      }),
      message: 'absolute paths are not allowed'
    },
    {
      label: '.. patch path',
      createBatch: async (repo: string) => ({
        cwd: repo,
        gitRoot: repo,
        diff: patchFor('../escaped.txt', 'one', 'two')
      }),
      message: 'path must stay inside the repository'
    }
  ])('rejects an unsafe turn patch batch: $label', async ({ createBatch, message }) => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })

    await expect(
      service.applyTurnPatch({
        target: gitTarget(repo),
        action: 'reapply',
        turnId: 'turn_1',
        batches: [await createBatch(repo)]
      })
    ).rejects.toThrow(message)
  })

  it('validates every batch before applying any patch', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)

    await expect(
      service.applyTurnPatch({
        target,
        action: 'reapply',
        turnId: 'turn_1',
        batches: [
          { cwd: repo, gitRoot: repo, diff: patchFor('tracked.txt', 'one', 'two') },
          { cwd: repo, gitRoot: repo, diff: patchFor('../outside.txt', 'old', 'new') }
        ]
      })
    ).rejects.toThrow('path must stay inside the repository')
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\n')
  })

  it('keeps batch order, short-circuits on failure, and advances only successful generations', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalGitService({ projectService })
    await writeFile(join(repo, 'first.txt'), 'old first\n')
    await writeFile(join(repo, 'second.txt'), 'old second\n')
    await writeFile(join(repo, 'third.txt'), 'old third\n')
    git(repo, ['add', 'first.txt', 'second.txt', 'third.txt'])
    git(repo, ['commit', '-m', 'add batch files'])
    const target = gitTarget(repo)
    const repository = (await service.resolveTrustedRepository(target)).repository

    const batches = [
      { cwd: repo, gitRoot: repo, diff: patchFor('first.txt', 'old first', 'new first') },
      { cwd: repo, gitRoot: repo, diff: patchFor('second.txt', 'wrong base', 'new second') },
      { cwd: repo, gitRoot: repo, diff: patchFor('third.txt', 'old third', 'new third') }
    ]
    const initialGeneration = repository.gitReadGeneration

    await expect(
      service.applyTurnPatch({ target, action: 'reapply', turnId: 'turn_1', batches })
    ).resolves.toMatchObject({
      status: 'error',
      errorCode: 'patch-apply-failed',
      appliedPaths: ['first.txt'],
      conflictedPaths: ['second.txt']
    })
    expect(repository.gitReadGeneration).toBe(initialGeneration + 1)
    await expect(readFile(join(repo, 'first.txt'), 'utf8')).resolves.toBe('new first\n')
    await expect(readFile(join(repo, 'second.txt'), 'utf8')).resolves.toBe('old second\n')
    await expect(readFile(join(repo, 'third.txt'), 'utf8')).resolves.toBe('old third\n')

    await writeFile(join(repo, 'first.txt'), 'new first\n')
    await writeFile(join(repo, 'second.txt'), 'new second\n')
    await writeFile(join(repo, 'third.txt'), 'new third\n')
    const successBatches = [
      { cwd: repo, gitRoot: repo, diff: patchFor('first.txt', 'old first', 'new first') },
      { cwd: repo, gitRoot: repo, diff: patchFor('second.txt', 'old second', 'new second') },
      { cwd: repo, gitRoot: repo, diff: patchFor('third.txt', 'old third', 'new third') }
    ]
    const beforeUndoGeneration = repository.gitReadGeneration

    await expect(
      service.applyTurnPatch({ target, action: 'undo', turnId: 'turn_1', batches: successBatches })
    ).resolves.toMatchObject({
      status: 'success',
      appliedPaths: ['third.txt', 'second.txt', 'first.txt']
    })
    expect(repository.gitReadGeneration).toBe(beforeUndoGeneration + 3)
    await expect(readFile(join(repo, 'first.txt'), 'utf8')).resolves.toBe('old first\n')
    await expect(readFile(join(repo, 'second.txt'), 'utf8')).resolves.toBe('old second\n')
    await expect(readFile(join(repo, 'third.txt'), 'utf8')).resolves.toBe('old third\n')
  })
})

function patchFor(path: string, before: string, after: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    `-${before}`,
    `+${after}`,
    ''
  ].join('\n')
}

function reviewTargets(
  files: ReadonlyArray<{ path: string; previousPath?: string; revision: string }>
): Array<{ path: string; previousPath?: string; revision: string }> {
  return files.map(({ path, previousPath, revision }) => ({
    path,
    ...(previousPath === undefined ? {} : { previousPath }),
    revision
  }))
}
