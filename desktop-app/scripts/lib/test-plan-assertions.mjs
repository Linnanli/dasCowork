/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/**
 * A runner-owned test identity. Test bodies may select the scenario and the
 * assertion they prove, but they may never choose the test invocation to
 * which that evidence is attached.
 */
export function createExecutedTestIdentity({ runner, file, fullTestName }) {
  assert.equal(typeof runner, 'string', 'test identity requires a runner')
  assert.equal(typeof file, 'string', 'test identity requires a file')
  assert.equal(typeof fullTestName, 'string', 'test identity requires a full test name')
  assert.ok(runner.trim(), 'test identity runner must not be empty')
  assert.ok(file.trim(), 'test identity file must not be empty')
  assert.ok(fullTestName.trim(), 'test identity full test name must not be empty')

  const normalizedFile = normalizeRelativePath(file)
  return {
    runner,
    file: normalizedFile,
    fullTestName,
    invocationId: `${runner}\u0000${normalizedFile}\u0000${fullTestName}`
  }
}

/**
 * Core recorder used by runner adapters and Node-only tests. The identity is
 * supplied outside the assertion body so it cannot be used to impersonate a
 * neighbouring test case.
 */
export function createPlanAssertionRecorder(runId, identity) {
  const assertions = []
  const executedTest = createExecutedTestIdentity(identity)

  return {
    async planAssert(input) {
      const { scenarioId, assertionId, assertion } = validatePlanAssertionInput(input)
      await assertion()
      assertions.push({ runId, scenarioId, assertionId, ...executedTest })
    },
    records() {
      return [...assertions]
    }
  }
}

/**
 * Records an assertion from the currently-running Vitest or Playwright test.
 * The public input intentionally contains only the claimed plan assertion;
 * the runner adapter supplies file/full-name identity after the callback
 * succeeds.
 */
export async function planAssert(input) {
  return createRunnerPlanAssertionRecorder(currentRunnerIdentity).planAssert(input)
}

/**
 * Vitest does not install its imported expect() onto globalThis by default.
 * Vitest evidence tests bind the expect instance they are already using so
 * the adapter can read its runner-owned testPath/currentTestName state.
 */
export function createVitestPlanAssertionRecorder(expectApi) {
  return createRunnerPlanAssertionRecorder(() => vitestIdentity(expectApi))
}

/**
 * Binds one real assertion to several plan scenarios exercised by the same
 * test case.  Scenario IDs remain explicit at the call site, while the
 * runner adapter continues to own the invocation identity.
 */
export function planAssertionsForScenarios(scenarioIds, recordAssertion) {
  assert.ok(Array.isArray(scenarioIds), 'plan assertion scenarios must be an array')
  assert.ok(scenarioIds.length > 0, 'plan assertion scenarios must not be empty')
  assert.equal(typeof recordAssertion, 'function', 'plan assertion recorder must be runner-bound')
  for (const scenarioId of scenarioIds) {
    assert.equal(typeof scenarioId, 'string', 'plan assertion scenario IDs must be strings')
    assert.ok(scenarioId.trim(), 'plan assertion scenario IDs must not be empty')
  }

  return async (assertionId, assertion) => {
    for (const scenarioId of scenarioIds) {
      await recordAssertion({ scenarioId, assertionId, assertion })
    }
  }
}

/**
 * Explicit adapter for Playwright helpers that already receive TestInfo. Most
 * direct test calls use planAssert(), which resolves the same TestInfo through
 * test.info(). Keeping this export makes helper boundaries explicit and easy
 * to test without a Playwright worker.
 */
export function createPlaywrightPlanAssertionRecorder(testInfo) {
  const identity = playwrightIdentity(testInfo)
  return createRunnerPlanAssertionRecorder(() => identity)
}

function validatePlanAssertionInput(input) {
  assert.ok(input && typeof input === 'object', 'planAssert requires an input object')
  for (const key of Object.keys(input)) {
    if (!['scenarioId', 'assertionId', 'assertion'].includes(key)) {
      throw new TypeError(`planAssert does not accept ${key}; runner identity is derived at runtime`)
    }
  }
  const { scenarioId, assertionId, assertion } = input
  assert.equal(typeof scenarioId, 'string', 'planAssert requires a scenarioId')
  assert.equal(typeof assertionId, 'string', 'planAssert requires an assertionId')
  assert.equal(typeof assertion, 'function', 'planAssert requires an assertion callback')
  assert.ok(scenarioId.trim(), 'planAssert scenarioId must not be empty')
  assert.ok(assertionId.trim(), 'planAssert assertionId must not be empty')
  return { scenarioId, assertionId, assertion }
}

async function currentRunnerIdentity() {
  const vitest = vitestIdentity()
  if (vitest) return vitest

  const { test } = await import('@playwright/test')
  return playwrightIdentity(test.info())
}

function createRunnerPlanAssertionRecorder(resolveIdentity) {
  return {
    async planAssert(input) {
      const { scenarioId, assertionId, assertion } = validatePlanAssertionInput(input)
      await assertion()

      const runId = process.env.DASCOWORK_TEST_PLAN_RUN_ID
      const outputPath = process.env.DASCOWORK_TEST_PLAN_ASSERTIONS_PATH
      if (!runId && !outputPath) return
      if (!runId || !outputPath) {
        throw new Error(
          'planAssert requires DASCOWORK_TEST_PLAN_RUN_ID and DASCOWORK_TEST_PLAN_ASSERTIONS_PATH'
        )
      }
      const identity = await resolveIdentity()
      appendFileSync(
        outputPath,
        `${JSON.stringify({ runId, scenarioId, assertionId, ...identity })}\n`,
        'utf8'
      )
    }
  }
}

function vitestIdentity(expectApi = globalThis.expect) {
  if (!expectApi || typeof expectApi.getState !== 'function') return undefined
  const state = expectApi.getState()
  if (
    !state ||
    typeof state.testPath !== 'string' ||
    state.testPath.trim() === '' ||
    typeof state.currentTestName !== 'string' ||
    state.currentTestName.trim() === ''
  ) {
    return undefined
  }
  return createExecutedTestIdentity({
    runner: 'vitest',
    file: relativeToDesktopRoot(state.testPath),
    fullTestName: state.currentTestName
  })
}

function playwrightIdentity(testInfo) {
  assert.ok(testInfo && typeof testInfo === 'object', 'Playwright test.info() is required')
  assert.equal(typeof testInfo.file, 'string', 'Playwright test.info().file is required')
  const titlePath =
    typeof testInfo.titlePath === 'function' ? testInfo.titlePath() : testInfo.titlePath
  assert.ok(Array.isArray(titlePath), 'Playwright test.info().titlePath must be an array')
  const file = relativeToDesktopRoot(testInfo.file)
  const fullTestName = normalizePlaywrightTitlePath(titlePath, testInfo)
  return createExecutedTestIdentity({ runner: 'playwright', file, fullTestName })
}

function normalizePlaywrightTitlePath(titlePath, testInfo) {
  assert.ok(Array.isArray(titlePath), 'Playwright test.info().titlePath() must return an array')
  const fileName = normalizeRelativePath(testInfo.file).split('/').at(-1)
  const projectName = testInfo.project?.name
  const titles = titlePath.filter(
    (title) =>
      typeof title === 'string' &&
      title.trim() !== '' &&
      title !== fileName &&
      title !== testInfo.file &&
      title !== projectName
  )
  assert.ok(titles.length > 0, 'Playwright test.info().titlePath() has no test title')
  return titles.join(' > ')
}

function relativeToDesktopRoot(path) {
  const root = process.env.DASCOWORK_TEST_PLAN_DESKTOP_ROOT
  if (!root) {
    throw new Error('planAssert requires DASCOWORK_TEST_PLAN_DESKTOP_ROOT during an evidence run')
  }
  const normalized = relative(resolve(root), resolve(path))
  if (normalized === '' || normalized === '..' || normalized.startsWith(`..${sep}`)) {
    throw new Error('runner test identity points outside desktop-app')
  }
  return normalizeRelativePath(normalized)
}

function normalizeRelativePath(file) {
  return file.split(sep).join('/')
}
