export const FILE_TREE_DEFAULT_WIDTH = 280
export const FILE_TREE_MIN_WIDTH = 200
export const FILE_TREE_MAX_EXPANDED_PATHS = 500
export const FILE_TREE_MAX_PATH_LENGTH = 4096

export type FileTreePreferences = {
  visible: boolean
  width: number
  expandedPaths: readonly string[]
  scrollTop: number
}

export function defaultFileTreePreferences(): FileTreePreferences {
  return {
    visible: true,
    width: FILE_TREE_DEFAULT_WIDTH,
    expandedPaths: [],
    scrollTop: 0
  }
}

export function loadFileTreePreferences(workspaceId: string): FileTreePreferences {
  if (typeof window === 'undefined') return defaultFileTreePreferences()
  try {
    const stored = window.localStorage.getItem(fileTreePreferencesStorageKey(workspaceId))
    return stored ? sanitizeFileTreePreferences(JSON.parse(stored)) : defaultFileTreePreferences()
  } catch {
    return defaultFileTreePreferences()
  }
}

export function persistFileTreePreferences(
  workspaceId: string,
  preferences: FileTreePreferences
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      fileTreePreferencesStorageKey(workspaceId),
      JSON.stringify(sanitizeFileTreePreferences(preferences))
    )
  } catch {
    // A storage failure must not prevent file browsing.
  }
}

export function sanitizeFileTreePreferences(value: unknown): FileTreePreferences {
  const fallback = defaultFileTreePreferences()
  if (!isRecord(value)) return fallback

  return {
    visible: value.visible !== false,
    width:
      typeof value.width === 'number' && Number.isFinite(value.width)
        ? Math.max(FILE_TREE_MIN_WIDTH, Math.round(value.width))
        : fallback.width,
    expandedPaths: sanitizeExpandedPaths(value.expandedPaths),
    scrollTop:
      typeof value.scrollTop === 'number' &&
      Number.isFinite(value.scrollTop) &&
      value.scrollTop >= 0
        ? Math.min(Math.round(value.scrollTop), Number.MAX_SAFE_INTEGER)
        : fallback.scrollTop
  }
}

export function fileTreePreferencesStorageKey(workspaceId: string): string {
  return `file-workspace-tree:${workspaceId}`
}

function sanitizeExpandedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const valuePath of value) {
    const path = normalizeExpandedPath(valuePath)
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length === FILE_TREE_MAX_EXPANDED_PATHS) break
  }
  return paths
}

function normalizeExpandedPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim().replace(/\/+$/u, '')
  if (
    !path ||
    path.length > FILE_TREE_MAX_PATH_LENGTH ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    /^[A-Za-z]:/u.test(path)
  ) {
    return undefined
  }
  const segments = path.split('/')
  return segments.some((segment) => !segment || segment === '.' || segment === '..')
    ? undefined
    : path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
