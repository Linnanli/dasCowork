import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createReviewSnapshot, getDiffForSource } from './reviewSnapshot'
import { createGitFixture, git } from './testHelpers'

describe('reviewSnapshot', () => {
  it('P004-EDGE-03 includes untracked files in an unstaged snapshot and produces a safe add patch', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'untracked.txt'), 'first\nsecond\n')

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source: { type: 'unstaged' } })

    expect(snapshot.unstagedFileCount).toBe(1)
    expect(snapshot.files).toMatchObject([
      {
        path: 'untracked.txt',
        changeKind: 'added',
        additions: 2,
        deletions: 0,
        binary: false
      }
    ])
    await expect(
      getDiffForSource({ gitRoot: repo, source: { type: 'unstaged' }, path: 'untracked.txt' })
    ).resolves.toContain('new file mode')
  })

  it('P004-EDGE-02 returns an empty snapshot for a repository without a HEAD commit', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'dascowork-empty-git-'))
    git(repo, ['init'])

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source: { type: 'unstaged' } })

    expect(snapshot.files).toEqual([])
    expect(snapshot.stagedFileCount).toBe(0)
    expect(snapshot.unstagedFileCount).toBe(0)
  })

  it('keeps staged and branch snapshots scoped to their selected source', async () => {
    const { repo } = await createGitFixture()
    const baseBranch = git(repo, ['branch', '--show-current']).trim()
    await writeFile(join(repo, 'tracked.txt'), 'one\nstaged\n')
    git(repo, ['add', 'tracked.txt'])

    const { snapshot: staged } = await createReviewSnapshot({
      gitRoot: repo,
      source: { type: 'staged' }
    })
    expect(staged.files).toMatchObject([{ path: 'tracked.txt', additions: 1 }])

    git(repo, ['commit', '-m', 'staged change'])
    git(repo, ['checkout', '-b', 'feature/snapshot'])
    await writeFile(join(repo, 'tracked.txt'), 'one\nstaged\nfeature\n')
    git(repo, ['commit', '-am', 'feature change'])
    const { snapshot: branch } = await createReviewSnapshot({
      gitRoot: repo,
      source: { type: 'branch', baseBranch }
    })
    expect(branch.files).toMatchObject([{ path: 'tracked.txt', additions: 1 }])
  })

  it('P004-EDGE-04 reports a pure rename with its original path even when Git rename detection is disabled', async () => {
    const { repo } = await createGitFixture()
    git(repo, ['config', 'diff.renames', 'false'])
    git(repo, ['mv', 'tracked.txt', 'renamed.txt'])

    const { snapshot } = await createReviewSnapshot({
      gitRoot: repo,
      source: { type: 'staged' }
    })

    expect(snapshot.files).toMatchObject([
      {
        path: 'renamed.txt',
        previousPath: 'tracked.txt',
        changeKind: 'renamed'
      }
    ])
  })

  it('P004-EDGE-05/P004-EDGE-06/P004-EDGE-07/P004-EDGE-08 classifies staged copies, type changes, binary files, and gitlinks', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'typed.txt'), 'typed\n')
    git(repo, ['add', 'typed.txt'])
    git(repo, ['commit', '-m', 'add typed file'])
    await copyFile(join(repo, 'tracked.txt'), join(repo, 'copied.txt'))
    await writeFile(join(repo, 'image.bin'), Buffer.from([0, 255, 16, 128]))
    git(repo, ['add', 'copied.txt', 'image.bin'])

    const typedBlob = git(repo, ['hash-object', '-w', 'typed.txt']).trim()
    git(repo, ['update-index', '--cacheinfo', `120000,${typedBlob},typed.txt`])
    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`])

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source: { type: 'staged' } })

    expect(snapshot.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'copied.txt',
          previousPath: 'tracked.txt',
          changeKind: 'copied'
        }),
        expect.objectContaining({ path: 'typed.txt', changeKind: 'type-change' }),
        expect.objectContaining({ path: 'image.bin', binary: true }),
        expect.objectContaining({ path: 'vendor/submodule', changeKind: 'added' })
      ])
    )
    await expect(
      getDiffForSource({ gitRoot: repo, source: { type: 'staged' }, path: 'typed.txt' })
    ).resolves.toContain('new file mode 120000')
    await expect(
      getDiffForSource({ gitRoot: repo, source: { type: 'staged' }, path: 'vendor/submodule' })
    ).resolves.toContain('Subproject commit')
  })

  it('P004-EDGE-12 marks an unresolved merge as conflicted', async () => {
    const { repo } = await createGitFixture()
    git(repo, ['checkout', '-b', 'other'])
    await writeFile(join(repo, 'tracked.txt'), 'other\n')
    git(repo, ['commit', '-am', 'other change'])
    git(repo, ['checkout', 'master'])
    await writeFile(join(repo, 'tracked.txt'), 'main\n')
    git(repo, ['commit', '-am', 'main change'])
    expect(() => git(repo, ['merge', 'other'])).toThrow()

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source: { type: 'unstaged' } })

    expect(snapshot.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'tracked.txt',
          changeKind: 'unmerged',
          conflicted: true
        })
      ])
    )
  })
})
