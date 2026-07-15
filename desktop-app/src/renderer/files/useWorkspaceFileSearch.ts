import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ProjectSelection,
  WorkspaceFileSearchResult
} from '../../shared/projects/projectTypes'

export type WorkspaceFileSearchSessionRequest = {
  query: string
  limit?: number
  projectSelection?: ProjectSelection
}

export type WorkspaceFileSearchSessionResponse =
  | WorkspaceFileSearchResult[]
  | {
      results?: WorkspaceFileSearchResult[]
    }

export type WorkspaceFileSearchManager = {
  createFuzzyFileSearchSession(
    request: WorkspaceFileSearchSessionRequest
  ): Promise<WorkspaceFileSearchSessionResponse>
}

export type SearchWorkspaceFilesInput = WorkspaceFileSearchSessionRequest & {
  manager: WorkspaceFileSearchManager
}

export type WorkspaceFileSearchState = {
  error: string | null
  loading: boolean
  results: WorkspaceFileSearchResult[]
  search(query: string): Promise<WorkspaceFileSearchResult[]>
}

type WorkspaceFileSearchSnapshot = {
  error: string | null
  loading: boolean
  results: WorkspaceFileSearchResult[]
  scope: symbol | null
}

export async function searchWorkspaceFiles({
  manager,
  query,
  limit,
  projectSelection
}: SearchWorkspaceFilesInput): Promise<WorkspaceFileSearchResult[]> {
  const response = await manager.createFuzzyFileSearchSession({
    query,
    ...(limit === undefined ? {} : { limit }),
    ...(projectSelection === undefined ? {} : { projectSelection })
  })

  return Array.isArray(response) ? response : (response.results ?? [])
}

export function useWorkspaceFileSearch({
  manager,
  enabled = true,
  limit,
  projectSelection
}: {
  manager: WorkspaceFileSearchManager | null
  enabled?: boolean
  limit?: number
  projectSelection?: ProjectSelection
}): WorkspaceFileSearchState {
  const projectSelectionKey = JSON.stringify(projectSelection ?? null)
  const scope = useMemo<symbol | null>(
    () =>
      manager && enabled ? Symbol(`workspace-file-search-scope:${projectSelectionKey}`) : null,
    [enabled, manager, projectSelectionKey]
  )
  const [snapshot, setSnapshot] = useState<WorkspaceFileSearchSnapshot>({
    error: null,
    loading: false,
    results: [],
    scope: null
  })
  const latestSearchId = useRef(0)

  useEffect(
    () => () => {
      latestSearchId.current += 1
    },
    []
  )

  const search = useCallback(
    async (query: string) => {
      const searchId = latestSearchId.current + 1
      latestSearchId.current = searchId

      if (!manager || !enabled || !scope) {
        setSnapshot({ error: null, loading: false, results: [], scope: null })
        return []
      }

      setSnapshot({ error: null, loading: true, results: [], scope })
      try {
        const nextResults = await searchWorkspaceFiles({
          manager,
          query,
          ...(limit === undefined ? {} : { limit }),
          ...(projectSelection === undefined ? {} : { projectSelection })
        })
        if (latestSearchId.current === searchId) {
          setSnapshot({ error: null, loading: false, results: nextResults, scope })
        }
        return nextResults
      } catch (searchError) {
        const message = searchError instanceof Error ? searchError.message : String(searchError)
        if (latestSearchId.current === searchId) {
          setSnapshot({ error: message, loading: false, results: [], scope })
        }
        return []
      }
    },
    [enabled, limit, manager, projectSelection, scope]
  )

  return useMemo(() => {
    const currentSnapshot = snapshot.scope === scope ? snapshot : null
    return {
      error: currentSnapshot?.error ?? null,
      loading: currentSnapshot?.loading ?? false,
      results: currentSnapshot?.results ?? [],
      search
    }
  }, [scope, search, snapshot])
}
