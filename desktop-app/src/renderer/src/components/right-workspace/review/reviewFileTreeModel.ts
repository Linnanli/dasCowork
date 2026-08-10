import type { GitStatusEntry } from '@pierre/trees'
import type { ReviewFileGroup, ReviewTreeStatus } from './reviewWorkspaceTypes'

export type ReviewFileTreeEntry = {
  kind: 'directory' | 'file'
  path: string
  name: string
  group?: ReviewFileGroup
}

export type ReviewFileTreeModel = {
  paths: readonly string[]
  entriesByTreePath: ReadonlyMap<string, ReviewFileTreeEntry>
  gitStatus: readonly GitStatusEntry[]
}

const naturalPathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildReviewFileTreeModel(groups: readonly ReviewFileGroup[]): ReviewFileTreeModel {
  const entries = new Map<string, ReviewFileTreeEntry>()
  const statuses = new Map<string, ReviewTreeStatus>()
  for (const group of groups) {
    if (group.path.startsWith('Unable to load ')) continue
    for (const directory of ancestors(group.path)) {
      entries.set(`${directory}/`, {
        kind: 'directory',
        path: directory,
        name: basename(directory)
      })
      const current = statuses.get(`${directory}/`)
      if (!current || statusPriority(group.treeStatus) > statusPriority(current)) statuses.set(`${directory}/`, group.treeStatus)
    }
    entries.set(group.path, {
      kind: 'file',
      path: group.path,
      name: basename(group.path),
      group
    })
    statuses.set(group.path, group.treeStatus)
  }

  const paths = [...entries.keys()].sort(compareTreePaths)
  return {
    paths,
    entriesByTreePath: entries,
    gitStatus: [...statuses].map(([path, status]) => ({ path, status })).filter((entry) => paths.includes(entry.path))
  }
}

export function filterReviewGroups(
  groups: readonly ReviewFileGroup[],
  query: string
): ReviewFileGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return [...groups]
  return groups.filter((group) => group.path.toLocaleLowerCase().includes(normalizedQuery))
}

function ancestors(path: string): string[] {
  const parts = path.split('/')
  const result: string[] = []
  for (let index = 1; index < parts.length; index += 1) result.push(parts.slice(0, index).join('/'))
  return result
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function compareTreePaths(left: string, right: string): number {
  const leftParts = splitTreePath(left)
  const rightParts = splitTreePath(right)
  const count = Math.min(leftParts.segments.length, rightParts.segments.length)
  for (let index = 0; index < count; index += 1) {
    const result = naturalPathCollator.compare(leftParts.segments[index]!, rightParts.segments[index]!)
    if (result !== 0) return result
  }
  if (leftParts.segments.length !== rightParts.segments.length) return leftParts.segments.length - rightParts.segments.length
  if (leftParts.isDirectory !== rightParts.isDirectory) return leftParts.isDirectory ? -1 : 1
  return naturalPathCollator.compare(left, right)
}

function splitTreePath(path: string): { isDirectory: boolean; segments: string[] } {
  const isDirectory = path.endsWith('/')
  return {
    isDirectory,
    segments: (isDirectory ? path.slice(0, -1) : path).split('/')
  }
}

function statusPriority(status: ReviewTreeStatus): number {
  switch (status) {
    case 'deleted':
      return 4
    case 'renamed':
      return 3
    case 'added':
      return 2
    case 'modified':
    case 'untracked':
      return 1
  }
}
