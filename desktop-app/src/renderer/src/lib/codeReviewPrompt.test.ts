import { describe, expect, it } from 'vitest'

import { USER_REQUEST_FOR_CODEX_HEADER } from '../../../shared/userRequestEnvelope'
import { buildCodeReviewPrompt } from './codeReviewPrompt'

describe('buildCodeReviewPrompt', () => {
  it('matches the reference uncommitted-review prompt and localized request', () => {
    const prompt = buildCodeReviewPrompt({ type: 'uncommitted' })

    expect(prompt).toMatchInlineSnapshot(`
      "## Code review guidelines:
      # Review Guidelines

      You are acting as a reviewer for a proposed code change made by another engineer.

      Review the change and respond in normal Markdown. Do not return JSON, XML, a findings object, or any structured review schema.

      When feedback should be attached directly to a changed line, emit one \`::code-comment{...}\` directive for that issue. The directive creates an inline code comment in the review UI; keep the visible response as normal Markdown. Emit no directives when there are no actionable inline comments.

      Required \`code-comment\` attributes: \`title\`, \`body\`, and \`file\`. Optional attributes: \`start\`, \`end\`, and \`priority\`. Use the shortest useful line range. \`file\` should be an absolute path or include the workspace folder segment.

      Focus on discrete, actionable issues the original author would likely fix if they knew about them. Prefer no issues over speculative or low-signal feedback.

      General guidelines for whether to call out an issue:

      1. It meaningfully impacts correctness, performance, security, or maintainability.
      2. It is discrete and actionable.
      3. It was introduced by the change under review.
      4. The author would likely fix it once aware.
      5. It does not rely on unstated assumptions about intent.
      6. It identifies the affected behavior clearly rather than speculating broadly.

      When you call out an issue, include the relevant file and line or function in prose, explain the scenario where it matters, and keep the explanation concise. Use priority labels such as \`[P1]\` or \`[P2]\` only when helpful to communicate severity.

      If there are no actionable issues, say that directly and briefly.
      Review the current code changes (staged, unstaged, and untracked files) and provide concise, actionable feedback in a normal Markdown response.
      ## My request for Codex:
      请检查我未提交的更改"
    `)
  })

  it('matches the reference branch-review instructions and localized request', () => {
    const prompt = buildCodeReviewPrompt({
      type: 'base-branch',
      sourceBranch: 'feature/review',
      baseBranch: 'main',
      mergeBase: '  a1b2c3d4  '
    })

    expect(prompt).toContain(
      "Review the code changes against the base branch 'main'. The merge base commit for this comparison is a1b2c3d4. Run `git diff a1b2c3d4` to inspect the changes relative to main. Provide concise, actionable feedback in a normal Markdown response."
    )
    expect(
      prompt.endsWith(`${USER_REQUEST_FOR_CODEX_HEADER}\n请审查 feature/review 相较于 main 的更改`)
    ).toBe(true)
  })
})
