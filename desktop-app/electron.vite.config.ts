import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const ADMIN_BACKEND_ENV_KEYS = [
  'ADMIN_BACKEND_URL',
  'ADMIN_BACKEND_MODEL_USER_ID',
  'ADMIN_BACKEND_MODEL_CACHE_TTL_MS'
] as const

export function applyLoadedAdminBackendEnv(
  targetEnv: NodeJS.ProcessEnv,
  loadedEnv: Record<string, string | undefined>
): void {
  for (const key of ADMIN_BACKEND_ENV_KEYS) {
    const value = loadedEnv[key]?.trim()
    if (!value) continue
    if (targetEnv[key]?.trim()) continue

    targetEnv[key] = value
  }
}

export function loadAdminBackendDotEnv(
  mode: string,
  cwd = process.cwd(),
  targetEnv = process.env
): void {
  applyLoadedAdminBackendEnv(targetEnv, loadEnv(mode, cwd, 'ADMIN_BACKEND_'))
}

export default defineConfig(({ mode }) => {
  loadAdminBackendDotEnv(mode)

  return {
    main: {},
    preload: {},
    renderer: {
      resolve: {
        alias: {
          '@': resolve('src/renderer/src'),
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [tailwindcss(), react()]
    }
  }
})
