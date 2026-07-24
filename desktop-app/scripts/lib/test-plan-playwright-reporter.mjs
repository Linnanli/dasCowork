/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { relative, resolve, sep } from 'node:path'

/**
 * Normalizes the JSON reporter's spec file to desktop-app-relative form.
 * Playwright documents spec.file relative to config.rootDir, while
 * test.info().file is absolute; this makes their identities comparable
 * without allowing paths outside desktop-app into coverage evidence.
 */
export function normalizePlaywrightReporterFile({ desktopRoot, reportRootDir, specFile }) {
  if (typeof desktopRoot !== 'string' || desktopRoot.trim() === '') {
    throw new Error('Playwright reporter normalization requires desktopRoot')
  }
  if (typeof reportRootDir !== 'string' || reportRootDir.trim() === '') {
    throw new Error('Playwright reporter has no rootDir')
  }
  if (typeof specFile !== 'string' || specFile.trim() === '') {
    throw new Error('Playwright reporter spec has no file path')
  }

  const file = relative(resolve(desktopRoot), resolve(reportRootDir, specFile))
  if (file === '' || file === '..' || file.startsWith(`..${sep}`)) {
    throw new Error('Playwright reporter file points outside desktop-app')
  }
  return file.split(sep).join('/')
}

/**
 * Turns Playwright's JSON reporter structure into one record per scheduled
 * test case. A spec can contain more than one case (for example, a repeated
 * or multi-project run), and collapsing them would conceal an ambiguous
 * coverage identity. Retried attempts remain attached to their one case and
 * make that case fail if any attempt failed.
 */
export function flattenPlaywrightReporterSuites({ desktopRoot, report }) {
  return flattenSuites({
    desktopRoot,
    suites: report?.suites ?? [],
    reportRootDir: report?.config?.rootDir,
    ancestorTitles: []
  })
}

function flattenSuites({ desktopRoot, suites, reportRootDir, ancestorTitles }) {
  return suites.flatMap((suite) => {
    const suiteTitle = normalizePlaywrightSuiteTitle(suite)
    const titles = suiteTitle ? [...ancestorTitles, suiteTitle] : ancestorTitles
    return [
      ...flattenSuites({
        desktopRoot,
        suites: suite.suites ?? [],
        reportRootDir,
        ancestorTitles: titles
      }),
      ...(suite.specs ?? []).flatMap((spec) =>
        flattenSpec({ desktopRoot, reportRootDir, titles, spec })
      )
    ]
  })
}

function flattenSpec({ desktopRoot, reportRootDir, titles, spec }) {
  const file = normalizePlaywrightReporterFile({
    desktopRoot,
    reportRootDir,
    specFile: spec.file
  })
  const fullTestName = [...titles, spec.title].join(' > ')
  const tests = Array.isArray(spec.tests) ? spec.tests : []
  if (tests.length === 0) {
    return [
      {
        runner: 'playwright',
        file,
        testName: spec.title,
        fullTestName,
        status: 'missing',
        mode: 'run'
      }
    ]
  }

  return tests.map((test) => {
    const results = Array.isArray(test.results) ? test.results : []
    const failedResult = results.find((result) => result.status !== 'passed')
    return {
      runner: 'playwright',
      file,
      testName: spec.title,
      fullTestName,
      status: failedResult?.status ?? results.at(-1)?.status ?? 'missing',
      mode: test.expectedStatus === 'passed' ? 'run' : 'skip'
    }
  })
}

function normalizePlaywrightSuiteTitle(suite) {
  if (typeof suite?.title !== 'string' || suite.title.trim() === '') return undefined
  const suiteFileName = typeof suite.file === 'string' ? suite.file.split('/').at(-1) : undefined
  return suite.title === suiteFileName ? undefined : suite.title
}
