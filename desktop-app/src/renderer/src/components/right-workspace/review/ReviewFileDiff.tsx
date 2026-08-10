import { processFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { Component, useMemo, type ReactNode } from 'react'

import type { LocalGitReviewSearchItem } from '../../../../../shared/localGitApi'
import { reviewDiffOptions } from './reviewDiffOptions'
import type { ReviewWorkspacePreferences } from './reviewWorkspaceTypes'

type Props = {
  cacheKey: string
  diff: string
  preferences: Pick<ReviewWorkspacePreferences, 'diffMode' | 'lineDiffType' | 'wrap' | 'fullFiles'>
  activeMatch?: LocalGitReviewSearchItem
}

export function ReviewFileDiff(props: Props): React.JSX.Element {
  return (
    <ReviewFileDiffBoundary cacheKey={props.cacheKey}>
      <ParsedReviewFileDiff {...props} />
    </ReviewFileDiffBoundary>
  )
}

function ParsedReviewFileDiff({
  activeMatch,
  cacheKey,
  diff,
  preferences
}: Props): React.JSX.Element {
  const fileDiff = useMemo(() => processFile(diff, { isGitDiff: true, cacheKey }), [cacheKey, diff])
  const options = useMemo(() => reviewDiffOptions(preferences), [preferences])

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
      <FileDiff
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
        className="block min-w-0 rounded-md border bg-background"
        disableWorkerPool
      />
    </div>
  )
}

type BoundaryProps = {
  cacheKey: string
  children: ReactNode
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
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          无法渲染此文件的文本差异。请刷新审阅后重试。
        </div>
      )
    }
    return this.props.children
  }
}
