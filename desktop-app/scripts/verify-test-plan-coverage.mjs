/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expectedScenarioIds,
  validateTestPlanCoverage
} from './lib/test-plan-coverage-validator.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const manifestPath = resolveManifestPath(process.argv.slice(2))

const failures = []
const manifest = await readManifest()
let validation = {
  failures: [],
  scenarioCount: 0,
  summary: 'manifest unavailable'
}
if (manifest) {
  validation = await validateTestPlanCoverage({ manifest, desktopRoot })
  failures.push(...validation.failures)
}

console.log(
  `Test-plan coverage: ${validation.scenarioCount}/${expectedScenarioIds.length} scenarios; ${validation.summary}`
)

if (failures.length > 0) {
  console.error('Test-plan coverage contract failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    failures.push(`cannot parse ${relative(desktopRoot, manifestPath)}: ${message(error)}`)
    return undefined
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

function resolveManifestPath(args) {
  const manifestIndex = args.indexOf('--manifest')
  if (manifestIndex === -1) return resolve(desktopRoot, 'tests/test-plan-coverage.json')
  const value = args[manifestIndex + 1]
  if (!value) {
    console.error('--manifest requires a path')
    process.exit(2)
  }
  return resolve(process.cwd(), value)
}
