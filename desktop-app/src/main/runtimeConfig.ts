export type DesktopRuntimeConfig = {
  adminBackendUrl?: string
  adminBackendModelUserId?: string
  adminBackendModelCacheTtlMs?: number
}

export function loadDesktopRuntimeConfig(env: NodeJS.ProcessEnv): DesktopRuntimeConfig {
  const adminBackendUrl = env['ADMIN_BACKEND_URL']?.trim()
  const adminBackendModelUserId = env['ADMIN_BACKEND_MODEL_USER_ID']?.trim()
  const adminBackendModelCacheTtlMs = parsePositiveInteger(env['ADMIN_BACKEND_MODEL_CACHE_TTL_MS'])

  if (!adminBackendUrl) return {}

  return {
    adminBackendUrl,
    ...(adminBackendModelUserId ? { adminBackendModelUserId } : {}),
    ...(adminBackendModelCacheTtlMs ? { adminBackendModelCacheTtlMs } : {})
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
