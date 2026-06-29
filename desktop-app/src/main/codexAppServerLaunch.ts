import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type CodexAppServerLaunchOptions = {
  command: string
  args: string[]
  cwd?: string
  displayBinary: string
  env?: NodeJS.ProcessEnv
}

export type CodexAppServerLaunchOptionsInput = {
  env?: NodeJS.ProcessEnv
  isPackaged?: boolean
  mainDir?: string
  platform?: NodeJS.Platform
  resourcesPath?: string
}

const BUNDLE_DIR = 'codex-app-server'
const SERVER_ARGS = ['--listen', 'stdio://']
const CARGO_ARGS = [
  'run',
  '--quiet',
  '-p',
  'codex-app-server',
  '--bin',
  'codex-app-server',
  '--',
  ...SERVER_ARGS
]

export function resolveBundledCodexAppServerBinary(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const binaryName = platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
  const candidates = [
    join(resourcesPath, BUNDLE_DIR, binaryName),
    join(resourcesPath, BUNDLE_DIR, 'bin', binaryName)
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolveCodexAppServerLaunchOptions(
  options: CodexAppServerLaunchOptionsInput = {}
): CodexAppServerLaunchOptions {
  const env = options.env ?? process.env
  const explicitBinary = env.CODEX_APP_SERVER_BIN
  if (explicitBinary) {
    return {
      command: explicitBinary,
      args: [...SERVER_ARGS],
      displayBinary: `${explicitBinary} ${SERVER_ARGS.join(' ')}`,
      env
    }
  }

  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? process.resourcesPath
    const binary = resolveBundledCodexAppServerBinary(
      resourcesPath,
      options.platform ?? process.platform
    )
    if (!binary) {
      throw new Error(
        `Packaged codex-app-server binary was not found under ${join(resourcesPath, BUNDLE_DIR)}`
      )
    }
    return {
      command: binary,
      args: [...SERVER_ARGS],
      displayBinary: `${binary} ${SERVER_ARGS.join(' ')}`,
      env
    }
  }

  const mainDir = options.mainDir ?? __dirname
  const developmentBinary = resolveDevelopmentCodexAppServerBinary(
    mainDir,
    options.platform ?? process.platform
  )
  if (developmentBinary) {
    return {
      command: developmentBinary,
      args: [...SERVER_ARGS],
      displayBinary: `${developmentBinary} ${SERVER_ARGS.join(' ')}`,
      env
    }
  }

  return {
    command: 'cargo',
    args: [...CARGO_ARGS],
    cwd: resolveCodexRustWorkspaceRoot(mainDir, env),
    displayBinary: `cargo ${CARGO_ARGS.join(' ')}`,
    env
  }
}

function resolveDevelopmentCodexAppServerBinary(
  mainDir: string,
  platform: NodeJS.Platform
): string | null {
  const desktopRoot = resolve(mainDir, '..', '..')
  return resolveBundledCodexAppServerBinary(join(desktopRoot, '.bundle-resources'), platform)
}

function resolveCodexRustWorkspaceRoot(mainDir: string, env: NodeJS.ProcessEnv): string {
  return env.CODEX_RUST_WORKSPACE_ROOT ?? resolve(mainDir, '..', '..', '..', 'codex', 'codex-rs')
}
