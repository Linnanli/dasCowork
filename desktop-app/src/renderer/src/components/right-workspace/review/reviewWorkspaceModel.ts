import type {
  LocalGitMutationResult,
  LocalGitReviewFile,
  LocalGitReviewFileTarget,
  LocalGitReviewSource,
  LocalGitReviewSnapshot
} from '../../../../../shared/localGitApi'
import type { LocalGitReviewLastTurn } from '../../local-git-review/LocalGitReviewProvider'
import type {
  ReviewBackendSource,
  ReviewDisplaySource,
  ReviewFileGroup,
  ReviewFileSection,
  ReviewPartialSourceError,
  ReviewTreeStatus
} from './reviewWorkspaceTypes'

const naturalPathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function createLastTurnGroups(
  source: Extract<LocalGitReviewSource, { type: 'last-turn' }>,
  lastTurn?: LocalGitReviewLastTurn
): ReviewFileGroup[] {
  return (lastTurn?.files ?? []).map((file) => {
    const reviewFile: LocalGitReviewFile = {
      path: file.path,
      changeKind: 'modified',
      revision: `${lastTurn?.turnId ?? source.turnId}:${file.path}:${hashText(file.diff ?? '')}`,
      additions: file.additions,
      deletions: file.deletions,
      binary: false,
      conflicted: false
    }
    const section: ReviewFileSection = {
      kind: 'turn',
      backendSource: source,
      file: reviewFile,
      key: sectionKey(source, `turn:${source.turnId}`, reviewFile),
      diff: file.diff,
      loadState: file.diff
        ? { status: 'ready', diff: { diff: file.diff, binary: false, conflicted: false, truncated: false } }
        : { status: 'idle' }
    }
    return {
      path: file.path,
      sections: [section],
      additions: file.additions,
      deletions: file.deletions,
      treeStatus: 'modified'
    }
  })
}

export function createSnapshotGroups(
  snapshots: readonly LocalGitReviewSnapshot[],
  partialErrors: readonly ReviewPartialSourceError[] = []
): ReviewFileGroup[] {
  const groupsByPath = new Map<string, ReviewFileGroup>()
  for (const snapshot of snapshots) {
    const source = snapshot.source
    if (source.type === 'last-turn') continue
    for (const file of snapshot.files) {
      const current = groupsByPath.get(file.path)
      const section: ReviewFileSection = {
        kind: 'snapshot',
        backendSource: source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file,
        key: sectionKey(source, snapshot.snapshotGeneration, file),
        loadState: { status: 'idle' }
      }
      if (current) {
        current.sections.push(section)
        current.additions += file.additions
        current.deletions += file.deletions
        current.treeStatus = strongerTreeStatus(current.treeStatus, treeStatusForFile(file))
        if (!current.previousPath && file.previousPath) current.previousPath = file.previousPath
      } else {
        groupsByPath.set(file.path, {
          path: file.path,
          previousPath: file.previousPath,
          sections: [section],
          additions: file.additions,
          deletions: file.deletions,
          treeStatus: treeStatusForFile(file)
        })
      }
    }
  }
  for (const partialError of partialErrors) {
    const placeholderPath = sourceIdentity(partialError.source)
    groupsByPath.set(`__partial_error__/${placeholderPath}`, {
      path: `Unable to load ${sourceLabel(partialError.source)}`,
      sections: [
        {
          kind: 'partial-error',
          backendSource: partialError.source,
          key: `partial:${sourceIdentity(partialError.source)}`,
          message: partialError.message,
          loadState: { status: 'error', message: partialError.message }
        }
      ],
      additions: 0,
      deletions: 0,
      treeStatus: 'modified'
    })
  }
  return [...groupsByPath.values()].sort((left, right) => naturalPathCollator.compare(left.path, right.path))
}

export function displaySourceIdentity(source: ReviewDisplaySource): string {
  if (source.type === 'uncommitted') return 'uncommitted'
  return sourceIdentity(source)
}

export function sourceIdentity(source: LocalGitReviewSource): string {
  switch (source.type) {
    case 'unstaged':
    case 'staged':
      return source.type
    case 'commit':
      return `commit:${source.commitSha}`
    case 'branch':
      return `branch:${source.baseBranch}`
    case 'last-turn':
      return `last-turn:${source.turnId}`
  }
}

export function sourceLabel(source: ReviewDisplaySource | LocalGitReviewSource): string {
  switch (source.type) {
    case 'uncommitted':
      return '未提交'
    case 'unstaged':
      return '未暂存'
    case 'staged':
      return '已暂存'
    case 'commit':
      return `已提交 ${source.commitSha.slice(0, 7)}`
    case 'branch':
      return `分支 ${source.baseBranch}`
    case 'last-turn':
      return '上一轮'
  }
}

export function backendSourcesForDisplay(source: ReviewDisplaySource): ReviewBackendSource[] {
  if (source.type === 'uncommitted') return [{ type: 'unstaged' }, { type: 'staged' }]
  if (source.type === 'last-turn') return []
  return [source]
}

export function sameReviewSource(left: LocalGitReviewSource, right: LocalGitReviewSource): boolean {
  return sourceIdentity(left) === sourceIdentity(right)
}

export function sectionActionForSource(source: ReviewBackendSource): 'stage' | 'unstage' | undefined {
  if (source.type === 'unstaged') return 'stage'
  if (source.type === 'staged') return 'unstage'
  return undefined
}

export function fileTarget(file: LocalGitReviewFile): LocalGitReviewFileTarget {
  return {
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    revision: file.revision
  }
}

export function mutationFeedback(
  action: 'stage' | 'unstage' | 'revert',
  result?: LocalGitMutationResult
): { tone: 'success' | 'info' | 'error'; message: string } {
  if (result?.status === 'error') return { tone: 'error', message: 'Git operation failed.' }
  if (result?.status === 'partial-success') {
    const applied = result.appliedPaths.length > 0 ? `已应用：${result.appliedPaths.join('、')}` : undefined
    const conflicts = result.conflictedPaths.length > 0 ? `冲突：${result.conflictedPaths.join('、')}` : undefined
    const skipped = result.skippedPaths.length > 0 ? `跳过：${result.skippedPaths.join('、')}` : undefined
    return {
      tone: 'info',
      message: [applied, conflicts, skipped].filter((value): value is string => Boolean(value)).join('；') || 'Git 操作部分完成。'
    }
  }
  return {
    tone: 'success',
    message:
      action === 'stage'
        ? 'Changes staged.'
        : action === 'unstage'
          ? 'Changes unstaged.'
          : 'Changes reverted.'
  }
}

export function groupKey(group: Pick<ReviewFileGroup, 'path'>): string {
  return group.path
}

export function sectionLabel(section: ReviewFileSection): string {
  if (section.kind === 'partial-error') return sourceLabel(section.backendSource)
  return sourceLabel(section.backendSource)
}

function sectionKey(
  source: LocalGitReviewSource,
  snapshotGeneration: string,
  file: Pick<LocalGitReviewFile, 'path' | 'previousPath' | 'revision'>
): string {
  return `${sourceIdentity(source)}:${snapshotGeneration}:${file.previousPath ?? ''}:${file.path}:${file.revision}`
}

function treeStatusForFile(file: LocalGitReviewFile): ReviewTreeStatus {
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

function strongerTreeStatus(left: ReviewTreeStatus, right: ReviewTreeStatus): ReviewTreeStatus {
  return treeStatusPriority(right) > treeStatusPriority(left) ? right : left
}

function treeStatusPriority(status: ReviewTreeStatus): number {
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

function hashText(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1)
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0
  return Math.abs(hash).toString(36)
}
