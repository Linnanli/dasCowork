import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { applyLoadedAdminBackendEnv, loadAdminBackendDotEnv } from './electron.vite.config'

describe('applyLoadedAdminBackendEnv', () => {
  it('copies supported admin backend values from loaded env when process env is missing', () => {
    const env: NodeJS.ProcessEnv = {}

    applyLoadedAdminBackendEnv(env, {
      ADMIN_BACKEND_URL: 'https://admin.example.com',
      ADMIN_BACKEND_MODEL_USER_ID: 'user-1',
      ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '5',
      OTHER_VALUE: 'ignored'
    })

    expect(env).toEqual({
      ADMIN_BACKEND_URL: 'https://admin.example.com',
      ADMIN_BACKEND_MODEL_USER_ID: 'user-1',
      ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '5'
    })
  })

  it('does not overwrite an explicit process env ADMIN_BACKEND_URL', () => {
    const env: NodeJS.ProcessEnv = {
      ADMIN_BACKEND_URL: 'https://shell.example.com'
    }

    applyLoadedAdminBackendEnv(env, {
      ADMIN_BACKEND_URL: 'https://dotenv.example.com'
    })

    expect(env['ADMIN_BACKEND_URL']).toBe('https://shell.example.com')
  })

  it('ignores blank loaded admin backend values', () => {
    const env: NodeJS.ProcessEnv = {}

    applyLoadedAdminBackendEnv(env, {
      ADMIN_BACKEND_URL: '   ',
      ADMIN_BACKEND_MODEL_USER_ID: '   ',
      ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '   '
    })

    expect(env).toEqual({})
  })
})

describe('loadAdminBackendDotEnv', () => {
  it('loads ADMIN_BACKEND_URL from Vite dotenv files', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'desktop-env-'))

    try {
      await writeFile(
        join(fixtureDir, '.env'),
        [
          'ADMIN_BACKEND_URL=https://env.example.com',
          'ADMIN_BACKEND_MODEL_USER_ID=user-1',
          'ADMIN_BACKEND_MODEL_CACHE_TTL_MS=5',
          ''
        ].join('\n')
      )
      const env: NodeJS.ProcessEnv = {}

      loadAdminBackendDotEnv('development', fixtureDir, env)

      expect(env['ADMIN_BACKEND_URL']).toBe('https://env.example.com')
      expect(env['ADMIN_BACKEND_MODEL_USER_ID']).toBe('user-1')
      expect(env['ADMIN_BACKEND_MODEL_CACHE_TTL_MS']).toBe('5')
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  })
})
