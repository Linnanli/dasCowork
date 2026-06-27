import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..')
const codexRustRoot = resolve(repoRoot, 'codex', 'codex-rs')
const target = process.env.CARGO_BUILD_TARGET
const profile = process.env.CARGO_PROFILE ?? 'release'
const profileDir = profile === 'dev' ? 'debug' : profile
const binaryName = process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
const targetDir = target
  ? join(codexRustRoot, 'target', target, profileDir)
  : join(codexRustRoot, 'target', profileDir)
const builtBinary = join(targetDir, binaryName)
const resourcesDir = join(desktopRoot, '.bundle-resources', 'codex-app-server')
const bundledBinary = join(resourcesDir, binaryName)

const args = [
  'build',
  '--package',
  'codex-app-server',
  '--bin',
  'codex-app-server',
  '--profile',
  profile
]
if (target) args.push('--target', target)

const result = spawnSync('cargo', args, {
  cwd: codexRustRoot,
  stdio: 'inherit',
  env: process.env
})

if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync(resourcesDir, { recursive: true })
copyFileSync(builtBinary, bundledBinary)
console.log(`Bundled ${builtBinary} -> ${bundledBinary}`)
