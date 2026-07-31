import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalGitHost } from './GitHostRegistry'
import { GitManager } from './GitManager'

type IndexFingerprint = {
  exists: true
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
  sha256: string
} | null

type TempIndexCase = {
  name: string
  createRoot: (parent: string) => Promise<string>
  verifySetup?: (root: string) => void
  removeIndexBeforeRun?: boolean
}

describe('GitManager withTempIndex integration', () => {
  const cases: readonly TempIndexCase[] = [
    {
      name: 'normal index',
      createRoot: async (parent) => createCommittedRepo(join(parent, 'repo'))
    },
    {
      name: 'missing index',
      createRoot: async (parent) => createCommittedRepo(join(parent, 'repo')),
      removeIndexBeforeRun: true
    },
    {
      name: 'split index',
      createRoot: async (parent) => {
        const repo = await createCommittedRepo(join(parent, 'repo'))
        git(repo, ['update-index', '--split-index'])
        return repo
      },
      verifySetup: (root) => {
        expect(git(root, ['rev-parse', '--shared-index-path']).trim()).not.toBe('')
      }
    },
    {
      name: 'separate git dir',
      createRoot: async (parent) =>
        createCommittedRepo(join(parent, 'repo'), {
          initArgs: [
            'init',
            '--separate-git-dir',
            join(parent, 'git-directory'),
            join(parent, 'repo')
          ]
        })
    },
    {
      name: 'linked worktree',
      createRoot: async (parent) => {
        const repo = await createCommittedRepo(join(parent, 'repo'))
        const linkedWorktree = join(parent, 'linked-worktree')
        git(repo, ['worktree', 'add', '-b', 'linked-temp-index', linkedWorktree])
        return linkedWorktree
      },
      verifySetup: (root) => {
        expect(git(root, ['rev-parse', '--git-common-dir']).trim()).not.toBe('.git')
      }
    }
  ]

  it.each(cases)(
    'writes only to the temporary index for $name',
    async ({ createRoot, removeIndexBeforeRun, verifySetup }) => {
      const parent = await mkdtemp(join(tmpdir(), 'dascowork-temp-index-'))
      try {
        const root = await createRoot(parent)
        verifySetup?.(root)

        const realIndexPath = resolveGitPath(root, 'index')
        if (removeIndexBeforeRun) await rm(realIndexPath, { force: true })

        const realIndexBefore = await fingerprintIndex(realIndexPath)
        const realCachedDiffBefore = git(root, ['diff', '--cached', '--binary'])
        const host = new LocalGitHost()
        const snapshot = new GitManager().getWorktreeRepositoryForRoot(root, host).reviewSnapshot
        let temporaryIndexPath = ''

        const temporaryCachedDiff = await snapshot.withTempIndex(async (env) => {
          temporaryIndexPath = env.GIT_INDEX_FILE
          await writeFile(join(root, 'temp-only.txt'), 'temporary index content\n')

          const addResult = await host.runGit(['add', 'temp-only.txt'], root, { env })
          expect(addResult).toMatchObject({ success: true })

          const diffResult = await host.runGit(['diff', '--cached', '--name-only'], root, { env })
          expect(diffResult).toMatchObject({ success: true })
          return diffResult.stdout
        })

        expect(temporaryCachedDiff.split('\n').filter(Boolean)).toContain('temp-only.txt')
        expect(temporaryIndexPath).not.toBe(realIndexPath)
        await expect(access(temporaryIndexPath)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(fingerprintIndex(realIndexPath)).resolves.toEqual(realIndexBefore)
        expect(git(root, ['diff', '--cached', '--binary'])).toBe(realCachedDiffBefore)
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    }
  )

  it('removes the temporary index directory when the operation throws', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dascowork-temp-index-cleanup-'))
    try {
      const root = await createCommittedRepo(join(parent, 'repo'))
      const host = new LocalGitHost()
      const snapshot = new GitManager().getWorktreeRepositoryForRoot(root, host).reviewSnapshot
      let temporaryIndexPath = ''

      await expect(
        snapshot.withTempIndex(async (env) => {
          temporaryIndexPath = env.GIT_INDEX_FILE
          throw new Error('stop after temp index creation')
        })
      ).rejects.toThrow('stop after temp index creation')

      await expect(access(dirname(temporaryIndexPath))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

async function createCommittedRepo(
  repo: string,
  options: { initArgs?: string[] } = {}
): Promise<string> {
  await mkdir(dirname(repo), { recursive: true })
  git(dirname(repo), options.initArgs ?? ['init', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  await writeFile(join(repo, 'tracked.txt'), 'tracked content\n')
  git(repo, ['add', 'tracked.txt'])
  git(repo, ['commit', '-m', 'initial'])
  return repo
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function resolveGitPath(root: string, pathPart: string): string {
  const rawPath = git(root, ['rev-parse', '--git-path', pathPart]).trim()
  return isAbsolute(rawPath) ? rawPath : join(root, rawPath)
}

async function fingerprintIndex(path: string): Promise<IndexFingerprint> {
  try {
    const [stats, contents] = await Promise.all([stat(path), readFile(path)])
    return {
      exists: true,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      ino: stats.ino,
      sha256: createHash('sha256').update(contents).digest('hex')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
