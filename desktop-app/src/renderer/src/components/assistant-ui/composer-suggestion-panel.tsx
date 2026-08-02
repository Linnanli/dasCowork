import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import type {
  ComposerSuggestionItem,
  ComposerSuggestionSection
} from '@/composer/composerSuggestionTypes'
import { useComposerSuggestionPanelMaxHeight } from './composer-suggestion-panel-layout'

export type ComposerSuggestionPanelProps = {
  ariaLabel: string
  emptyLabel: string
  highlightedId: string | null
  items?: readonly ComposerSuggestionItem[]
  onDismiss?: () => void
  onHighlight: (id: string) => void
  onSelect: (item: ComposerSuggestionItem) => void
  sections?: readonly ComposerSuggestionSection[]
}

const itemClassName =
  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-popover-foreground/75 transition-colors outline-none hover:bg-foreground/5 hover:text-popover-foreground focus-visible:bg-foreground/5 data-[highlighted=true]:bg-foreground/5 data-[highlighted=true]:text-popover-foreground disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-foreground/8 dark:focus-visible:bg-foreground/8 dark:data-[highlighted=true]:bg-foreground/8'

/**
 * Shared visual shell for context, command, and command-content suggestions.
 * The Composer owns focus and keyboard navigation; this component only renders
 * the active result set and reports pointer interactions.
 */
export function ComposerSuggestionPanel({
  ariaLabel,
  emptyLabel,
  highlightedId,
  items,
  onDismiss,
  onHighlight,
  onSelect,
  sections
}: ComposerSuggestionPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const panelMaxHeight = useComposerSuggestionPanelMaxHeight(panelRef)
  const normalizedSections = useMemo<readonly ComposerSuggestionSection[]>(
    () => sections ?? (items ? [{ id: 'results', items, showTitle: false }] : []),
    [items, sections]
  )
  const visibleItemCount = normalizedSections.reduce(
    (count, section) => count + section.items.length,
    0
  )
  const hasStatus = normalizedSections.some((section) =>
    Boolean(section.loading || section.error || section.placeholder)
  )

  useEffect(() => {
    if (!highlightedId) return
    const option = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
    ).find((element) => element.id === optionId(highlightedId))
    option?.scrollIntoView({ block: 'nearest' })
  }, [highlightedId])

  useEffect(() => {
    if (!onDismiss) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest('[data-composer-suggestion-keep-open]') ||
        target.closest('.aui-lexical-input')
      ) {
        return
      }
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onDismiss])

  return (
    <div
      ref={panelRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={highlightedId ? optionId(highlightedId) : undefined}
      data-testid="composer-suggestion-panel"
      data-composer-suggestion-keep-open
      className="aui-composer-context-panel absolute right-0 bottom-full left-0 z-50 mb-3 overflow-y-auto rounded-2xl border border-border bg-popover/90 p-1 text-popover-foreground shadow-lg backdrop-blur-md"
      style={{ maxHeight: panelMaxHeight }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {normalizedSections.map((section) => (
        <SuggestionSection
          key={section.id}
          section={section}
          highlightedId={highlightedId}
          onHighlight={onHighlight}
          onSelect={onSelect}
        />
      ))}
      {!hasStatus && visibleItemCount === 0 ? (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyLabel}</div>
      ) : null}
    </div>
  )
}

function SuggestionSection({
  highlightedId,
  onHighlight,
  onSelect,
  section
}: {
  highlightedId: string | null
  onHighlight: (id: string) => void
  onSelect: (item: ComposerSuggestionItem) => void
  section: ComposerSuggestionSection
}): React.JSX.Element | null {
  if (!section.loading && !section.error && !section.placeholder && section.items.length === 0) {
    return null
  }

  return (
    <section className="py-1" aria-label={section.label}>
      {section.label && section.showTitle !== false ? (
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
          {section.label}
        </div>
      ) : null}
      {section.loading ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          正在加载…
        </div>
      ) : null}
      {section.error ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1 truncate">{section.error}</span>
          {section.onRetry ? (
            <button
              type="button"
              className="rounded-md p-1 hover:bg-destructive/10"
              aria-label={`重试加载 ${section.label ?? '结果'}`}
              onClick={section.onRetry}
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {section.placeholder ? (
        <div className="px-2.5 py-2 text-sm text-muted-foreground">{section.placeholder}</div>
      ) : null}
      {section.items.map((item) => (
        <SuggestionItem
          key={item.id}
          item={item}
          highlighted={item.id === highlightedId}
          onHighlight={onHighlight}
          onSelect={onSelect}
        />
      ))}
    </section>
  )
}

function SuggestionItem({
  highlighted,
  item,
  onHighlight,
  onSelect
}: {
  highlighted: boolean
  item: ComposerSuggestionItem
  onHighlight: (id: string) => void
  onSelect: (item: ComposerSuggestionItem) => void
}): React.JSX.Element {
  return (
    <button
      id={optionId(item.id)}
      type="button"
      role="option"
      aria-selected={highlighted}
      data-highlighted={highlighted}
      disabled={item.disabled}
      className={itemClassName}
      onMouseEnter={() => onHighlight(item.id)}
      onClick={() => onSelect(item)}
    >
      {item.icon ? <span className="size-4 shrink-0">{item.icon}</span> : null}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="max-w-[55%] shrink truncate">{item.label}</span>
        {item.description ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function optionId(itemId: string): string {
  return `composer-suggestion-option-${itemId.replaceAll(/[^a-zA-Z0-9_-]/gu, '-')}`
}
