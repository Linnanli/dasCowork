import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  resolveBundledCodexAppServerBinary,
  resolveCodexAppServerLaunchOptions
} from './codexAppServerLaunch'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempResourcesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-app-server-resources-'))
  tempDirs.push(dir)
  return dir
}

function createBinary(resourcesPath: string, platform: NodeJS.Platform): string {
  const binaryName = platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
  const binary = join(resourcesPath, 'codex-app-server', binaryName)
  mkdirSync(join(resourcesPath, 'codex-app-server'), { recursive: true })
  writeFileSync(binary, 'binary')
  return binary
}

describe('codex app-server launch resolution', () => {
  it('uses CODEX_APP_SERVER_BIN override with stdio listener args', () => {
    expect(
      resolveCodexAppServerLaunchOptions({
        env: { CODEX_APP_SERVER_BIN: '/custom/codex-app-server' },
        isPackaged: true,
        resourcesPath: '/missing'
      })
    ).toEqual({
      command: '/custom/codex-app-server',
      args: ['--listen', 'stdio://'],
      displayBinary: '/custom/codex-app-server --listen stdio://',
      env: { CODEX_APP_SERVER_BIN: '/custom/codex-app-server' }
    })
  })

  it('uses packaged resources/codex-app-server binary', () => {
    const resourcesPath = tempResourcesDir()
    const binary = createBinary(resourcesPath, 'darwin')

    expect(resolveBundledCodexAppServerBinary(resourcesPath, 'darwin')).toBe(binary)
    expect(
      resolveCodexAppServerLaunchOptions({
        env: {},
        isPackaged: true,
        platform: 'darwin',
        resourcesPath
      })
    ).toEqual({
      command: binary,
      args: ['--listen', 'stdio://'],
      displayBinary: `${binary} --listen stdio://`,
      env: {}
    })
  })

  it('uses the Windows executable name for packaged resources', () => {
    const resourcesPath = tempResourcesDir()
    const binary = createBinary(resourcesPath, 'win32')

    expect(resolveBundledCodexAppServerBinary(resourcesPath, 'win32')).toBe(binary)
    expect(binary.endsWith('codex-app-server.exe')).toBe(true)
  })

  it('runs cargo from codex/codex-rs in development', () => {
    expect(
      resolveCodexAppServerLaunchOptions({
        env: {},
        isPackaged: false,
        mainDir: resolve('/repo/desktop-app/out/main')
      })
    ).toEqual({
      command: 'cargo',
      args: [
        'run',
        '--quiet',
        '-p',
        'codex-app-server',
        '--bin',
        'codex-app-server',
        '--',
        '--listen',
        'stdio://'
      ],
      cwd: resolve('/repo/codex/codex-rs'),
      displayBinary:
        'cargo run --quiet -p codex-app-server --bin codex-app-server -- --listen stdio://',
      env: {}
    })
  })

  it('uses the built desktop app-server resource in development before falling back to cargo', () => {
    const repoRoot = tempResourcesDir()
    const desktopRoot = join(repoRoot, 'desktop-app')
    const binary = join(desktopRoot, '.bundle-resources', 'codex-app-server', 'codex-app-server')
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, 'binary')

    expect(
      resolveCodexAppServerLaunchOptions({
        env: {},
        isPackaged: false,
        mainDir: join(desktopRoot, 'out', 'main')
      })
    ).toEqual({
      command: binary,
      args: ['--listen', 'stdio://'],
      displayBinary: `${binary} --listen stdio://`,
      env: {}
    })
  })
})
