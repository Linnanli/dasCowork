import { describe, expect, it } from 'vitest'

import { extractHunkPatch, validateGitPatch } from './reviewPatch'

describe('reviewPatch', () => {
  it('rejects paths that escape the repository', () => {
    expect(() =>
      validateGitPatch('diff --git a/ok.txt b/../outside.txt\n--- a/ok.txt\n+++ b/../outside.txt\n')
    ).toThrow('path must stay inside the repository')
  })

  it('rejects absolute paths from patch headers', () => {
    expect(() => validateGitPatch('diff --git a/ok.txt b//tmp/outside.txt\n')).toThrow(
      'absolute paths are not allowed'
    )
  })

  it('extracts one hunk while preserving the file header', () => {
    const hunk = extractHunkPatch(
      [
        'diff --git a/file.txt b/file.txt',
        '--- a/file.txt',
        '+++ b/file.txt',
        '@@ -1 +1 @@',
        '-one',
        '+two',
        '@@ -3 +3 @@',
        '-three',
        '+four',
        ''
      ].join('\n'),
      'file.txt',
      1
    )

    expect(hunk).toContain('diff --git a/file.txt b/file.txt')
    expect(hunk).toContain('@@ -3 +3 @@')
    expect(hunk).not.toContain('@@ -1 +1 @@')
  })
})
