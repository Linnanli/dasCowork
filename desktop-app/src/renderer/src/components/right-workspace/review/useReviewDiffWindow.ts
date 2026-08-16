import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ReviewFileGroup } from './reviewWorkspaceTypes'

const DEFAULT_ITEM_HEIGHT = 320

type VirtualReviewItem = {
  group: ReviewFileGroup
  height: number
  start: number
}

type ScrollAnchor = {
  path: string
  offset: number
}

export function useReviewDiffWindow({
  groups,
  scrollContainerRef,
  selectedPath,
  overscan = 6
}: {
  groups: readonly ReviewFileGroup[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  selectedPath?: string
  overscan?: number
}): {
  bottomSpacer: number
  onItemHeight(path: string, height: number): void
  renderedItems: readonly VirtualReviewItem[]
  topSpacer: number
  totalHeight: number
} {
  const [itemHeights, setItemHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const itemsRef = useRef<readonly VirtualReviewItem[]>([])
  const anchorRef = useRef<ScrollAnchor | undefined>(undefined)
  const lastScrolledPathRef = useRef<string | undefined>(undefined)
  const frameRef = useRef(0)
  const [viewport, setViewport] = useState({ height: 720, scrollTop: 0 })

  const items = useMemo(() => createVirtualReviewItems(groups, itemHeights), [groups, itemHeights])

  const totalHeight = items.at(-1) ? items.at(-1)!.start + items.at(-1)!.height : 0
  const visibleStart = findItemIndex(items, viewport.scrollTop)
  const visibleEnd = findItemIndex(items, viewport.scrollTop + viewport.height)
  const startIndex = Math.max(0, visibleStart - overscan)
  const endIndex = Math.min(items.length, visibleEnd + overscan + 1)
  const renderedItems = items.slice(startIndex, endIndex)
  const topSpacer = items[startIndex]?.start ?? 0
  const bottomSpacer = Math.max(
    0,
    totalHeight - (items[endIndex - 1]?.start ?? 0) - (items[endIndex - 1]?.height ?? 0)
  )

  const updateViewport = useCallback((container: HTMLDivElement) => {
    setViewport((current) => {
      const next = { height: container.clientHeight, scrollTop: container.scrollTop }
      if (current.height !== next.height) return next

      const currentItems = itemsRef.current
      const currentStart = findItemIndex(currentItems, current.scrollTop)
      const currentEnd = findItemIndex(currentItems, current.scrollTop + current.height)
      const nextStart = findItemIndex(currentItems, next.scrollTop)
      const nextEnd = findItemIndex(currentItems, next.scrollTop + next.height)
      return currentStart === nextStart && currentEnd === nextEnd ? current : next
    })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const onScroll = (): void => {
      if (frameRef.current) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        updateViewport(container)
      })
    }
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => updateViewport(container))
    container.addEventListener('scroll', onScroll, { passive: true })
    observer?.observe(container)
    updateViewport(container)
    return () => {
      container.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    }
  }, [scrollContainerRef, updateViewport])

  useEffect(() => {
    if (!selectedPath || selectedPath === lastScrolledPathRef.current) return
    const container = scrollContainerRef.current
    const item = items.find((candidate) => candidate.group.path === selectedPath)
    if (!container || !item) return
    lastScrolledPathRef.current = selectedPath
    container.scrollTop = item.start
    updateViewport(container)
  }, [items, scrollContainerRef, selectedPath, updateViewport])

  const onItemHeight = useCallback(
    (path: string, height: number) => {
      // ResizeObserver can emit a zero-sized record while an item is being
      // removed from the virtual window. Keeping that value would turn its
      // estimated height into 1px and expand the next window without bound.
      if (!Number.isFinite(height) || height < 24) return
      const normalizedHeight = Math.max(1, Math.ceil(height))
      const previousItem = itemsRef.current.find((item) => item.group.path === path)
      if (previousItem?.height === normalizedHeight) return

      const container = scrollContainerRef.current
      const previousItems = itemsRef.current
      if (container) {
        const anchor = previousItems[findItemIndex(previousItems, container.scrollTop)]
        if (anchor) {
          anchorRef.current = {
            path: anchor.group.path,
            offset: container.scrollTop - anchor.start
          }
        }
      }
      setItemHeights((current) => {
        if ((current.get(path) ?? DEFAULT_ITEM_HEIGHT) === normalizedHeight) return current
        const next = new Map(current)
        next.set(path, normalizedHeight)
        return next
      })
    },
    [scrollContainerRef]
  )

  useLayoutEffect(() => {
    itemsRef.current = items
    const anchor = anchorRef.current
    const container = scrollContainerRef.current
    if (!anchor || !container) return
    const item = items.find((candidate) => candidate.group.path === anchor.path)
    if (item) container.scrollTop = item.start + anchor.offset
    anchorRef.current = undefined
  }, [items, scrollContainerRef])

  return { bottomSpacer, onItemHeight, renderedItems, topSpacer, totalHeight }
}

function createVirtualReviewItems(
  groups: readonly ReviewFileGroup[],
  itemHeights: ReadonlyMap<string, number>
): VirtualReviewItem[] {
  let start = 0
  return groups.map((group) => {
    const height = itemHeights.get(group.path) ?? DEFAULT_ITEM_HEIGHT
    const item = { group, height, start }
    start += height
    return item
  })
}

function findItemIndex(items: readonly VirtualReviewItem[], offset: number): number {
  if (items.length === 0) return 0
  let low = 0
  let high = items.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]
    if (item && item.start + item.height <= offset) low = middle + 1
    else high = middle
  }
  return low
}
