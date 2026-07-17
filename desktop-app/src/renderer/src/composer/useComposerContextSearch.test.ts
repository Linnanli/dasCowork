// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComposerContextSearchSectionEvent } from '../../../shared/codexIpcApi'
import { useComposerContextSearch } from './useComposerContextSearch'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = undefined
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useComposerContextSearch', () => {
  it('debounces updates, ignores stale events, exposes partial files, and stops on close', async () => {
    vi.useFakeTimers()
    let notify: ((event: ComposerContextSearchSectionEvent) => void) | undefined
    const startSearch = vi.fn(async () => ({
      version: 1 as const,
      sessionId: 'session-1',
      hostId: 'local',
      filesAvailable: true,
      tasksAvailable: true
    }))
    const updateSearch = vi.fn(async () => undefined)
    const stopSearch = vi.fn(async () => undefined)
    vi.stubGlobal('desktopApp', {
      composerContext: {
        startSearch,
        updateSearch,
        stopSearch,
        onSearchUpdate: vi.fn((callback) => {
          notify = callback
          return vi.fn()
        })
      }
    })

    let state: ReturnType<typeof useComposerContextSearch> | undefined
    let options = {
      cwd: '/repo',
      enabled: true,
      excludedThreadIds: [] as string[],
      projectSelection: { projectKind: 'path' as const, path: '/repo' },
      query: 'first'
    }
    function Harness(): null {
      state = useComposerContextSearch(options)
      return null
    }

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(createElement(Harness)))
    expect(startSearch).toHaveBeenCalledOnce()

    options = { ...options, excludedThreadIds: ['thread-a'], query: 'second' }
    await act(async () => root?.render(createElement(Harness)))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(updateSearch).toHaveBeenCalledTimes(1)
    expect(updateSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        query: 'second',
        excludedThreadIds: ['thread-a']
      })
    )

    act(() => {
      notify?.({
        version: 1,
        sessionId: 'session-1',
        query: 'first',
        sectionId: 'files',
        status: 'ready',
        complete: false,
        items: [
          {
            version: 1,
            kind: 'file',
            canonicalId: 'file:/repo/first.ts',
            label: 'first.ts',
            presentation: 'mention',
            path: '/repo/first.ts',
            root: '/repo'
          }
        ]
      })
    })
    expect(state?.sections.find(({ id }) => id === 'files')?.items).toEqual([])

    act(() => {
      notify?.({
        version: 1,
        sessionId: 'session-1',
        query: 'second',
        sectionId: 'files',
        status: 'ready',
        complete: false,
        items: [
          {
            version: 1,
            kind: 'file',
            canonicalId: 'file:/repo/second.ts',
            label: 'second.ts',
            presentation: 'mention',
            path: '/repo/second.ts',
            root: '/repo'
          }
        ]
      })
    })
    expect(state?.sections.find(({ id }) => id === 'files')).toMatchObject({
      loading: true,
      complete: false,
      items: [expect.objectContaining({ label: 'second.ts' })]
    })

    options = { ...options, excludedThreadIds: [] }
    await act(async () => root?.render(createElement(Harness)))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(updateSearch).toHaveBeenLastCalledWith({
      version: 1,
      sessionId: 'session-1',
      query: 'second',
      excludedThreadIds: []
    })

    options = { ...options, enabled: false }
    await act(async () => root?.render(createElement(Harness)))
    expect(stopSearch).toHaveBeenCalledWith({ version: 1, sessionId: 'session-1' })
  })

  it('stops the old session when the search scope changes', async () => {
    const stopSearch = vi.fn(async () => undefined)
    const startSearch = vi
      .fn()
      .mockResolvedValueOnce({
        version: 1,
        sessionId: 'session-1',
        hostId: 'local',
        filesAvailable: true,
        tasksAvailable: true
      })
      .mockResolvedValueOnce({
        version: 1,
        sessionId: 'session-2',
        hostId: 'local',
        filesAvailable: true,
        tasksAvailable: true
      })
    vi.stubGlobal('desktopApp', {
      composerContext: {
        startSearch,
        updateSearch: vi.fn(async () => undefined),
        stopSearch,
        onSearchUpdate: vi.fn(() => vi.fn())
      }
    })

    let cwd = '/repo'
    function Harness(): null {
      useComposerContextSearch({
        cwd,
        enabled: true,
        excludedThreadIds: [],
        projectSelection: { projectKind: 'path', path: cwd },
        query: ''
      })
      return null
    }

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(createElement(Harness)))
    cwd = '/other'
    await act(async () => root?.render(createElement(Harness)))

    expect(stopSearch).toHaveBeenCalledWith({ version: 1, sessionId: 'session-1' })
    expect(startSearch).toHaveBeenCalledTimes(2)
  })
})
