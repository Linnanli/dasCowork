export type DesktopRuntimeConfig = {
  adminBackendUrl?: string
  adminBackendModelUserId?: string
  adminBackendModelCacheTtlMs?: number
  remoteCodexCommand?: string
}

export function loadDesktopRuntimeConfig(env: NodeJS.ProcessEnv): DesktopRuntimeConfig {
  const adminBackendUrl = env['ADMIN_BACKEND_URL']?.trim()
  const adminBackendModelUserId = env['ADMIN_BACKEND_MODEL_USER_ID']?.trim()
  const adminBackendModelCacheTtlMs = parsePositiveInteger(env['ADMIN_BACKEND_MODEL_CACHE_TTL_MS'])
  const remoteCodexCommand = parseRemoteCodexCommand(env['DASCOWORK_REMOTE_CODEX_COMMAND'])

  if (!adminBackendUrl) {
    return remoteCodexCommand ? { remoteCodexCommand } : {}
  }

  return {
    adminBackendUrl,
    ...(adminBackendModelUserId ? { adminBackendModelUserId } : {}),
    ...(adminBackendModelCacheTtlMs ? { adminBackendModelCacheTtlMs } : {}),
    ...(remoteCodexCommand ? { remoteCodexCommand } : {})
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseRemoteCodexCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (
    trimmed.includes('\0') ||
    /[\r\n]/u.test(trimmed) ||
    (!trimmed.startsWith('/') && !/^[A-Za-z0-9._+-]+$/u.test(trimmed))
  ) {
    throw new Error(
      'DASCOWORK_REMOTE_CODEX_COMMAND must be an executable name or absolute POSIX path'
    )
  }
  return trimmed
}
