import type { ReviewDisplaySource, ReviewWorkspacePreferences } from './reviewWorkspaceTypes'
import { displaySourceIdentity } from './reviewWorkspaceModel'

const STORAGE_VERSION = 1
const DEFAULT_TREE_WIDTH = 320
const MAX_COLLAPSED_KEYS = 500
const MAX_VIEWED_FILES = 500

type ReviewViewedFile = {
  key: string
  revisions: string[]
  updatedAt: number
}

export function defaultReviewPreferences(source: ReviewDisplaySource): ReviewWorkspacePreferences {
  return {
    source,
    diffMode: 'unified',
    lineDiffType: 'word',
    wrap: false,
    ignoreWhitespace: false,
    fullFiles: false,
    richPreview: false,
    skipRevertConfirmation: false,
    treeVisible: true,
    treeWidth: DEFAULT_TREE_WIDTH,
    treeFilter: '',
    collapsedKeys: []
  }
}

export function reviewWorkspacePreferencesKey(input: {
  hostId?: string
  repository?: string
  workspaceId?: string
}): string {
  return [
    'desktopCodex.reviewWorkspace',
    STORAGE_VERSION,
    input.hostId ?? 'unknown-host',
    input.repository ?? 'unknown-repository',
    input.workspaceId ?? 'review'
  ].join(':')
}

export function loadReviewPreferences(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  fallbackSource: ReviewDisplaySource
): ReviewWorkspacePreferences {
  const fallback = defaultReviewPreferences(fallbackSource)
  if (!storage) return fallback
  try {
    const parsed = JSON.parse(
      storage.getItem(key) ?? 'null'
    ) as Partial<ReviewWorkspacePreferences> | null
    if (!parsed) return fallback
    return normalizePreferences(parsed, fallback)
  } catch {
    return fallback
  }
}

export function persistReviewPreferences(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  preferences: ReviewWorkspacePreferences
): void {
  if (!storage) return
  storage.setItem(key, JSON.stringify(normalizePreferences(preferences, preferences)))
}

export function normalizePreferences(
  value: Partial<ReviewWorkspacePreferences>,
  fallback: ReviewWorkspacePreferences
): ReviewWorkspacePreferences {
  return {
    source: normalizeSource(value.source) ?? fallback.source,
    diffMode: value.diffMode === 'split' ? 'split' : 'unified',
    lineDiffType:
      value.lineDiffType === 'char' || value.lineDiffType === 'none' ? value.lineDiffType : 'word',
    wrap: Boolean(value.wrap),
    ignoreWhitespace: Boolean(value.ignoreWhitespace),
    fullFiles: Boolean(value.fullFiles),
    richPreview: Boolean(value.richPreview),
    skipRevertConfirmation: Boolean(value.skipRevertConfirmation),
    treeVisible: value.treeVisible ?? fallback.treeVisible,
    treeWidth: clampReviewTreeWidth(value.treeWidth ?? fallback.treeWidth),
    treeFilter: typeof value.treeFilter === 'string' ? value.treeFilter.slice(0, 256) : '',
    collapsedKeys: Array.isArray(value.collapsedKeys)
      ? value.collapsedKeys
          .filter((key): key is string => typeof key === 'string')
          .slice(0, MAX_COLLAPSED_KEYS)
      : []
  }
}

export function clampReviewTreeWidth(width: number, containerWidth = window.innerWidth): number {
  if (!Number.isFinite(width)) return DEFAULT_TREE_WIDTH
  const max = Math.max(200, Math.floor(containerWidth * 0.6))
  return Math.min(max, Math.max(200, Math.round(width)))
}

export function shouldUseUncommittedDefault(source: ReviewDisplaySource): boolean {
  return source.type === 'unstaged' || source.type === 'staged'
}

export function sourceChanged(left: ReviewDisplaySource, right: ReviewDisplaySource): boolean {
  return displaySourceIdentity(left) !== displaySourceIdentity(right)
}

export function loadViewedFiles(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string
): ReviewViewedFile[] {
  if (!storage) return []
  try {
    const value = JSON.parse(storage.getItem(`${key}:viewed-v1`) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (entry): entry is ReviewViewedFile =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as ReviewViewedFile).key === 'string' &&
          Array.isArray((entry as ReviewViewedFile).revisions) &&
          typeof (entry as ReviewViewedFile).updatedAt === 'number'
      )
      .slice(-MAX_VIEWED_FILES)
  } catch {
    return []
  }
}

export function persistViewedFiles(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  files: readonly ReviewViewedFile[]
): void {
  storage?.setItem(`${key}:viewed-v1`, JSON.stringify(files.slice(-MAX_VIEWED_FILES)))
}

export function reviewViewedFileKey(sourceIdentity: string, path: string): string {
  return `${sourceIdentity}:${path}`
}

export function reviewGroupRevisions(group: {
  sections: readonly { kind: string; file?: { revision: string } }[]
}): string[] {
  return group.sections
    .flatMap((section) => (section.file ? [section.file.revision] : []))
    .sort((left, right) => left.localeCompare(right))
}

function normalizeSource(value: unknown): ReviewDisplaySource | undefined {
  if (!value || typeof value !== 'object' || !('type' in value)) return undefined
  const source = value as ReviewDisplaySource
  switch (source.type) {
    case 'uncommitted':
    case 'unstaged':
    case 'staged':
      return { type: source.type }
    case 'commit':
      return typeof source.commitSha === 'string'
        ? { type: 'commit', commitSha: source.commitSha }
        : undefined
    case 'branch':
      return typeof source.baseBranch === 'string'
        ? { type: 'branch', baseBranch: source.baseBranch }
        : undefined
    case 'last-turn':
      return typeof source.turnId === 'string'
        ? { type: 'last-turn', turnId: source.turnId }
        : undefined
  }
}
