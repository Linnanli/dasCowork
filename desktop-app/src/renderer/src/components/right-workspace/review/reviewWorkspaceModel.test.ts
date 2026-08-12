import { describe, expect, it } from 'vitest'

import {
  createLastTurnGroups,
  createSnapshotGroups,
  displaySourceIdentity,
  sourceLabel
} from './reviewWorkspaceModel'
import type { ReviewPartialSourceError } from './reviewWorkspaceTypes'
import type { LocalGitReviewSnapshot } from '../../../../../shared/localGitApi'

describe('reviewWorkspaceModel', () => {
  it('groups staged and unstaged sections by path without losing source identity', () => {
    const groups = createSnapshotGroups([
      snapshot('unstaged-generation', { type: 'unstaged' }, 'src/a.ts', 'unstaged-revision', 2, 1),
      snapshot('staged-generation', { type: 'staged' }, 'src/a.ts', 'staged-revision', 1, 0)
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ path: 'src/a.ts', additions: 3, deletions: 1 })
    expect(groups[0]?.sections).toHaveLength(2)
    expect(groups[0]?.sections[0]).toMatchObject({
      kind: 'snapshot',
      backendSource: { type: 'unstaged' },
      snapshotGeneration: 'unstaged-generation',
      file: { revision: 'unstaged-revision' }
    })
    expect(groups[0]?.sections[1]).toMatchObject({
      kind: 'snapshot',
      backendSource: { type: 'staged' },
      snapshotGeneration: 'staged-generation',
      file: { revision: 'staged-revision' }
    })
  })

  it('keeps a partial source error as its own non-actionable section', () => {
    const partialErrors: ReviewPartialSourceError[] = [
      { source: { type: 'staged' }, message: 'index is locked' }
    ]
    const groups = createSnapshotGroups(
      [snapshot('unstaged-generation', { type: 'unstaged' }, 'src/a.ts', 'revision', 1, 0)],
      partialErrors
    )

    expect(groups).toHaveLength(2)
    expect(groups[1]?.sections[0]).toMatchObject({
      kind: 'partial-error',
      backendSource: { type: 'staged' },
      message: 'index is locked'
    })
  })

  it('uses the reference project tree order for stacked diff files', () => {
    const groups = createSnapshotGroups([
      snapshot('generation', { type: 'unstaged' }, 'src/file10.ts', 'file10', 1, 0),
      snapshot('generation', { type: 'unstaged' }, 'src2/index.ts', 'src2', 1, 0),
      snapshot('generation', { type: 'unstaged' }, 'foo', 'foo', 1, 0),
      snapshot('generation', { type: 'unstaged' }, 'src/file2.ts', 'file2', 1, 0),
      snapshot('generation', { type: 'unstaged' }, 'foo/bar.ts', 'foo-bar', 1, 0),
      snapshot('generation', { type: 'unstaged' }, 'src/a.ts', 'a', 1, 0)
    ])

    expect(groups.map((group) => group.path)).toEqual([
      'foo/bar.ts',
      'src/a.ts',
      'src/file2.ts',
      'src/file10.ts',
      'src2/index.ts',
      'foo'
    ])
  })

  it('applies the same order to previous-turn diffs', () => {
    const groups = createLastTurnGroups(
      { type: 'last-turn', turnId: 'turn-1' },
      {
        turnId: 'turn-1',
        files: [
          { path: 'src/file10.ts', additions: 1, deletions: 0 },
          { path: 'src/file2.ts', additions: 1, deletions: 0 }
        ]
      }
    )

    expect(groups.map((group) => group.path)).toEqual(['src/file2.ts', 'src/file10.ts'])
  })

  it('uses renderer-only uncommitted labels and identities', () => {
    expect(displaySourceIdentity({ type: 'uncommitted' })).toBe('uncommitted')
    expect(sourceLabel({ type: 'uncommitted' })).toBe('未提交')
  })
})

function snapshot(
  generation: string,
  source: LocalGitReviewSnapshot['source'],
  path: string,
  revision: string,
  additions: number,
  deletions: number
): LocalGitReviewSnapshot {
  return {
    snapshotGeneration: generation,
    gitRoot: '/repo',
    source,
    files: [
      {
        path,
        changeKind: 'modified',
        revision,
        additions,
        deletions,
        binary: false,
        conflicted: false
      }
    ],
    stagedFileCount: source.type === 'staged' ? 1 : 0,
    unstagedFileCount: source.type === 'unstaged' ? 1 : 0,
    largeDiff: false
  }
}
