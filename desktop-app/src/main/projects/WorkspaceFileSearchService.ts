import { opendir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import type { WorkspaceFileSearchResult } from '../../shared/projects/projectTypes'
import type { ProjectStore } from './ProjectStore'
import type { ProjectService } from './ProjectService'

type ProjectServiceLike = Pick<ProjectService, 'resolveNewThreadTarget'>
type ProjectStoreLike = Pick<ProjectStore, 'getState'>

export type WorkspaceFileSearchServiceOptions = {
  projectStore: ProjectStoreLike
  projectService: ProjectServiceLike
}

export type WorkspaceFileSearchRequest = {
  query?: string
  limit?: number
}

const ignoredDirectoryNames = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo'
])

export class WorkspaceFileSearchService {
  constructor(private readonly options: WorkspaceFileSearchServiceOptions) {}

  async createFuzzyFileSearchSession({
    query = '',
    limit = 40
  }: WorkspaceFileSearchRequest): Promise<{ results: WorkspaceFileSearchResult[] }> {
    const state = await this.options.projectStore.getState()
    const selection = state.activeProjectSelection
    if (!selection || selection.projectKind === 'projectless') return { results: [] }

    const target = await this.options.projectService.resolveNewThreadTarget({
      selection,
      prompt: ''
    })
    if (target.hostId !== 'local' || target.workspaceRoots.length === 0) return { results: [] }

    const results = await searchLocalWorkspaceFiles({
      roots: target.workspaceRoots,
      query,
      limit
    })

    return { results }
  }
}

async function searchLocalWorkspaceFiles({
  roots,
  query,
  limit
}: {
  roots: string[]
  query: string
  limit: number
}): Promise<WorkspaceFileSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase()
  const results: WorkspaceFileSearchResult[] = []
  const seenPaths = new Set<string>()

  for (const root of roots) {
    for await (const filePath of walkFiles(root)) {
      if (seenPaths.has(filePath)) continue
      seenPaths.add(filePath)

      const relativePath = relative(root, filePath)
      const score = scoreFile(relativePath, normalizedQuery)
      if (score === null) continue

      results.push({
        path: filePath,
        label: relativePath || basename(filePath),
        root,
        score
      })
    }
  }

  return results.sort(compareSearchResults).slice(0, limit)
}

async function* walkFiles(root: string, depth = 0): AsyncGenerator<string> {
  if (depth > 5) return

  let directory
  try {
    directory = await opendir(root)
  } catch {
    return
  }

  for await (const entry of directory) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue

    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath, depth + 1)
      continue
    }
    if (entry.isFile()) yield entryPath
  }
}

function scoreFile(path: string, query: string): number | null {
  const normalizedPath = path.toLowerCase()
  if (!query) return path.includes('/') ? 10 : 0
  if (normalizedPath === query) return 0
  if (basename(normalizedPath) === query) return 1
  if (normalizedPath.includes(query)) return normalizedPath.indexOf(query) + 2

  let queryIndex = 0
  let score = 100
  for (
    let pathIndex = 0;
    pathIndex < normalizedPath.length && queryIndex < query.length;
    pathIndex++
  ) {
    if (normalizedPath[pathIndex] === query[queryIndex]) {
      score += pathIndex
      queryIndex += 1
    }
  }

  return queryIndex === query.length ? score : null
}

function compareSearchResults(
  left: WorkspaceFileSearchResult,
  right: WorkspaceFileSearchResult
): number {
  const scoreDelta = (left.score ?? 0) - (right.score ?? 0)
  if (scoreDelta !== 0) return scoreDelta
  return (left.label ?? left.path).localeCompare(right.label ?? right.path)
}
