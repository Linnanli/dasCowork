import { describe, expect, it, vi } from 'vitest'

import {
  GitReadCache,
  createGitReadCacheKey,
  gitReadCachePathMatches,
  isGitReadInvalidationReason,
  type GitReadCacheEntry
} from './GitReadCache'

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('GitReadCache', () => {
  const key = createGitReadCacheKey('local', '/repo', 'config')

  it('builds host-isolated keys', () => {
    expect(createGitReadCacheKey('local', '/repo', 'status', 'porcelain')).toEqual([
      'git',
      'local',
      '/repo',
      'status',
      'porcelain'
    ])
    expect(createGitReadCacheKey('remote', '/repo', 'status')).not.toEqual(key)
  })

  it('recognizes only supported reason invalidation metadata', () => {
    expect(isGitReadInvalidationReason('head')).toBe(true)
    expect(isGitReadInvalidationReason('short-lived')).toBe(false)
    expect(isGitReadInvalidationReason('unknown')).toBe(false)
  })

  it('deduplicates concurrent reads for the same key', async () => {
    let resolve: ((value: string) => void) | undefined
    const loader = vi.fn(
      () =>
        new Promise<string>((complete) => {
          resolve = complete
        })
    )
    const cache = new GitReadCache()

    const first = cache.fetch(key, loader)
    const second = cache.fetch(key, loader)
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
    resolve?.('ready')

    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    expect(loader).toHaveBeenCalledOnce()
  })

  it('re-reads for old waiters after an invalidated pending entry is replaced', async () => {
    const stale = createDeferred<string>()
    const fresh = createDeferred<string>()
    const loader = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const cache = new GitReadCache()

    const oldWaiter = cache.fetch(key, loader, { staleTime: Infinity })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())

    cache.invalidate(key)
    const currentRead = cache.fetch(key, loader, { staleTime: Infinity })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))

    fresh.resolve('fresh')
    await expect(currentRead).resolves.toBe('fresh')

    stale.resolve('stale')
    await expect(oldWaiter).resolves.toBe('fresh')
    expect(cache.find<string>(key)).toMatchObject({
      data: 'fresh',
      invalidated: false,
      promise: null
    })
  })

  it('does not let an invalidated loader failure clear a newer pending entry', async () => {
    const stale = createDeferred<string>()
    const fresh = createDeferred<string>()
    const loader = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const cache = new GitReadCache()

    const oldWaiter = cache.fetch(key, loader, { staleTime: Infinity })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())

    cache.invalidate(key)
    const currentRead = cache.fetch(key, loader, { staleTime: Infinity })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))

    stale.reject(new Error('stale failure'))
    await vi.waitFor(() =>
      expect(cache.find<string>(key)).toMatchObject({ invalidated: false, data: undefined })
    )

    fresh.resolve('fresh')
    await expect(Promise.all([oldWaiter, currentRead])).resolves.toEqual(['fresh', 'fresh'])
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('keeps non-matching pending entries valid during invalidateWhere', async () => {
    const stale = createDeferred<string>()
    const fresh = createDeferred<string>()
    const unaffected = createDeferred<string>()
    const matchingLoader = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const unaffectedLoader = vi.fn<() => Promise<string>>().mockReturnValue(unaffected.promise)
    const unaffectedKey = createGitReadCacheKey('local', '/repo', 'head')
    const cache = new GitReadCache()

    const oldMatchingWaiter = cache.fetch(key, matchingLoader, { staleTime: Infinity })
    const unaffectedRead = cache.fetch(unaffectedKey, unaffectedLoader, { staleTime: Infinity })
    await vi.waitFor(() => {
      expect(matchingLoader).toHaveBeenCalledOnce()
      expect(unaffectedLoader).toHaveBeenCalledOnce()
    })

    cache.invalidateWhere((entry) => entry.key[3] === 'config')
    const currentMatchingRead = cache.fetch(key, matchingLoader, { staleTime: Infinity })
    const duplicateUnaffectedRead = cache.fetch(unaffectedKey, unaffectedLoader, {
      staleTime: Infinity
    })
    await vi.waitFor(() => expect(matchingLoader).toHaveBeenCalledTimes(2))

    fresh.resolve('fresh')
    stale.resolve('stale')
    unaffected.resolve('unchanged')

    await expect(
      Promise.all([oldMatchingWaiter, currentMatchingRead, unaffectedRead, duplicateUnaffectedRead])
    ).resolves.toEqual(['fresh', 'fresh', 'unchanged', 'unchanged'])
    expect(matchingLoader).toHaveBeenCalledTimes(2)
    expect(unaffectedLoader).toHaveBeenCalledOnce()
  })

  it('uses a cached value until its TTL expires', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const loader = vi.fn(async () => 'first')
      const cache = new GitReadCache()

      await expect(cache.fetch(key, loader, { staleTime: 1_000 })).resolves.toBe('first')
      vi.setSystemTime(999)
      await expect(cache.fetch(key, loader, { staleTime: 1_000 })).resolves.toBe('first')
      expect(loader).toHaveBeenCalledOnce()

      vi.setSystemTime(1_000)
      await expect(cache.fetch(key, loader, { staleTime: 1_000 })).resolves.toBe('first')
      expect(loader).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retain a failed read', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered')
    const cache = new GitReadCache()

    await expect(cache.fetch(key, loader, { staleTime: 1_000 })).rejects.toThrow(
      'temporary failure'
    )
    expect(cache.find(key)).toBeUndefined()
    await expect(cache.fetch(key, loader, { staleTime: 1_000 })).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('invalidates a single key, matching entries, or all entries', async () => {
    const cache = new GitReadCache()
    const headKey = createGitReadCacheKey('local', '/repo', 'head')
    const remoteKey = createGitReadCacheKey('remote', '/repo', 'head')
    const shortLivedKey = createGitReadCacheKey('local', '/repo', 'status')
    await Promise.all([
      cache.fetch(key, async () => 'config', {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: ['config'] }
      }),
      cache.fetch(headKey, async () => 'head', {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: ['head'] }
      }),
      cache.fetch(remoteKey, async () => 'remote head', {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: ['head'] }
      }),
      cache.fetch(shortLivedKey, async () => 'short-lived', {
        staleTime: Infinity,
        metadata: { gitReadInvalidation: 'short-lived' }
      })
    ])

    cache.invalidate(key)
    expect(cache.find(key)?.invalidated).toBe(true)
    expect(cache.find(headKey)?.invalidated).toBe(false)

    cache.invalidateWhere(
      (entry) =>
        entry.key[1] === 'local' &&
        Array.isArray(entry.metadata.gitReadInvalidation) &&
        entry.metadata.gitReadInvalidation.includes('head')
    )
    expect(cache.find(headKey)?.invalidated).toBe(true)
    expect(cache.find(remoteKey)?.invalidated).toBe(false)
    expect(cache.find(shortLivedKey)?.invalidated).toBe(false)

    cache.clear()
    expect(cache.find(key)).toBeUndefined()
    expect(cache.find(headKey)).toBeUndefined()
    expect(cache.find(shortLivedKey)).toBeUndefined()
  })

  it('retains entry metadata for invalidation predicates', async () => {
    const cache = new GitReadCache()
    const metadata = {
      gitReadInvalidation: ['working-tree'] as const,
      gitReadPaths: ['src/components']
    }
    await cache.fetch(key, async () => 'value', { staleTime: Infinity, metadata })

    const entry = cache.find(key) as GitReadCacheEntry<string>
    expect(entry).toMatchObject({
      key,
      data: 'value',
      promise: null,
      invalidated: false,
      metadata
    })
  })
})

describe('gitReadCachePathMatches', () => {
  it('matches changed paths against cached paths in both parent-child directions', () => {
    expect(gitReadCachePathMatches('/repo', ['src'], ['src/file.ts'])).toBe(true)
    expect(gitReadCachePathMatches('/repo', ['src/file.ts'], ['src'])).toBe(true)
    expect(gitReadCachePathMatches('/repo', ['src/file.ts'], ['docs/readme.md'])).toBe(false)
  })

  it('normalizes Windows separators and root-prefixed paths', () => {
    expect(gitReadCachePathMatches('C:\\repo', ['src\\file.ts'], ['C:\\repo\\src\\file.ts'])).toBe(
      true
    )
  })

  it('treats missing path metadata or changed paths as broadly invalidating', () => {
    expect(gitReadCachePathMatches('/repo', undefined, ['src/file.ts'])).toBe(true)
    expect(gitReadCachePathMatches('/repo', ['src/file.ts'], null)).toBe(true)
  })
})
