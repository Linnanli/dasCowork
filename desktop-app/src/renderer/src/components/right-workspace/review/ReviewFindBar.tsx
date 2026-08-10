import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
}

export function ReviewFindBar({ controller }: Props): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedMatchRef = useRef<string | undefined>(undefined)
  const { search } = controller

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'f') return
      const activeElement = document.activeElement
      if (
        !(activeElement instanceof Element) ||
        !activeElement.closest('[data-slot="review-workspace"]')
      )
        return
      event.preventDefault()
      controller.setSearchOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])

  useEffect(() => {
    const selectionKey = `${search.query}:${search.currentIndex}:${search.matches[search.currentIndex]?.sectionKey ?? ''}`
    if (search.currentIndex < 0 || selectedMatchRef.current === selectionKey) return
    selectedMatchRef.current = selectionKey
    controller.selectSearchMatch(search.currentIndex)
  }, [controller, search.currentIndex, search.matches, search.query])

  if (!search.open) return null

  const count = search.matches.length
  const total = search.totalMatches
  const resultLabel = searchResultLabel(
    search.status,
    count,
    search.currentIndex,
    total,
    search.query
  )
  return (
    <div
      role="search"
      aria-label="在审阅中查找"
      className="absolute top-2 right-3 z-20 flex max-w-[min(32rem,calc(100%-1.5rem))] items-center gap-1 rounded-md border bg-popover p-1 shadow-sm"
    >
      <SearchIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        autoFocus
        aria-label="在审阅中查找"
        className="h-7 w-52 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        value={search.query}
        onChange={(event) => controller.setSearchQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') controller.setSearchOpen(false)
          if (event.key === 'Enter') controller.moveSearchMatch(event.shiftKey ? -1 : 1)
        }}
      />
      <span
        className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {resultLabel}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="上一个匹配"
        disabled={count === 0}
        onClick={() => controller.moveSearchMatch(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="下一个匹配"
        disabled={count === 0}
        onClick={() => controller.moveSearchMatch(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="关闭审阅查找"
        onClick={() => controller.setSearchOpen(false)}
      >
        <XIcon />
      </Button>
      {search.isCapped ? (
        <span className="text-[11px] text-muted-foreground">
          仅显示前 250 个，共 {search.totalMatches} 个
        </span>
      ) : null}
      {controller.canLoadMoreSearchMatches ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => controller.loadMoreSearchMatches()}
        >
          加载更多匹配项
        </Button>
      ) : null}
      {search.error ? (
        <span role="alert" className="sr-only">
          {search.error}
        </span>
      ) : null}
    </div>
  )
}

function searchResultLabel(
  status: ReviewWorkspaceController['search']['status'],
  count: number,
  currentIndex: number,
  total: number,
  query: string
): string {
  if (status === 'searching') return '查找中'
  if (count > 0) return `${currentIndex + 1}/${total}`
  if (query.trim()) return '无匹配'
  return '查找'
}
