import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { setGitInvocationObserver, type GitInvocationRecord } from './gitCli'
import { LocalGitService } from './LocalGitService'
import { computeFileRevision, createReviewSnapshot, getDiffForSource } from './reviewSnapshot'
import { createGitFixture, git, gitTarget } from './testHelpers'

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

  it('uses the same revision contract for staged snapshots and per-file validation', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\nstaged\n')
    await writeFile(join(repo, 'new-file.txt'), 'new\n')
    git(repo, ['add', 'tracked.txt', 'new-file.txt'])
    const source = { type: 'staged' as const }

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source })
    const validatedRevisions = await Promise.all(
      snapshot.files.map((file) =>
        computeFileRevision({ gitRoot: repo, source, path: file.path }).then((revision) => ({
          path: file.path,
          revision
        }))
      )
    )

    expect(validatedRevisions).toEqual(
      snapshot.files.map((file) => ({ path: file.path, revision: file.revision }))
    )
  })

  it('maps fixed diff display options to whitespace filtering and full-file context', async () => {
    const { repo } = await createGitFixture()
    const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
    await writeFile(join(repo, 'options.txt'), original)
    git(repo, ['add', 'options.txt'])
    git(repo, ['commit', '-m', 'add diff options fixture'])

    await writeFile(join(repo, 'options.txt'), original.replace('line 10', 'line    10'))
    await expect(
      getDiffForSource({ gitRoot: repo, source: { type: 'unstaged' }, path: 'options.txt' })
    ).resolves.toContain('-line 10')
    await expect(
      getDiffForSource({
        gitRoot: repo,
        source: { type: 'unstaged' },
        path: 'options.txt',
        options: { ignoreWhitespace: true, fullFiles: false }
      })
    ).resolves.toBe('')

    await writeFile(join(repo, 'options.txt'), original.replace('line 10', 'changed 10'))
    const fullDiff = await getDiffForSource({
      gitRoot: repo,
      source: { type: 'unstaged' },
      path: 'options.txt',
      options: { ignoreWhitespace: false, fullFiles: true }
    })
    expect(fullDiff).toContain(' line 1')
    expect(fullDiff).toContain(' line 20')
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

  it('keeps new snapshots usable for file diff and refresh while detecting same-file drift', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'other.txt'), 'one\n')
    git(repo, ['add', 'other.txt'])
    git(repo, ['commit', '-m', 'add other file'])
    await writeFile(join(repo, 'tracked.txt'), 'one\nlocal\n')
    await writeFile(join(repo, 'other.txt'), 'one\nlocal\n')

    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const source = { type: 'unstaged' as const }
    const snapshot = await service.getSnapshot(target, source)
    const file = snapshot.files.find((entry) => entry.path === 'tracked.txt')
    expect(file).toBeDefined()

    await expect(
      service.getFileDiff({
        target,
        source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file: { path: file!.path, revision: file!.revision }
      })
    ).resolves.toMatchObject({ status: 'ready' })

    const refresh = await service.refreshReviewFiles({
      target,
      source,
      snapshotGeneration: snapshot.snapshotGeneration,
      paths: ['tracked.txt']
    })
    const refreshedFile = refresh.files.find((entry) => entry.path === 'tracked.txt')
    expect(refreshedFile).toBeDefined()
    await expect(
      service.getFileDiff({
        target,
        source,
        snapshotGeneration: refresh.snapshotGeneration,
        file: { path: refreshedFile!.path, revision: refreshedFile!.revision }
      })
    ).resolves.toMatchObject({ status: 'ready' })

    await writeFile(join(repo, 'other.txt'), 'one\nlocal\nother drift\n')
    await expect(
      service.getFileDiff({
        target,
        source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file: { path: file!.path, revision: file!.revision }
      })
    ).resolves.toMatchObject({ status: 'ready' })

    await writeFile(join(repo, 'tracked.txt'), 'one\nlocal\nsame file drift\n')
    await expect(
      service.getFileDiff({
        target,
        source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file: { path: file!.path, revision: file!.revision }
      })
    ).resolves.toMatchObject({ status: 'stale' })
  })

  it('keeps an untracked file snapshot usable for its first file diff read', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'untracked.txt'), 'first\nsecond\n')

    const service = new LocalGitService({ projectService })
    const target = gitTarget(repo)
    const source = { type: 'unstaged' as const }
    const snapshot = await service.getSnapshot(target, source)
    const file = snapshot.files.find((entry) => entry.path === 'untracked.txt')
    expect(file).toBeDefined()

    await expect(
      service.getFileDiff({
        target,
        source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file: { path: file!.path, revision: file!.revision }
      })
    ).resolves.toMatchObject({ status: 'ready' })
  })

  it('changes an unstaged revision when an untracked file is staged without changing content', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'untracked.txt'), 'first\nsecond\n')
    const source = { type: 'unstaged' as const }

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source })
    const file = snapshot.files.find((entry) => entry.path === 'untracked.txt')
    expect(file).toBeDefined()

    git(repo, ['add', 'untracked.txt'])

    await expect(
      computeFileRevision({ gitRoot: repo, source, path: 'untracked.txt' })
    ).resolves.not.toBe(file?.revision)
  })

  it('hashes literal and newline paths without putting the full path list in argv', async () => {
    const { repo } = await createGitFixture()
    const paths = ['quoted-"name".txt', 'line\nbreak.txt']
    await Promise.all(paths.map((path) => writeFile(join(repo, path), 'before\n')))
    const source = { type: 'unstaged' as const }

    const { snapshot } = await createReviewSnapshot({ gitRoot: repo, source })
    const revisions = new Map(snapshot.files.map((file) => [file.path, file.revision]))
    expect([...revisions.keys()]).toEqual(expect.arrayContaining(paths))

    await Promise.all(paths.map((path) => writeFile(join(repo, path), 'after\n')))
    for (const path of paths) {
      await expect(computeFileRevision({ gitRoot: repo, source, path })).resolves.not.toBe(
        revisions.get(path)
      )
    }
  })

  it('keeps Git calls bounded for a 1000-file unstaged snapshot', async () => {
    const { repo } = await createGitFixture()
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        writeFile(join(repo, `bulk-${index}.txt`), `before ${index}\n`)
      )
    )
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'add bulk files'])
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        writeFile(join(repo, `bulk-${index}.txt`), `after ${index}\n`)
      )
    )

    const invocations: GitInvocationRecord[] = []
    const restoreObserver = setGitInvocationObserver((record) => invocations.push(record))
    try {
      const { snapshot } = await createReviewSnapshot({
        gitRoot: repo,
        source: { type: 'unstaged' }
      })

      expect(snapshot.files).toHaveLength(1000)
      expect(invocations.length).toBeLessThanOrEqual(25)
      expect(
        invocations.some(
          (record) => record.args.includes('--raw') && record.args.includes('--numstat')
        )
      ).toBe(true)
      expect(
        invocations.some(
          (record) => record.args.includes('hash-object') && record.args.includes('--stdin-paths')
        )
      ).toBe(true)
      expect(Math.max(...invocations.map((record) => record.args.length))).toBeLessThan(100)
      expect(
        invocations.reduce((sum, record) => sum + record.durationMs, 0)
      ).toBeGreaterThanOrEqual(0)
    } finally {
      restoreObserver()
    }
  }, 60_000)

  it('measures largeDiff with a bounded diff read', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'large.txt'), 'small\n')
    git(repo, ['add', 'large.txt'])
    git(repo, ['commit', '-m', 'add large file'])
    await writeFile(join(repo, 'large.txt'), `${'changed\n'.repeat(20_000)}`)

    const maxPatchBytes = 4096
    const invocations: GitInvocationRecord[] = []
    const restoreObserver = setGitInvocationObserver((record) => invocations.push(record))
    try {
      const { snapshot } = await createReviewSnapshot({
        gitRoot: repo,
        source: { type: 'unstaged' },
        maxPatchBytes
      })

      expect(snapshot.largeDiff).toBe(true)
      expect(
        invocations.some(
          (record) => record.args.includes('diff') && record.maxOutputBytes === maxPatchBytes + 1
        )
      ).toBe(true)
    } finally {
      restoreObserver()
    }
  })

  it('returns largeDiff from LocalGitService when a worktree diff exceeds the output cap', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'large-service.txt'), 'small\n')
    git(repo, ['add', 'large-service.txt'])
    git(repo, ['commit', '-m', 'add service large file'])
    await writeFile(join(repo, 'large-service.txt'), `${'changed\n'.repeat(300_000)}`)

    const service = new LocalGitService({ projectService })

    await expect(service.getSnapshot(gitTarget(repo), { type: 'unstaged' })).resolves.toMatchObject(
      {
        largeDiff: true,
        files: [expect.objectContaining({ path: 'large-service.txt' })]
      }
    )
  }, 60_000)
})
