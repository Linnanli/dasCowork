import { buildUserRequestEnvelope } from '../../../shared/userRequestEnvelope'

export type CodeReviewTarget =
  | { type: 'uncommitted' }
  | { type: 'base-branch'; sourceBranch: string; baseBranch: string; mergeBase: string }

const CODE_REVIEW_GUIDELINES_HEADER = '## Code review guidelines:'

const REVIEW_GUIDELINES = `# Review Guidelines

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
`

const UNCOMMITTED_REVIEW_INSTRUCTIONS =
  'Review the current code changes (staged, unstaged, and untracked files) and provide concise, actionable feedback in a normal Markdown response.'

const BASE_BRANCH_REVIEW_INSTRUCTIONS =
  "Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide concise, actionable feedback in a normal Markdown response."

/**
 * Builds the ordinary chat message used for Codex Review.  Keeping this as a
 * message (rather than a separate provider operation) preserves the existing
 * thread/start, thread/resume and turn/start transport path.
 */
export function buildCodeReviewPrompt(target: CodeReviewTarget): string {
  const reviewInstructions =
    target.type === 'uncommitted'
      ? UNCOMMITTED_REVIEW_INSTRUCTIONS
      : BASE_BRANCH_REVIEW_INSTRUCTIONS.replaceAll('{baseBranch}', target.baseBranch).replaceAll(
          '{mergeBaseSha}',
          target.mergeBase.trim()
        )
  const requestMessage =
    target.type === 'uncommitted'
      ? '请检查我未提交的更改'
      : `请审查 ${target.sourceBranch} 相较于 ${target.baseBranch} 的更改`
  const reviewContext = [
    CODE_REVIEW_GUIDELINES_HEADER,
    REVIEW_GUIDELINES.trim(),
    reviewInstructions.trim()
  ].join('\n')

  return buildUserRequestEnvelope(reviewContext, requestMessage)
}
