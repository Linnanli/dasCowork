/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * Limits a coverage run to the test cases explicitly declared by the manifest.
 * Running every test in a referenced spec makes unrelated failures invalidate
 * otherwise complete evidence.
 */
export function playwrightEvidenceSelection(evidence) {
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
    grep: testNames.length === 0 ? undefined : `(?:${testNames.map(escapeRegExp).join('|')})`
  }
}

function unique(values) {
  return [...new Set(values)]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
