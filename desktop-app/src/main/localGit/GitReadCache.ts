export type GitReadInvalidationReason = 'config' | 'head' | 'index' | 'remote-refs' | 'working-tree'

export type GitReadInvalidation = 'short-lived' | readonly GitReadInvalidationReason[]

const GIT_READ_INVALIDATION_REASONS = new Set<GitReadInvalidationReason>([
  'config',
  'head',
  'index',
  'remote-refs',
  'working-tree'
])

export type GitReadCacheMetadata = {
  gitReadInvalidation?: GitReadInvalidation
  gitReadPaths?: readonly string[]
}

export type GitReadCacheKey = readonly [
  'git',
  hostId: string,
  canonicalRoot: string,
  type: string,
  ...parts: readonly unknown[]
]

export type GitReadCacheEntry<T = unknown> = {
  key: GitReadCacheKey
  promise: Promise<T> | null
  data: T | undefined
  createdAt: number
  staleTime: number
  invalidated: boolean
  metadata: GitReadCacheMetadata
}

export type GitReadCacheFetchOptions = {
  staleTime?: number
  metadata?: GitReadCacheMetadata
}

type GitReadCacheEntryInternal = GitReadCacheEntry & {
  keyId: string
  generation: number
  rejectedWhileCurrent: boolean
}

const DEFAULT_STALE_TIME = 0

/**
 * A small, renderer-independent cache for Git reads belonging to one worktree.
 * Entries are intentionally retained after invalidation so callers can inspect
 * their metadata; fetches never reuse invalidated or expired values.
 */
export class GitReadCache {
  private readonly entries = new Map<string, GitReadCacheEntryInternal>()
  private nextGeneration = 0

  fetch<T>(
    key: GitReadCacheKey,
    loader: () => Promise<T>,
    options: GitReadCacheFetchOptions = {}
  ): Promise<T> {
    const keyId = serializeKey(key)
    const existing = this.entries.get(keyId) as GitReadCacheEntryInternal | undefined
    if (existing?.promise && !existing.invalidated) {
      return this.waitForCurrentEntry(
        key,
        loader,
        options,
        existing,
        existing.promise as Promise<T>
      )
    }
    if (existing && !this.isStale(existing)) {
      return Promise.resolve(existing.data as T)
    }

    const entry: GitReadCacheEntryInternal = {
      key,
      keyId,
      generation: this.nextGeneration++,
      rejectedWhileCurrent: false,
      promise: null,
      data: undefined,
      createdAt: Date.now(),
      staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
      invalidated: false,
      metadata: options.metadata ?? {}
    }
    const promise = Promise.resolve().then(loader)
    entry.promise = promise
    this.entries.set(keyId, entry)

    promise.then(
      (data) => {
        if (!this.isCurrentEntry(entry)) return
        entry.data = data
        entry.promise = null
      },
      () => {
        if (!this.isCurrentEntry(entry)) return
        entry.rejectedWhileCurrent = true
        this.entries.delete(keyId)
      }
    )
    return this.waitForCurrentEntry(key, loader, options, entry, promise)
  }

  find<T>(key: GitReadCacheKey): GitReadCacheEntry<T> | undefined {
    return this.entries.get(serializeKey(key)) as GitReadCacheEntry<T> | undefined
  }

  invalidate(key: GitReadCacheKey): void {
    const entry = this.entries.get(serializeKey(key))
    if (entry) entry.invalidated = true
  }

  invalidateWhere(predicate: (entry: GitReadCacheEntry) => boolean): void {
    for (const entry of this.entries.values()) {
      if (predicate(entry)) entry.invalidated = true
    }
  }

  clear(): void {
    this.entries.clear()
  }

  private isStale(entry: GitReadCacheEntry): boolean {
    return entry.invalidated || Date.now() - entry.createdAt >= entry.staleTime
  }

  private isCurrentEntry(entry: GitReadCacheEntryInternal): boolean {
    const current = this.entries.get(entry.keyId)
    return current?.generation === entry.generation && !current.invalidated
  }

  private waitForCurrentEntry<T>(
    key: GitReadCacheKey,
    loader: () => Promise<T>,
    options: GitReadCacheFetchOptions,
    entry: GitReadCacheEntryInternal,
    promise: Promise<T>
  ): Promise<T> {
    return promise.then(
      (data) => (this.isCurrentEntry(entry) ? data : this.fetch(key, loader, options)),
      (error) => {
        if (entry.rejectedWhileCurrent) throw error
        return this.fetch(key, loader, options)
      }
    )
  }
}

export function createGitReadCacheKey(
  hostId: string,
  canonicalRoot: string,
  type: string,
  ...parts: readonly unknown[]
): GitReadCacheKey {
  return ['git', hostId, canonicalRoot, type, ...parts]
}

export function isGitReadInvalidationReason(value: string): value is GitReadInvalidationReason {
  return GIT_READ_INVALIDATION_REASONS.has(value as GitReadInvalidationReason)
}

export function gitReadCachePathMatches(
  root: string,
  cachedPaths: readonly string[] | undefined,
  changedPaths: readonly string[] | null | undefined
): boolean {
  if (!cachedPaths || !changedPaths) return true
  const normalizedRoot = normalizePath(root)
  return changedPaths.some((changedPath) => {
    const relativeChangedPath = relativeToRoot(normalizePath(changedPath), normalizedRoot)
    return cachedPaths.some((cachedPath) => {
      if (typeof cachedPath !== 'string') return false
      const normalizedCachedPath = normalizePath(cachedPath)
      return (
        relativeChangedPath === normalizedCachedPath ||
        relativeChangedPath.startsWith(`${normalizedCachedPath}/`) ||
        normalizedCachedPath.startsWith(`${relativeChangedPath}/`)
      )
    })
  })
}

function serializeKey(key: GitReadCacheKey): string {
  return JSON.stringify(key)
}

function relativeToRoot(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/u, '')
}
