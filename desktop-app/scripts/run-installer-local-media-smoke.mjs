/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { releaseArtifactName } from './release-artifacts.mjs'

const appRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const options = parseOptions(process.argv.slice(2))
const artifactName = releaseArtifactName(packageJson.version, options.kind, options.arch)
const artifactPath = join(appRoot, 'dist', artifactName)

if (!existsSync(artifactPath)) throw new Error(`Installer artifact not found: ${artifactPath}`)

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dascowork-installer-smoke-'))
let cleanupInstaller = () => undefined

try {
  const installed = installOrExtractArtifact(artifactPath, temporaryRoot, options.kind)
  cleanupInstaller = installed.cleanup
  if (!existsSync(installed.executable)) {
    throw new Error(`Installed application executable not found: ${installed.executable}`)
  }

  run('npm', ['run', 'verify:pdf-worker-bundle'])
  run('npm', ['run', 'verify:review-diff-worker-bundle'])
  run(
    'npm',
    [
      'exec',
      '--offline',
      '--',
      'playwright',
      'test',
      'tests/e2e/packaged-local-media-smoke.e2e.ts',
      '--reporter=line'
    ],
    { DASCOWORK_PACKAGED_APP_EXECUTABLE: installed.executable }
  )
} finally {
  cleanupInstaller()
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error('Expected --kind and --arch values')
    options[name.slice(2)] = value
  }
  if (!options.kind || !options.arch) throw new Error('Both --kind and --arch are required')
  return options
}

function installOrExtractArtifact(artifactPath, temporaryRoot, kind) {
  if (kind === 'dmg') return mountDmg(artifactPath, temporaryRoot)
  if (kind === 'nsis') return installNsis(artifactPath, temporaryRoot)
  if (kind === 'appimage') return extractAppImage(artifactPath, temporaryRoot)
  if (kind === 'deb') return extractDeb(artifactPath, temporaryRoot)
  if (kind === 'snap') return extractSnap(artifactPath, temporaryRoot)
  throw new Error(`Installer smoke is not supported for: ${kind}`)
}

function mountDmg(artifactPath, temporaryRoot) {
  const mountPoint = join(temporaryRoot, 'mounted-dmg')
  mkdirSync(mountPoint)
  run('hdiutil', ['attach', artifactPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint])
  return {
    executable: join(mountPoint, 'desktop-app.app', 'Contents', 'MacOS', 'desktop-app'),
    cleanup: () => run('hdiutil', ['detach', mountPoint])
  }
}

function installNsis(artifactPath, temporaryRoot) {
  const installDirectory = join(temporaryRoot, 'installed')
  mkdirSync(installDirectory)
  run(artifactPath, ['/S', `/D=${installDirectory}`])
  return {
    executable: join(installDirectory, 'desktop-app.exe'),
    cleanup: () => undefined
  }
}

function extractAppImage(artifactPath, temporaryRoot) {
  chmodSync(artifactPath, 0o755)
  run(artifactPath, ['--appimage-extract'], {}, temporaryRoot)
  return {
    executable: join(temporaryRoot, 'squashfs-root', 'desktop-app'),
    cleanup: () => undefined
  }
}

function extractDeb(artifactPath, temporaryRoot) {
  const extractDirectory = join(temporaryRoot, 'deb-root')
  mkdirSync(extractDirectory)
  run('dpkg-deb', ['--extract', artifactPath, extractDirectory])
  return {
    executable: join(extractDirectory, 'opt', 'desktop-app', 'desktop-app'),
    cleanup: () => undefined
  }
}

function extractSnap(artifactPath, temporaryRoot) {
  const extractDirectory = join(temporaryRoot, 'snap-root')
  run('unsquashfs', ['-force', '-dest', extractDirectory, artifactPath])
  return {
    executable: join(extractDirectory, 'app', 'desktop-app'),
    cleanup: () => undefined
  }
}

function run(command, args, extraEnv = {}, cwd = appRoot) {
  const pinnedCodexPath = join(appRoot, 'node_modules', '.bin')
  const env = {
    ...process.env,
    ...extraEnv,
    PATH: `${pinnedCodexPath}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.CODEX_APP_SERVER_BIN
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 1}`)
  }
}
