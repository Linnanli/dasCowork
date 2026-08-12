import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  MinusIcon,
  PlusIcon,
  Undo2Icon
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useOptionalRightWorkspace } from '@/components/right-workspace'
import { groupKey, sectionActionForSource, sectionLabel, sourceLabel } from './reviewWorkspaceModel'
import { ReviewFileDiff } from './ReviewFileDiff'
import { ReviewDiffLoadingSkeleton } from './ReviewDiffLoadingSkeleton'
import { ReviewFileTypeIcon } from './ReviewFileTypeIcon'
import { ReviewRichPreview } from './ReviewRichPreview'
import type {
  ReviewFileGroup,
  ReviewFileSection,
  ReviewWorkspaceController
} from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  group: ReviewFileGroup
}

export function ReviewFileBlock({ controller, group }: Props): React.JSX.Element {
  const key = groupKey(group)
  const collapsed = controller.preferences.collapsedKeys.includes(key)
  const workspace = useOptionalRightWorkspace()
  const [pendingRevert, setPendingRevert] = useState<
    { section: Extract<ReviewFileSection, { kind: 'snapshot' }>; hunkIndex?: number } | undefined
  >(undefined)
  const requestRevert = (
    section: Extract<ReviewFileSection, { kind: 'snapshot' }>,
    hunkIndex?: number
  ): void => {
    if (controller.preferences.skipRevertConfirmation) {
      if (hunkIndex === undefined) controller.applyFileAction(group, section, 'revert')
      else controller.applyHunkAction(group, section, 'revert', hunkIndex)
    } else {
      setPendingRevert({ section, hunkIndex })
    }
  }

  return (
    <section
      data-review-path={group.path}
      className={controller.selectedPath === group.path ? 'ring-1 ring-ring/35' : undefined}
    >
      <div
        data-review-file-header
        className="group/diff-header flex min-h-10 items-center gap-2 border-b bg-muted/25 px-2 hover:bg-muted/40"
      >
        <ReviewFileTypeIcon path={group.path} />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="min-w-0">
            <div
              data-review-file-name
              className="truncate text-xs font-medium [direction:rtl]"
              title={group.path}
            >
              <span className="[direction:ltr] [unicode-bidi:plaintext]">{group.path}</span>
            </div>
            {group.previousPath ? (
              <div
                className="truncate text-[11px] text-muted-foreground [direction:rtl]"
                title={group.previousPath}
              >
                来自 {group.previousPath}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-xs tabular-nums">
            <span className="text-emerald-600">+{group.additions}</span>{' '}
            <span className="text-destructive">-{group.deletions}</span>
          </div>
          <div
            data-review-file-header-actions
            className="flex shrink-0 items-center opacity-0 transition-opacity duration-200 group-hover/diff-header:opacity-100 group-has-[:focus-visible]/diff-header:opacity-100"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="复制文件路径"
              title="复制文件路径"
              onClick={() => void navigator.clipboard.writeText(group.path).catch(() => undefined)}
            >
              <CopyIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={collapsed ? '展开文件差异' : '收起文件差异'}
              title={collapsed ? '展开文件差异' : '收起文件差异'}
              aria-expanded={!collapsed}
              onClick={() => controller.setCollapsed(key, !collapsed)}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="在工作区中打开文件"
              title="在工作区中打开文件"
              disabled={!workspace}
              onClick={() => workspace?.openFile(group.path, basename(group.path))}
            >
              <ExternalLinkIcon />
            </Button>
          </div>
        </div>
        <div
          data-review-file-header-operation-actions
          role="toolbar"
          aria-label="文件操作"
          className="ml-auto flex shrink-0 items-center gap-1"
        >
          {group.sections.map((section) => (
            <ReviewSectionFileActions
              key={section.key}
              controller={controller}
              group={group}
              section={section}
              onRequestRevert={requestRevert}
            />
          ))}
        </div>
      </div>
      {collapsed ? null : (
        <div className="space-y-3">
          {group.sections.map((section) => (
            <ReviewSection
              key={section.key}
              controller={controller}
              group={group}
              section={section}
              onRequestRevert={requestRevert}
            />
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(pendingRevert)}
        onOpenChange={(open) => !open && setPendingRevert(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>还原文件更改？</DialogTitle>
            <DialogDescription>此操作会丢弃该文件当前来源中的更改。</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={controller.preferences.skipRevertConfirmation}
              onCheckedChange={(checked) => controller.setSkipRevertConfirmation(checked === true)}
            />
            不再询问
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingRevert(undefined)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                pendingRevert
                  ? controller.isMutationDisabled(
                      pendingRevert.section,
                      pendingRevert.hunkIndex === undefined ? 'file' : 'hunk',
                      pendingRevert.hunkIndex
                    )
                  : true
              }
              onClick={() => {
                if (pendingRevert) {
                  if (pendingRevert.hunkIndex === undefined) {
                    controller.applyFileAction(group, pendingRevert.section, 'revert')
                  } else {
                    controller.applyHunkAction(
                      group,
                      pendingRevert.section,
                      'revert',
                      pendingRevert.hunkIndex
                    )
                  }
                }
                setPendingRevert(undefined)
              }}
            >
              还原
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ReviewSectionFileActions({
  controller,
  group,
  section,
  onRequestRevert
}: {
  controller: ReviewWorkspaceController
  group: ReviewFileGroup
  section: ReviewFileSection
  onRequestRevert(
    section: Extract<ReviewFileSection, { kind: 'snapshot' }>,
    hunkIndex?: number
  ): void
}): React.JSX.Element | null {
  if (section.kind !== 'snapshot') return null

  const sourceAction = sectionActionForSource(section.backendSource)
  const actionSourceLabel = sourceLabel(section.backendSource)
  const fileActionLabel = sourceAction === 'stage' ? '暂存未暂存文件' : '取消暂存已暂存文件'
  const fileActionTitle = sourceAction === 'stage' ? '暂存文件' : '对文件取消暂存'
  const revertActionLabel = `还原${actionSourceLabel}文件更改`
  const showDestructiveFileActions = controller.displaySource.type !== 'uncommitted'
  const showSourceAction = sourceAction === 'stage' || showDestructiveFileActions

  return (
    <>
      {showSourceAction && sourceAction ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={fileActionLabel}
          title={fileActionTitle}
          disabled={controller.isMutationDisabled(section, 'file')}
          onClick={() => controller.applyFileAction(group, section, sourceAction)}
        >
          {sourceAction === 'stage' ? <PlusIcon /> : <MinusIcon />}
        </Button>
      ) : null}
      {showDestructiveFileActions ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={revertActionLabel}
          title="还原文件"
          disabled={controller.isMutationDisabled(section, 'file')}
          onClick={() => onRequestRevert(section)}
        >
          <Undo2Icon />
        </Button>
      ) : null}
    </>
  )
}

function ReviewSection({
  controller,
  group,
  section,
  onRequestRevert
}: {
  controller: ReviewWorkspaceController
  group: ReviewFileGroup
  section: ReviewFileSection
  onRequestRevert(
    section: Extract<ReviewFileSection, { kind: 'snapshot' }>,
    hunkIndex?: number
  ): void
}): React.JSX.Element {
  if (section.kind === 'partial-error') {
    return (
      <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs">
        <div className="font-medium text-destructive">{sectionLabel(section)} 加载失败</div>
        <p className="mt-1 text-muted-foreground">{section.message}</p>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => controller.retryPartialSource(section.backendSource)}
        >
          Retry
        </Button>
      </div>
    )
  }

  const activeMatch = currentSearchMatch(controller, section)

  return (
    <div className="space-y-2">
      <SectionDiff
        controller={controller}
        group={group}
        section={section}
        activeMatch={activeMatch}
        onRequestRevert={onRequestRevert}
      />
      {section.kind === 'snapshot' && controller.selectedPath === group.path ? (
        <ReviewRichPreview controller={controller} section={section} />
      ) : null}
    </div>
  )
}

function SectionDiff({
  activeMatch,
  controller,
  group,
  onRequestRevert,
  section
}: {
  activeMatch?: ReviewWorkspaceController['search']['matches'][number]['item']
  controller: ReviewWorkspaceController
  group: ReviewFileGroup
  onRequestRevert(
    section: Extract<ReviewFileSection, { kind: 'snapshot' }>,
    hunkIndex?: number
  ): void
  section: Exclude<ReviewFileSection, { kind: 'partial-error' }>
}): React.JSX.Element | null {
  if (section.loadState.status === 'idle') return null
  if (section.loadState.status === 'loading') {
    return <ReviewDiffLoadingSkeleton />
  }
  if (section.loadState.status === 'error') {
    return (
      <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {section.loadState.message}
      </div>
    )
  }

  const summary = diffSummary(section.loadState.diff)
  if (summary)
    return (
      <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
        {summary}
      </div>
    )

  const sourceAction =
    section.kind === 'snapshot' ? sectionActionForSource(section.backendSource) : undefined
  const canRevertHunk =
    section.kind === 'snapshot' &&
    (section.backendSource.type === 'staged' || section.backendSource.type === 'unstaged')

  return (
    <ReviewFileDiff
      cacheKey={section.key}
      diff={section.loadState.diff.diff}
      preferences={controller.preferences}
      activeMatch={activeMatch}
      hunkActions={
        section.kind === 'snapshot' && (sourceAction || canRevertHunk)
          ? {
              action: sourceAction,
              isDisabled: (hunkIndex) => controller.isMutationDisabled(section, 'hunk', hunkIndex),
              onAction: sourceAction
                ? (hunkIndex) => controller.applyHunkAction(group, section, sourceAction, hunkIndex)
                : undefined,
              onRevert: canRevertHunk
                ? (hunkIndex) => onRequestRevert(section, hunkIndex)
                : undefined
            }
          : undefined
      }
      fullContentRequest={
        section.kind === 'snapshot' && controller.target
          ? {
              kind: 'snapshot',
              target: controller.target,
              source: section.backendSource,
              snapshotGeneration: section.snapshotGeneration,
              file: {
                path: section.file.path,
                ...(section.file.previousPath ? { previousPath: section.file.previousPath } : {}),
                revision: section.file.revision
              }
            }
          : section.kind === 'turn' && controller.target && section.loadState.status === 'ready'
            ? {
                kind: 'turn',
                target: controller.target,
                turnId: section.backendSource.turnId,
                path: section.file.path
              }
            : undefined
      }
    />
  )
}

function diffSummary(diff: {
  binary: boolean
  conflicted: boolean
  truncated: boolean
}): string | undefined {
  if (diff.conflicted) return '此文件存在冲突，暂不渲染文本差异。'
  if (diff.truncated) return '差异内容过大，暂不渲染完整文本。'
  if (diff.binary) return '二进制文件暂不支持文本预览。'
  return undefined
}

function currentSearchMatch(
  controller: ReviewWorkspaceController,
  section: Exclude<ReviewFileSection, { kind: 'partial-error' }>
): ReviewWorkspaceController['search']['matches'][number]['item'] | undefined {
  if (controller.search.currentIndex < 0) return undefined
  const match = controller.search.matches[controller.search.currentIndex]
  return match?.sectionKey === section.key ? match.item : undefined
}

function basename(path: string): string {
  const segments = path.split('/')
  return segments.at(-1) ?? path
}
