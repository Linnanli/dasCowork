import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedVersion = packageJson.devDependencies['@openai/codex']
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['exec', '--offline', '--', 'codex', '--version'], {
  cwd: appRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit']
})

if (result.status !== 0) process.exit(result.status ?? 1)
const versionOutput = result.stdout.trim()
const reportedVersion = versionOutput.split(/\s+/u).at(-1)
if (reportedVersion !== expectedVersion) {
  throw new Error(`Expected Codex CLI ${expectedVersion}, received: ${versionOutput}`)
}
console.log(versionOutput)
