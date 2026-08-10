import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { GitManager } from './GitManager'
import { LocalGitHost } from './GitHostRegistry'
import { readReviewFileContent } from './reviewFileContent'
import { createGitFixture, git } from './testHelpers'

describe('reviewFileContent', () => {
  it('reads branch before content from the merge-base revision', async () => {
    const { repo } = await createGitFixture()
    await writeFile(join(repo, 'notes.md'), 'base\n')
    git(repo, ['add', 'notes.md'])
    git(repo, ['commit', '-m', 'add markdown file'])
    const baseBranch = git(repo, ['branch', '--show-current']).trim()

    git(repo, ['checkout', '-b', 'feature/preview'])
    await writeFile(join(repo, 'notes.md'), 'feature\n')
    git(repo, ['commit', '-am', 'feature change'])

    git(repo, ['checkout', baseBranch])
    await writeFile(join(repo, 'notes.md'), 'base advanced\n')
    git(repo, ['commit', '-am', 'advance base branch'])
    git(repo, ['checkout', 'feature/preview'])

    const repository = new GitManager().getWorktreeRepositoryForRoot(repo, new LocalGitHost())
    const content = await readReviewFileContent({
      repository,
      source: { type: 'branch', baseBranch },
      file: {
        path: 'notes.md',
        changeKind: 'modified',
        revision: 'test',
        additions: 1,
        deletions: 1,
        binary: false,
        conflicted: false
      },
      side: 'before'
    })

    expect(content).toMatchObject({
      status: 'text',
      text: 'base\n'
    })
  }, 15_000)
})
