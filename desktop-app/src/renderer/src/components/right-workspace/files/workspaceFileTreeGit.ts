import type { GitStatus, GitStatusEntry } from '@pierre/trees'

import type { LocalGitReviewFile } from '../../../../../shared/localGitApi'

export function buildWorkspaceFileTreeGitStatus(
  files: readonly LocalGitReviewFile[],
  knownTreePaths: ReadonlySet<string>
): GitStatusEntry[] {
  const entries = new Map<string, GitStatus>()

  const addStatus = (path: string, status: GitStatus): void => {
    if (!knownTreePaths.has(path)) return
    const existing = entries.get(path)
    if (!existing || gitStatusPriority(status) > gitStatusPriority(existing))
      entries.set(path, status)
  }

  for (const file of files) {
    const status = gitStatusForFile(file)
    const treePath = file.changeKind === 'deleted' ? undefined : file.path
    if (treePath) addStatus(treePath, status)
    for (const parentPath of parentTreePaths(treePath ?? file.path)) addStatus(parentPath, status)
  }

  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, status]) => ({ path, status }))
}

function gitStatusForFile(file: LocalGitReviewFile): GitStatus {
  if (file.conflicted) return 'modified'
  switch (file.changeKind) {
    case 'added':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'added'
    case 'modified':
    case 'type-change':
    case 'unmerged':
    case 'unknown':
      return 'modified'
  }
}

function parentTreePaths(path: string): string[] {
  const parts = path.split('/')
  const parents: string[] = []
  for (let index = 1; index < parts.length; index += 1)
    parents.push(`${parts.slice(0, index).join('/')}/`)
  return parents
}

function gitStatusPriority(status: GitStatus): number {
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
    case 'ignored':
      return 0
  }
}
