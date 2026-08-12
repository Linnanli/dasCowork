import type { AssistantRenderUnit } from './assistantRenderUnits'

type AnyRecord = Record<string, unknown>

export type ComposerPlanStepStatus = 'completed' | 'in-progress' | 'pending'

export type ComposerPlanStep = {
  label: string
  status: ComposerPlanStepStatus
}

export type ComposerPlanStatus = {
  steps: readonly ComposerPlanStep[]
  completedSteps: number
  totalSteps: number
  currentStep: number
  progressPercent: number
}

export type ComposerDiffStatus = {
  filesChanged: number
  additions: number
  deletions: number
}

export type TurnDiffFile = {
  path: string
  diff?: string
  added: number
  removed: number
}

export type ComposerTurnStatus = {
  plan?: ComposerPlanStatus
  diff?: ComposerDiffStatus
}

export function buildComposerTurnStatus(
  units: readonly AssistantRenderUnit[]
): ComposerTurnStatus | undefined {
  let latestPlanItem: AnyRecord | undefined
  let latestDiffItem: AnyRecord | undefined

  visitUnits(units, (unit) => {
    const itemType = composerStatusItemType(unit)
    if (itemType === 'todoList') latestPlanItem = unit.item ?? {}
    if (itemType === 'turnDiff') latestDiffItem = unit.item ?? {}
  })

  const plan = latestPlanItem ? buildComposerPlanStatus(latestPlanItem) : undefined
  const diff = latestDiffItem ? buildComposerDiffStatus(latestDiffItem) : undefined

  if (!plan && !diff) return undefined
  return { plan, diff }
}

export function isComposerStatusRenderUnit(unit: AssistantRenderUnit): boolean {
  const itemType = composerStatusItemType(unit)
  return itemType === 'todoList' || (itemType === 'turnDiff' && !isCompletedTurnDiff(unit))
}

export function withoutComposerStatusRenderUnits(
  units: readonly AssistantRenderUnit[],
  options: { keepTurnDiff?: boolean } = {}
): AssistantRenderUnit[] {
  const visibleUnits: AssistantRenderUnit[] = []

  for (const unit of units) {
    const itemType = composerStatusItemType(unit)
    if (isComposerStatusRenderUnit(unit) && !(options.keepTurnDiff && itemType === 'turnDiff')) {
      continue
    }

    if (unit.type !== 'reasoning-group') {
      visibleUnits.push(unit)
      continue
    }

    const children = withoutComposerStatusRenderUnits(unit.children, options)
    if (unit.children.length > 0 && children.length === 0) continue
    const childrenChanged =
      children.length !== unit.children.length ||
      children.some((child, index) => child !== unit.children[index])
    visibleUnits.push(childrenChanged ? { ...unit, children } : unit)
  }

  return visibleUnits
}

export function buildComposerPlanStatus(item: AnyRecord): ComposerPlanStatus | undefined {
  const steps = normalizeTodoItems(item)
  if (steps.length === 0) return undefined

  const completedSteps = steps.filter((step) => step.status === 'completed').length
  const currentIndex = currentPlanStepIndex(steps)

  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    currentStep: currentIndex + 1,
    progressPercent: (completedSteps / steps.length) * 100
  }
}

export function buildComposerDiffStatus(item: AnyRecord): ComposerDiffStatus | undefined {
  const files = parseTurnDiffFiles(item)
  const parsed = turnDiffLineTotals(files)

  const additions = nonNegativeNumber(item.added ?? item.additions) ?? parsed.additions
  const deletions = nonNegativeNumber(item.removed ?? item.deletions) ?? parsed.deletions
  let inferredFilesChanged = files.length
  if (inferredFilesChanged === 0 && additions + deletions > 0) inferredFilesChanged = 1
  const filesChanged =
    nonNegativeNumber(item.filesChanged ?? item.fileCount) ?? inferredFilesChanged

  if (filesChanged === 0 && additions === 0 && deletions === 0) return undefined

  return { filesChanged, additions, deletions }
}

export function normalizeTodoItems(item: AnyRecord): ComposerPlanStep[] {
  return arrayValue(item.items ?? item.tasks ?? item.todos).map((rawStep, index) => {
    const step = recordValue(rawStep)
    return {
      label:
        stringValue(step?.label) ??
        stringValue(step?.text) ??
        stringValue(step?.title) ??
        stringValue(step?.content) ??
        `任务 ${index + 1}`,
      status: normalizePlanStepStatus(step?.status)
    }
  })
}

export function parseTurnDiffFiles(item: AnyRecord): TurnDiffFile[] {
  const explicitFiles = arrayValue(item.files ?? item.changes)
  if (explicitFiles.length === 0) {
    const unifiedDiff = stringValue(item.diff) ?? stringValue(item.unifiedDiff)
    return unifiedDiff?.trim() ? parseUnifiedDiffFiles(unifiedDiff, stringValue(item.path)) : []
  }

  return explicitFiles
    .map((file, index) => {
      const record = recordValue(file)
      const diff = stringValue(record?.diff) ?? stringValue(record?.patch)
      const lineCounts = countTurnDiffLines(diff)
      return {
        path:
          stringValue(record?.path) ??
          stringValue(record?.file) ??
          stringValue(record?.filename) ??
          `文件 ${index + 1}`,
        diff,
        added: nonNegativeNumber(record?.added ?? record?.additions) ?? lineCounts.added,
        removed: nonNegativeNumber(record?.removed ?? record?.deletions) ?? lineCounts.removed
      }
    })
    .sort(compareTurnDiffFiles)
}

export function turnDiffLineTotals(files: readonly TurnDiffFile[]): {
  additions: number
  deletions: number
} {
  return {
    additions: files.reduce((total, file) => total + file.added, 0),
    deletions: files.reduce((total, file) => total + file.removed, 0)
  }
}

export function countTurnDiffLines(diff: string | undefined): {
  added: number
  removed: number
} {
  if (!diff) return { added: 0, removed: 0 }

  let added = 0
  let removed = 0
  const lines = diff.split('\n')
  const hasHunkHeader = lines.some((line) => line.startsWith('@@'))
  let insideHunk = !hasHunkHeader

  for (const line of lines) {
    if (line.startsWith('@@')) {
      insideHunk = true
      continue
    }
    if (!insideHunk) continue
    if (!hasHunkHeader && (line.startsWith('+++ ') || line.startsWith('--- '))) continue
    if (line.startsWith('+')) added += 1
    if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function visitUnits(
  units: readonly AssistantRenderUnit[],
  visit: (unit: Extract<AssistantRenderUnit, { type: 'entry' }>) => void
): void {
  for (const unit of units) {
    if (unit.type === 'entry') visit(unit)
    if (unit.type === 'reasoning-group') visitUnits(unit.children, visit)
  }
}

function composerStatusItemType(unit: AssistantRenderUnit): 'todoList' | 'turnDiff' | undefined {
  if (unit.type !== 'entry') return undefined
  const itemType = unit.itemType ?? stringValue(unit.item?.type)
  if (itemType === 'todoList' || itemType === 'todo-list') return 'todoList'
  if (itemType === 'turnDiff' || itemType === 'turn-diff') return 'turnDiff'
  return undefined
}

function isCompletedTurnDiff(unit: AssistantRenderUnit): boolean {
  if (unit.type !== 'entry') return false
  return stringValue(unit.item?.status) === 'completed'
}

function normalizePlanStepStatus(status: unknown): ComposerPlanStepStatus {
  const value = stringValue(status) ?? stringValue(recordValue(status)?.type)
  const normalized = value?.toLowerCase().replaceAll(/[_\s-]/g, '')

  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
    return 'completed'
  }
  if (normalized === 'inprogress' || normalized === 'running' || normalized === 'active') {
    return 'in-progress'
  }
  return 'pending'
}

function currentPlanStepIndex(steps: readonly ComposerPlanStep[]): number {
  const inProgressIndex = steps.findIndex((step) => step.status === 'in-progress')
  if (inProgressIndex >= 0) return inProgressIndex

  const pendingIndex = steps.findIndex((step) => step.status === 'pending')
  if (pendingIndex >= 0) return pendingIndex

  return steps.length - 1
}

function parseUnifiedDiffFiles(diff: string, fallbackPath: string | undefined): TurnDiffFile[] {
  const files = new Map<string, TurnDiffFile>()
  let current: { path?: string; lines: string[] } | undefined
  let sectionIndex = 0

  const flush = (): void => {
    if (!current) return
    const fileDiff = current.lines.join('\n')
    const lineCounts = countTurnDiffLines(fileDiff)
    const path = current.path ?? fallbackPath ?? `diff-${sectionIndex + 1}`
    sectionIndex += 1
    const existing = files.get(path)
    if (existing) {
      existing.diff = existing.diff ? `${existing.diff}\n${fileDiff}` : fileDiff
      existing.added += lineCounts.added
      existing.removed += lineCounts.removed
      return
    }
    files.set(path, {
      path,
      diff: fileDiff,
      added: lineCounts.added,
      removed: lineCounts.removed
    })
  }

  for (const line of diff.split('\n')) {
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (gitMatch) {
      flush()
      current = { path: gitMatch[2], lines: [line] }
      continue
    }

    if (!current) current = { path: fallbackPath, lines: [] }
    const newPathMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (newPathMatch && newPathMatch[1] !== '/dev/null') current.path = newPathMatch[1]
    current.lines.push(line)
  }

  flush()
  return [...files.values()].sort(compareTurnDiffFiles)
}

function compareTurnDiffFiles(left: TurnDiffFile, right: TurnDiffFile): number {
  if (left.path === right.path) return 0
  return left.path < right.path ? -1 : 1
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): AnyRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as AnyRecord) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
