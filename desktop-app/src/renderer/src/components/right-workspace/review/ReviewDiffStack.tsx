import { useEffect, useMemo, useRef } from 'react'

import type { ReviewFileGroup, ReviewWorkspaceController } from './reviewWorkspaceTypes'
import { ReviewFileBlock } from './ReviewFileBlock'

type Props = {
  controller: ReviewWorkspaceController
}

export function ReviewDiffStack({ controller }: Props): React.JSX.Element {
  const { loadState } = controller
  if (!('groups' in loadState) && loadState.status !== 'error') {
    return (
      <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading review...
      </div>
    )
  }
  if (!('groups' in loadState)) {
    return (
      <div role="alert" className="m-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
        {loadState.message}
      </div>
    )
  }
  return <ReadyReviewDiffStack controller={controller} groups={loadState.groups} largeDiff={loadState.largeDiff} />
}

function ReadyReviewDiffStack({
  controller,
  groups,
  largeDiff
}: {
  controller: ReviewWorkspaceController
  groups: readonly ReviewFileGroup[]
  largeDiff: boolean
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const selectedPath = controller.selectedPath ?? groups[0]?.path
  const initialGroups = useMemo(
    () =>
      largeDiff
        ? groups.filter((group) => group.path === selectedPath)
        : [
            ...groups.filter((group) => group.path === selectedPath),
            ...groups.filter((group) => group.path !== selectedPath).slice(0, 3)
          ],
    [groups, largeDiff, selectedPath]
  )

  useEffect(() => {
    initialGroups.forEach((group) => {
      group.sections.forEach((section) => {
        if (section.kind !== 'partial-error' && section.loadState.status === 'idle') {
          controller.loadSectionDiff(section.key)
        }
      })
    })
  }, [controller, initialGroups])

  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)
        for (const entry of visible) {
          const group = groups.find((candidate) => candidate.path === entry.target.getAttribute('data-review-path'))
          group?.sections.forEach((section) => {
            if (section.kind !== 'partial-error' && section.loadState.status === 'idle') {
              controller.loadSectionDiff(section.key)
            }
          })
        }
        const nearest = visible.find((entry) => entry.boundingClientRect.bottom > root.getBoundingClientRect().top)
        const path = nearest?.target.getAttribute('data-review-path')
        if (path) controller.setActivePath(path)
      },
      { root, rootMargin: '-8px 0px -70% 0px', threshold: [0, 0.01, 1] }
    )
    root.querySelectorAll<HTMLElement>('[data-review-path]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [controller, groups])
  if (groups.length === 0) {
    return (
      <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        No changes to review.
      </div>
    )
  }
  return (
    <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <ReviewFileBlock key={group.path} controller={controller} group={group} />
        ))}
      </div>
    </div>
  )
}
