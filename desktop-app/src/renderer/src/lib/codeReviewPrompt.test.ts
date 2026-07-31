import { describe, expect, it } from 'vitest'

import { buildCodeReviewPrompt } from './codeReviewPrompt'

describe('buildCodeReviewPrompt', () => {
  it('includes every uncommitted change class and the structured-comment contract', () => {
    const prompt = buildCodeReviewPrompt({ type: 'uncommitted' })

    expect(prompt).toContain('staged, unstaged, and untracked')
    expect(prompt).toContain('::code-comment')
    expect(prompt).toContain('actionable')
  })

  it('pins branch review to the resolved base and merge base', () => {
    const prompt = buildCodeReviewPrompt({
      type: 'base-branch',
      baseBranch: 'main',
      mergeBase: 'a1b2c3d4'
    })

    expect(prompt).toContain('main')
    expect(prompt).toContain('a1b2c3d4')
  })
})
