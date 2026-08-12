import {
  processFile,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type Hunk
} from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, RotateCcwIcon } from 'lucide-react'
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'

import type {
  LocalGitReviewDiffFileContents,
  LocalGitReviewSearchItem,
  LocalGitReviewSource,
  LocalGitTarget
} from '../../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import { ReviewDiffLoadingSkeleton } from './ReviewDiffLoadingSkeleton'
import { reviewDiffOptions } from './reviewDiffOptions'
import type { ReviewWorkspacePreferences } from './reviewWorkspaceTypes'

type Props = {
  cacheKey: string
  diff: string
  preferences: Pick<ReviewWorkspacePreferences, 'diffMode' | 'lineDiffType' | 'wrap' | 'fullFiles'>
  activeMatch?: LocalGitReviewSearchItem
  fullContentRequest?: ReviewDiffFullContentRequest
  hunkActions?: ReviewDiffHunkActions
}

export type ReviewDiffHunkActions = {
  action?: 'stage' | 'unstage'
  isDisabled?(hunkIndex: number): boolean
  onAction?(hunkIndex: number): void
  onRevert?(hunkIndex: number): void
}

type HunkActionAnnotation = {
  kind: 'hunk-actions'
  hunkIndex: number
}

type HunkActionAnchor = Pick<DiffLineAnnotation<HunkActionAnnotation>, 'side' | 'lineNumber'>

export type ReviewDiffFullContentRequest =
  | {
      kind: 'snapshot'
      target: LocalGitTarget
      source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>
      snapshotGeneration: string
      file: { path: string; previousPath?: string; revision: string }
    }
  | {
      kind: 'turn'
      target: LocalGitTarget
      turnId: string
      path: string
    }

export function ReviewFileDiff(props: Props): React.JSX.Element {
  return (
    <ReviewFileDiffBoundary
      cacheKey={props.cacheKey}
      fallback={<ParsedReviewFileDiff {...props} forcePartial />}
    >
      <ParsedReviewFileDiff {...props} />
    </ReviewFileDiffBoundary>
  )
}

function ParsedReviewFileDiff({
  activeMatch,
  cacheKey,
  diff,
  fullContentRequest,
  hunkActions,
  preferences,
  forcePartial = false
}: Props & { forcePartial?: boolean }): React.JSX.Element {
  const { content: fullContent, isLoading: isFullContentLoading } = useReviewDiffFullContent(
    forcePartial ? undefined : fullContentRequest
  )
  const fileDiff = useMemo(() => {
    const files =
      !forcePartial && fullContent?.status === 'text' && fullContentRequest
        ? {
            oldFile: {
              name:
                fullContentRequest.kind === 'snapshot'
                  ? (fullContentRequest.file.previousPath ?? fullContentRequest.file.path)
                  : fullContentRequest.path,
              contents: fullContent.before
            },
            newFile: {
              name:
                fullContentRequest.kind === 'snapshot'
                  ? fullContentRequest.file.path
                  : fullContentRequest.path,
              contents: fullContent.after
            }
          }
        : undefined
    const partialFileDiff = processFile(diff, { isGitDiff: true, cacheKey })
    if (!files) return partialFileDiff

    const fullFileDiff = processFile(diff, {
      isGitDiff: true,
      cacheKey: `${cacheKey}:full`,
      ...files
    })
    return isCompatibleFullFileDiff(partialFileDiff, fullFileDiff) ? fullFileDiff : partialFileDiff
  }, [cacheKey, diff, forcePartial, fullContent, fullContentRequest])
  const options = useMemo(() => reviewDiffOptions<HunkActionAnnotation>(preferences), [preferences])
  const hunkActionAnnotations = useMemo(
    () => createHunkActionAnnotations(fileDiff, hunkActions),
    [fileDiff, hunkActions]
  )

  if (isFullContentLoading) return <ReviewDiffLoadingSkeleton />

  if (!fileDiff) {
    return (
      <div
        role="status"
        className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      >
        此文件没有可显示的文本差异。
      </div>
    )
  }

  return (
    <div data-review-file-diff={cacheKey}>
      <FileDiff<HunkActionAnnotation>
        fileDiff={fileDiff}
        options={options}
        selectedLines={
          activeMatch && activeMatch.lineStart > 0
            ? {
                start: activeMatch.lineStart,
                end: activeMatch.lineEnd,
                side: activeMatch.side,
                endSide: activeMatch.side
              }
            : null
        }
        className="group/file-diff block min-w-0"
        lineAnnotations={hunkActionAnnotations}
        renderAnnotation={(annotation) => {
          if (annotation.metadata.kind !== 'hunk-actions') return null
          return (
            <ReviewDiffHunkActionsToolbar
              actions={hunkActions}
              hunkIndex={annotation.metadata.hunkIndex}
            />
          )
        }}
        disableWorkerPool
      />
    </div>
  )
}

function createHunkActionAnnotations(
  fileDiff: FileDiffMetadata | undefined,
  hunkActions: ReviewDiffHunkActions | undefined
): DiffLineAnnotation<HunkActionAnnotation>[] {
  if (!fileDiff || !hunkActions || (!hunkActions.onAction && !hunkActions.onRevert)) return []

  return (fileDiff.hunks ?? []).flatMap((hunk, hunkIndex) => {
    const anchor = findLastChangedLine(hunk)
    if (!anchor) return []

    return [{ ...anchor, metadata: { kind: 'hunk-actions', hunkIndex } }]
  })
}

function findLastChangedLine(hunk: Hunk): HunkActionAnchor | undefined {
  let additionLineNumber = hunk.additionStart
  let deletionLineNumber = hunk.deletionStart
  let anchor: HunkActionAnchor | undefined

  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      additionLineNumber += content.lines
      deletionLineNumber += content.lines
      continue
    }

    const additionAnchor = findChangedSideAnchor({
      side: 'additions',
      start: additionLineNumber,
      count: content.additions,
      noEofLineNumber: hunk.noEOFCRAdditions
        ? hunk.additionStart + hunk.additionCount - 1
        : undefined
    })
    const deletionAnchor = findChangedSideAnchor({
      side: 'deletions',
      start: deletionLineNumber,
      count: content.deletions,
      noEofLineNumber: hunk.noEOFCRDeletions
        ? hunk.deletionStart + hunk.deletionCount - 1
        : undefined
    })

    additionLineNumber += content.additions
    deletionLineNumber += content.deletions
    anchor = additionAnchor ?? deletionAnchor ?? anchor
  }

  return anchor
}

function findChangedSideAnchor({
  count,
  noEofLineNumber,
  side,
  start
}: {
  count: number
  noEofLineNumber?: number
  side: 'additions' | 'deletions'
  start: number
}): HunkActionAnchor | undefined {
  if (count === 0) return undefined

  const lastChangedLine = start + count - 1
  const lineNumber = lastChangedLine === noEofLineNumber ? lastChangedLine - 1 : lastChangedLine
  return lineNumber < start ? undefined : { side, lineNumber }
}

function ReviewDiffHunkActionsToolbar({
  actions,
  hunkIndex
}: {
  actions: ReviewDiffHunkActions | undefined
  hunkIndex: number
}): React.JSX.Element | null {
  if (!actions) return null

  const disabled = actions.isDisabled?.(hunkIndex) ?? false
  const actionLabel = actions.action === 'stage' ? '暂存' : '取消暂存'

  return (
    <div
      data-review-hunk-actions={hunkIndex}
      className="pointer-events-none absolute -top-8.5 right-0.5 z-20 flex items-center gap-1 rounded-full bg-popover/90 px-0.5 py-0.5 opacity-0 shadow-sm ring-1 ring-border/60 transition-opacity group-hover/file-diff:pointer-events-auto group-hover/file-diff:opacity-100"
    >
      {actions.onRevert ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`还原区块 ${hunkIndex + 1}`}
          title={`还原区块 ${hunkIndex + 1}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            actions.onRevert?.(hunkIndex)
          }}
        >
          <RotateCcwIcon />
        </Button>
      ) : null}
      {actions.action && actions.onAction ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`${actionLabel}区块 ${hunkIndex + 1}`}
          title={`${actionLabel}区块 ${hunkIndex + 1}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            actions.onAction?.(hunkIndex)
          }}
        >
          {actions.action === 'stage' ? <ArrowDownToLineIcon /> : <ArrowUpFromLineIcon />}
        </Button>
      ) : null}
    </div>
  )
}

function useReviewDiffFullContent(request?: ReviewDiffFullContentRequest): {
  content: LocalGitReviewDiffFileContents | undefined
  isLoading: boolean
} {
  const requestKey = fullContentRequestKey(request)
  const [loaded, setLoaded] = useState<
    { requestKey: string; content: LocalGitReviewDiffFileContents } | undefined
  >()

  useEffect(() => {
    let active = true
    if (!request || !requestKey) return
    if (loaded?.requestKey === requestKey) return
    const readContents =
      request.kind === 'snapshot'
        ? window.desktopApp.git.getReviewDiffFileContents({
            target: request.target,
            source: request.source,
            snapshotGeneration: request.snapshotGeneration,
            file: request.file
          })
        : window.desktopApp.git.getTurnDiffFileContents({
            target: request.target,
            turnId: request.turnId,
            path: request.path
          })
    void readContents
      .then((result) => {
        if (active) setLoaded({ requestKey, content: result })
      })
      .catch((cause) => {
        if (active) {
          setLoaded({
            requestKey,
            content: {
              status: 'unsupported',
              reason: cause instanceof Error ? cause.message : '无法读取完整文件内容。'
            }
          })
        }
      })
    return () => {
      active = false
    }
  }, [loaded?.requestKey, request, requestKey])

  const content = loaded && loaded.requestKey === requestKey ? loaded.content : undefined
  return { content, isLoading: Boolean(requestKey && !content) }
}

function fullContentRequestKey(request?: ReviewDiffFullContentRequest): string | undefined {
  if (!request) return undefined
  return JSON.stringify(request)
}

/**
 * `processFile` trusts hunk line numbers when full file contents are supplied.
 * A review snapshot can be refreshed between loading the patch and reading the
 * files, so verify that every hunk still describes those exact files before
 * enabling expansion. This mirrors the reference client's guard and keeps an
 * out-of-date file on the safe, partial-diff rendering path.
 */
function isCompatibleFullFileDiff(
  partialFileDiff: FileDiffMetadata | undefined,
  fullFileDiff: FileDiffMetadata | undefined
): fullFileDiff is FileDiffMetadata {
  if (
    !partialFileDiff ||
    !fullFileDiff ||
    partialFileDiff.hunks.length !== fullFileDiff.hunks.length
  )
    return false

  let previousAdditionEnd = 0
  let previousDeletionEnd = 0
  for (let index = 0; index < fullFileDiff.hunks.length; index += 1) {
    const partialHunk = partialFileDiff.hunks[index]
    const fullHunk = fullFileDiff.hunks[index]
    if (!partialHunk || !fullHunk) return false
    if (
      partialHunk.additionStart !== fullHunk.additionStart ||
      partialHunk.additionCount !== fullHunk.additionCount ||
      partialHunk.deletionStart !== fullHunk.deletionStart ||
      partialHunk.deletionCount !== fullHunk.deletionCount ||
      fullHunk.additionLineIndex < previousAdditionEnd ||
      fullHunk.deletionLineIndex < previousDeletionEnd ||
      fullHunk.additionLineIndex - previousAdditionEnd !==
        fullHunk.deletionLineIndex - previousDeletionEnd ||
      fullHunk.additionLineIndex + fullHunk.additionCount > fullFileDiff.additionLines.length ||
      fullHunk.deletionLineIndex + fullHunk.deletionCount > fullFileDiff.deletionLines.length ||
      partialHunk.hunkContent.length !== fullHunk.hunkContent.length
    ) {
      return false
    }

    for (let contentIndex = 0; contentIndex < fullHunk.hunkContent.length; contentIndex += 1) {
      const partialContent = partialHunk.hunkContent[contentIndex]
      const fullContent = fullHunk.hunkContent[contentIndex]
      if (!partialContent || !fullContent || partialContent.type !== fullContent.type) return false
      if (partialContent.type === 'context' && fullContent.type === 'context') {
        if (
          partialContent.lines !== fullContent.lines ||
          !sameLineRange(
            partialFileDiff.additionLines,
            partialContent.additionLineIndex,
            fullFileDiff.additionLines,
            fullContent.additionLineIndex,
            partialContent.lines
          ) ||
          !sameLineRange(
            partialFileDiff.deletionLines,
            partialContent.deletionLineIndex,
            fullFileDiff.deletionLines,
            fullContent.deletionLineIndex,
            partialContent.lines
          )
        ) {
          return false
        }
      }
      if (partialContent.type === 'change' && fullContent.type === 'change') {
        if (
          partialContent.additions !== fullContent.additions ||
          partialContent.deletions !== fullContent.deletions ||
          !sameLineRange(
            partialFileDiff.additionLines,
            partialContent.additionLineIndex,
            fullFileDiff.additionLines,
            fullContent.additionLineIndex,
            partialContent.additions
          ) ||
          !sameLineRange(
            partialFileDiff.deletionLines,
            partialContent.deletionLineIndex,
            fullFileDiff.deletionLines,
            fullContent.deletionLineIndex,
            partialContent.deletions
          )
        ) {
          return false
        }
      }
    }

    previousAdditionEnd = fullHunk.additionLineIndex + fullHunk.additionCount
    previousDeletionEnd = fullHunk.deletionLineIndex + fullHunk.deletionCount
  }

  return (
    fullFileDiff.additionLines.length - previousAdditionEnd ===
    fullFileDiff.deletionLines.length - previousDeletionEnd
  )
}

function sameLineRange(
  expectedLines: string[],
  expectedStart: number,
  actualLines: string[],
  actualStart: number,
  length: number
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[expectedStart + index] !== actualLines[actualStart + index]) return false
  }
  return true
}

type BoundaryProps = {
  cacheKey: string
  children: ReactNode
  fallback: ReactNode
}

type BoundaryState = { error?: Error }

class ReviewFileDiffBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {}

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidUpdate(previousProps: BoundaryProps): void {
    if (previousProps.cacheKey !== this.props.cacheKey && this.state.error)
      this.setState({ error: undefined })
  }

  render(): ReactNode {
    if (this.state.error) return this.props.fallback
    return this.props.children
  }
}
