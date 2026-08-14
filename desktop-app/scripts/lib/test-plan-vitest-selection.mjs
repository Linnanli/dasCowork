/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * Limits a coverage run to the Vitest cases explicitly declared by the
 * manifest. File-only filtering still runs unrelated tests in broad evidence
 * specs, which can make this gate fail on unrelated concurrency or timeouts.
 */
export function vitestEvidenceSelection(evidence) {
  const files = unique(
    evidence
      .map((entry) => entry?.file)
      .filter((file) => typeof file === 'string' && file.trim() !== '')
  )
  const testNames = unique(
    evidence
      .map((entry) => entry?.testName)
      .filter((testName) => typeof testName === 'string' && testName.trim() !== '')
  )

  return {
    files,
    testNamePattern:
      testNames.length === 0
        ? undefined
        : `(?:${testNames.map(testNamePatternFragment).join('|')})`
  }
}

function testNamePatternFragment(value) {
  return value
    .split(/(%[sdifjoO]|\$[A-Za-z_][\w$]*)/u)
    .map((fragment) =>
      /^(?:%[sdifjoO]|\$[A-Za-z_][\w$]*)$/u.test(fragment) ? '.+' : escapeRegExp(fragment)
    )
    .join('')
}

function unique(values) {
  return [...new Set(values)]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
