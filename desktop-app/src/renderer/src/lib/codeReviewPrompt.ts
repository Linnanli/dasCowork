export type CodeReviewTarget =
  | { type: 'uncommitted' }
  | { type: 'base-branch'; baseBranch: string; mergeBase: string }

/**
 * Builds the ordinary chat message used for Codex Review.  Keeping this as a
 * message (rather than a separate provider operation) preserves the existing
 * thread/start, thread/resume and turn/start transport path.
 */
export function buildCodeReviewPrompt(target: CodeReviewTarget): string {
  const scope =
    target.type === 'uncommitted'
      ? 'Review all staged, unstaged, and untracked changes in the current working tree.'
      : `Review changes on the current branch relative to ${target.baseBranch}. Use merge-base ${target.mergeBase} as the fixed comparison point.`

  return [
    'Perform a focused code review.',
    scope,
    'Prioritize real bugs, regressions, security or reliability risks, and missing tests.',
    'Report only actionable findings. Do not invent issues when there are no findings.',
    'For every finding, emit one standalone ::code-comment directive with title, body, file, start, end, and priority (P0-P3).',
    'If no actionable finding exists, give a brief conclusion without code-comment directives.'
  ].join('\n\n')
}
