import { describe, expect, it } from 'vitest'

import { buildWorkspaceFileTreeGitStatus } from './workspaceFileTreeGit'

describe('buildWorkspaceFileTreeGitStatus', () => {
  it('maps changed files and aggregates the strongest state to loaded parent directories', () => {
    const result = buildWorkspaceFileTreeGitStatus(
      [
        file('src/added.ts', 'added'),
        file('src/renamed.ts', 'renamed'),
        file('src/deleted.ts', 'deleted')
      ],
      new Set(['src/', 'src/added.ts', 'src/renamed.ts'])
    )

    expect(result).toEqual([
      { path: 'src/', status: 'deleted' },
      { path: 'src/added.ts', status: 'added' },
      { path: 'src/renamed.ts', status: 'renamed' }
    ])
  })

  it('treats unresolved or conflicted changes as modified without creating missing nodes', () => {
    const result = buildWorkspaceFileTreeGitStatus(
      [file('missing.ts', 'unknown', true)],
      new Set<string>()
    )

    expect(result).toEqual([])
  })
})

function file(
  path: string,
  changeKind: import('../../../../../shared/localGitApi').LocalGitReviewFile['changeKind'],
  conflicted = false
): import('../../../../../shared/localGitApi').LocalGitReviewFile {
  return {
    additions: 0,
    binary: false,
    changeKind,
    conflicted,
    deletions: 0,
    path,
    revision: 'revision'
  }
}
