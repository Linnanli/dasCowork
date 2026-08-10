import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { LocalGitChangeKind } from '../../../../../shared/localGitApi'
import { groupKey, sectionActionForSource, sectionLabel } from './reviewWorkspaceModel'
import { ReviewFileDiff } from './ReviewFileDiff'
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
  const [pendingRevert, setPendingRevert] = useState<
    { section: Extract<ReviewFileSection, { kind: 'snapshot' }>; hunkIndex?: number } | undefined
  >(undefined)

  return (
    <section
      data-review-path={group.path}
      className={cn(
        'rounded-md border bg-background',
        controller.selectedPath === group.path && 'ring-1 ring-ring/35'
      )}
    >
      <div className="flex min-h-10 items-center gap-2 border-b bg-muted/25 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={collapsed ? 'Expand file diff' : 'Collapse file diff'}
          aria-expanded={!collapsed}
          onClick={() => controller.setCollapsed(key, !collapsed)}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{group.path}</div>
          {group.previousPath ? (
            <div className="truncate text-[11px] text-muted-foreground">
              来自 {group.previousPath}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-xs tabular-nums">
          <span className="text-emerald-600">+{group.additions}</span>{' '}
          <span className="text-destructive">-{group.deletions}</span>
        </div>
        {controller.displaySource.type === 'branch' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={controller.isViewed(group)}
            onClick={() => controller.setViewed(group, !controller.isViewed(group))}
          >
            {controller.isViewed(group) ? '已查看' : '标为已查看'}
          </Button>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="space-y-3 p-2">
          {group.sections.map((section) => (
            <ReviewSection
              key={section.key}
              controller={controller}
              group={group}
              section={section}
              onRequestRevert={(snapshotSection, hunkIndex) => {
                if (controller.preferences.skipRevertConfirmation) {
                  if (hunkIndex === undefined)
                    controller.applyFileAction(group, snapshotSection, 'revert')
                  else controller.applyHunkAction(group, snapshotSection, 'revert', hunkIndex)
                } else {
                  setPendingRevert({ section: snapshotSection, hunkIndex })
                }
              }}
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

  const sourceAction =
    section.kind === 'snapshot' ? sectionActionForSource(section.backendSource) : undefined
  const loadedDiff = section.loadState.status === 'ready' ? section.loadState.diff : undefined
  const hunkCount = loadedDiff?.diff.match(/^@@/gmu)?.length ?? 0
  const activeMatch = currentSearchMatch(controller, section)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {sectionLabel(section)}
        </span>
        <div className="min-w-0 flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {changeKindLabel(section.file.changeKind)}
        </span>
        {sourceAction ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={controller.isMutationDisabled(section, 'file')}
            onClick={() => controller.applyFileAction(group, section, sourceAction)}
          >
            {sourceAction === 'stage' ? '暂存文件' : '取消暂存文件'}
          </Button>
        ) : null}
        {section.kind === 'snapshot' ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Revert file changes"
            title="Revert"
            disabled={controller.isMutationDisabled(section, 'file')}
            onClick={() => onRequestRevert(section)}
          >
            <RotateCcwIcon />
          </Button>
        ) : null}
      </div>
      <SectionDiff controller={controller} section={section} activeMatch={activeMatch} />
      {section.kind === 'snapshot' && controller.selectedPath === group.path ? (
        <ReviewRichPreview controller={controller} section={section} />
      ) : null}
      {section.kind === 'snapshot' && hunkCount > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="区块操作">
          {Array.from({ length: hunkCount }, (_, hunkIndex) => (
            <div key={hunkIndex} className="flex items-center gap-1">
              {sourceAction ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={controller.isMutationDisabled(section, 'hunk', hunkIndex)}
                  onClick={() =>
                    controller.applyHunkAction(group, section, sourceAction, hunkIndex)
                  }
                >
                  {sourceAction === 'stage' ? '暂存' : '取消暂存'}区块 {hunkIndex + 1}
                </Button>
              ) : null}
              {section.backendSource.type === 'staged' ||
              section.backendSource.type === 'unstaged' ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={controller.isMutationDisabled(section, 'hunk', hunkIndex)}
                  onClick={() => onRequestRevert(section, hunkIndex)}
                >
                  还原区块 {hunkIndex + 1}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SectionDiff({
  activeMatch,
  controller,
  section
}: {
  activeMatch?: ReviewWorkspaceController['search']['matches'][number]['item']
  controller: ReviewWorkspaceController
  section: Exclude<ReviewFileSection, { kind: 'partial-error' }>
}): React.JSX.Element | null {
  if (section.loadState.status === 'idle') return null
  if (section.loadState.status === 'loading') {
    return (
      <div className="rounded-md border bg-muted/20 px-3 py-5 text-center text-xs text-muted-foreground">
        Loading diff...
      </div>
    )
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
  return (
    <ReviewFileDiff
      cacheKey={section.key}
      diff={section.loadState.diff.diff}
      preferences={controller.preferences}
      activeMatch={activeMatch}
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

function changeKindLabel(changeKind: LocalGitChangeKind): string {
  switch (changeKind) {
    case 'added':
      return '新增'
    case 'deleted':
      return '已删除'
    case 'renamed':
      return '已重命名'
    case 'copied':
      return '已复制'
    case 'type-change':
      return '类型已变更'
    case 'unmerged':
      return '存在冲突'
    case 'modified':
      return '已修改'
    default:
      return '已变更'
  }
}
