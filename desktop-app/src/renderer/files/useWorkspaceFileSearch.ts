import { useCallback, useMemo, useState } from 'react'

export type WorkspaceFileSearchTarget = {
  hostId: string
  roots: string[]
}

export type WorkspaceFileSearchResult = {
  path: string
  label?: string
  root?: string
  score?: number
}

export type WorkspaceFileSearchSessionRequest = WorkspaceFileSearchTarget & {
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
  hostId,
  roots,
  query,
  limit
}: SearchWorkspaceFilesInput): Promise<WorkspaceFileSearchResult[]> {
  const response = await manager.createFuzzyFileSearchSession({
    hostId,
    roots,
    query,
    ...(limit === undefined ? {} : { limit })
  })

  return Array.isArray(response) ? response : (response.results ?? [])
}

export function useWorkspaceFileSearch({
  manager,
  target
}: {
  manager: WorkspaceFileSearchManager | null
  target: WorkspaceFileSearchTarget | null
}): WorkspaceFileSearchState {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<WorkspaceFileSearchResult[]>([])

  const search = useCallback(
    async (query: string) => {
      if (!manager || !target || query.trim().length === 0) {
        setResults([])
        return []
      }

      setLoading(true)
      setError(null)
      try {
        const nextResults = await searchWorkspaceFiles({
          manager,
          hostId: target.hostId,
          roots: target.roots,
          query
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
    [manager, target]
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
