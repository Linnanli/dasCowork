import { describe, expect, it } from 'vitest'

import { fileChangeHasRenderableDiff, fileChangePatch } from './file-change-diff-utils'

describe('file-change-diff', () => {
  it('adds missing unified diff headers and a hunk for patch-only updates', () => {
    expect(fileChangePatch('/workspace/src/example.ts', '+const answer = 42\n-old value')).toBe(
      '--- a/workspace/src/example.ts\n+++ b/workspace/src/example.ts\n@@ -1,1 +1,1 @@\n+const answer = 42\n-old value'
    )
  })

  it('does not alter complete unified diffs', () => {
    const patch = '--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-before\n+after'

    expect(fileChangePatch('example.ts', patch)).toBe(patch)
  })

  it('marks adds and deletes as renderable even without a patch body', () => {
    expect(fileChangeHasRenderableDiff({ path: 'new.ts', kind: 'add' })).toBe(true)
    expect(fileChangeHasRenderableDiff({ path: 'old.ts', kind: 'delete' })).toBe(true)
    expect(fileChangeHasRenderableDiff({ path: 'unchanged.ts', kind: 'update' })).toBe(false)
  })
})
