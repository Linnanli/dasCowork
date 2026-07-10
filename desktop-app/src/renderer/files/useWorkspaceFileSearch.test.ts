// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  searchWorkspaceFiles,
  useWorkspaceFileSearch,
  type WorkspaceFileSearchState,
  type WorkspaceFileSearchManager,
  type WorkspaceFileSearchSessionRequest
} from './useWorkspaceFileSearch'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('searchWorkspaceFiles', () => {
  it('creates fuzzy file search session for target roots', async () => {
    const manager = createMockAppServerManager()

    await searchWorkspaceFiles({
      manager,
      query: 'app',
      projectSelection: { projectKind: 'path', path: '/repo/a' }
    })

    expect(manager.sessions[0]).toMatchObject({
      query: 'app',
      projectSelection: { projectKind: 'path', path: '/repo/a' }
    })
  })
})

describe('useWorkspaceFileSearch', () => {
  let container: HTMLDivElement
  let root: Root
  let searchState: WorkspaceFileSearchState | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    searchState = null
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps the latest search results when an earlier request finishes later', async () => {
    const firstSearch = deferred<WorkspaceFileSearchSessionResponse>()
    const secondSearch = deferred<WorkspaceFileSearchSessionResponse>()
    const manager = createSequencedManager([firstSearch.promise, secondSearch.promise])

    await renderProbe(manager)

    let firstRequest: Promise<WorkspaceFileSearchResult[]> | undefined
    let secondRequest: Promise<WorkspaceFileSearchResult[]> | undefined
    await act(async () => {
      firstRequest = searchState?.search('old')
      secondRequest = searchState?.search('new')
    })

    await act(async () => {
      secondSearch.resolve({ results: [{ path: '/repo/new.ts' }] })
      await secondRequest
    })
    expect(searchState?.results).toEqual([{ path: '/repo/new.ts' }])

    await act(async () => {
      firstSearch.resolve({ results: [{ path: '/repo/old.ts' }] })
      await firstRequest
    })
    expect(searchState?.results).toEqual([{ path: '/repo/new.ts' }])
  })

  it('clears results when file search becomes disabled', async () => {
    const manager = createSequencedManager([
      Promise.resolve({ results: [{ path: '/repo/app.ts' }] })
    ])

    await renderProbe(manager)
    await act(async () => {
      await searchState?.search('app')
    })
    expect(searchState?.results).toEqual([{ path: '/repo/app.ts' }])

    await act(async () => {
      root.render(createElement(Probe, { manager, enabled: false, onState: captureState }))
    })

    expect(searchState?.results).toEqual([])
    expect(searchState?.loading).toBe(false)
    expect(searchState?.error).toBeNull()
  })

  async function renderProbe(manager: WorkspaceFileSearchManager): Promise<void> {
    await act(async () => {
      root.render(createElement(Probe, { manager, enabled: true, onState: captureState }))
    })
  }

  function captureState(nextState: WorkspaceFileSearchState): void {
    searchState = nextState
  }
})

type WorkspaceFileSearchSessionResponse = Awaited<
  ReturnType<WorkspaceFileSearchManager['createFuzzyFileSearchSession']>
>

type WorkspaceFileSearchResult = WorkspaceFileSearchState['results'][number]

function Probe({
  manager,
  enabled,
  onState
}: {
  manager: WorkspaceFileSearchManager
  enabled: boolean
  onState: (state: WorkspaceFileSearchState) => void
}): null {
  const state = useWorkspaceFileSearch({ manager, enabled })

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}

function createSequencedManager(
  responses: Array<Promise<WorkspaceFileSearchSessionResponse>>
): WorkspaceFileSearchManager {
  return {
    createFuzzyFileSearchSession: vi.fn(() => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected file search request')
      return response
    })
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value)
  }
}

function createMockAppServerManager(): {
  sessions: Array<{ query: string }>
} & WorkspaceFileSearchManager {
  const sessions: Array<{ query: string }> = []

  return {
    sessions,
    createFuzzyFileSearchSession: vi.fn(async (session: WorkspaceFileSearchSessionRequest) => {
      sessions.push(session)
      return { results: [] }
    })
  }
}
