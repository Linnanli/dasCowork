import { describe, expect, it } from 'vitest'

import { loadDesktopRuntimeConfig } from './runtimeConfig'

describe('loadDesktopRuntimeConfig', () => {
  it('loads admin backend runtime config from process env shape', () => {
    expect(
      loadDesktopRuntimeConfig({
        ADMIN_BACKEND_URL: ' https://admin.example.com ',
        ADMIN_BACKEND_MODEL_USER_ID: ' user-1 ',
        ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '5'
      })
    ).toEqual({
      adminBackendUrl: 'https://admin.example.com',
      adminBackendModelUserId: 'user-1',
      adminBackendModelCacheTtlMs: 5
    })
  })

  it('omits adminBackendUrl when ADMIN_BACKEND_URL is missing or blank', () => {
    expect(loadDesktopRuntimeConfig({})).toEqual({})
    expect(loadDesktopRuntimeConfig({ ADMIN_BACKEND_URL: '   ' })).toEqual({})
  })

  it('omits blank user ids and invalid cache TTL values', () => {
    expect(
      loadDesktopRuntimeConfig({
        ADMIN_BACKEND_URL: 'https://admin.example.com',
        ADMIN_BACKEND_MODEL_USER_ID: '   ',
        ADMIN_BACKEND_MODEL_CACHE_TTL_MS: 'not-a-number'
      })
    ).toEqual({
      adminBackendUrl: 'https://admin.example.com'
    })
  })

  it('loads the main-process-only remote Codex command', () => {
    expect(
      loadDesktopRuntimeConfig({
        DASCOWORK_REMOTE_CODEX_COMMAND: ' /opt/codex/bin/codex '
      })
    ).toEqual({ remoteCodexCommand: '/opt/codex/bin/codex' })
  })

  it('loads a main-owned integrated terminal command', () => {
    expect(loadDesktopRuntimeConfig({ DASCOWORK_TERMINAL_COMMAND: ' /bin/fish ' })).toEqual({
      terminalCommand: '/bin/fish'
    })
  })

  it('rejects multiline remote Codex commands', () => {
    expect(() =>
      loadDesktopRuntimeConfig({
        DASCOWORK_REMOTE_CODEX_COMMAND: 'codex\nwhoami'
      })
    ).toThrow('must be an executable name or absolute POSIX path')
  })

  it('rejects relative remote Codex paths', () => {
    expect(() =>
      loadDesktopRuntimeConfig({
        DASCOWORK_REMOTE_CODEX_COMMAND: './bin/codex'
      })
    ).toThrow('must be an executable name or absolute POSIX path')
  })

  it('rejects multiline terminal commands', () => {
    expect(() => loadDesktopRuntimeConfig({ DASCOWORK_TERMINAL_COMMAND: 'zsh\necho unsafe' })).toThrow(
      'DASCOWORK_TERMINAL_COMMAND must be an executable name or absolute POSIX path'
    )
  })
})
