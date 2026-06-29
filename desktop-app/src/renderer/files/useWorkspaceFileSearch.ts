import { useCallback, useMemo, useState } from 'react'

import type { WorkspaceFileSearchResult } from '../../shared/projects/projectTypes'

export type WorkspaceFileSearchSessionRequest = {
  query: string
  limit?: number
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

export async function searchWorkspaceFiles({
  manager,
  query,
  limit
}: SearchWorkspaceFilesInput): Promise<WorkspaceFileSearchResult[]> {
  const response = await manager.createFuzzyFileSearchSession({
    query,
    ...(limit === undefined ? {} : { limit })
  })

  return Array.isArray(response) ? response : (response.results ?? [])
}

export function useWorkspaceFileSearch({
  manager,
  enabled = true,
  limit
}: {
  manager: WorkspaceFileSearchManager | null
  enabled?: boolean
  limit?: number
}): WorkspaceFileSearchState {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<WorkspaceFileSearchResult[]>([])

  const search = useCallback(
    async (query: string) => {
      if (!manager || !enabled) {
        setResults([])
        return []
      }

      setLoading(true)
      setError(null)
      try {
        const nextResults = await searchWorkspaceFiles({
          manager,
          query,
          ...(limit === undefined ? {} : { limit })
        })
        setResults(nextResults)
        return nextResults
      } catch (searchError) {
        const message = searchError instanceof Error ? searchError.message : String(searchError)
        setError(message)
        setResults([])
        return []
      } finally {
        setLoading(false)
      }
    },
    [enabled, limit, manager]
  )

  return useMemo(
    () => ({
      error,
      loading,
      results,
      search
    }),
    [error, loading, results, search]
  )
}
