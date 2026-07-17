import type { Unstable_TriggerItem } from '@assistant-ui/react'
import {
  BotIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
  MessageSquareIcon,
  PackageIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SparklesIcon,
  WrenchIcon
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { LocalContextPickerKind } from '../../../../shared/codexIpcApi'
import {
  useComposerContextSuggestion,
  type ComposerContextSuggestionEntry
} from '@/composer/composerContextSuggestionController'
import { cn } from '@/lib/utils'

export type ComposerContextMenuSection = {
  id: string
  label: string
  items: readonly Unstable_TriggerItem[]
  error?: string | null
  loading?: boolean
  onRetry?: () => void
  preFiltered?: boolean
  showTitle?: boolean
  placeholder?: string
}

export type ComposerAddContextPopoverProps = {
  disabled?: boolean
  localPickerEnabled: boolean
  onQueryChange?: (query: string) => void
  onOpenChange?: (open: boolean) => void
  pickLocalContext: (kind: LocalContextPickerKind) => Promise<boolean>
  sections: readonly ComposerContextMenuSection[]
}

const contextMenuItemClassName =
  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-popover-foreground/75 transition-colors outline-none hover:bg-foreground/5 hover:text-popover-foreground focus-visible:bg-foreground/5 data-[highlighted=true]:bg-foreground/5 data-[highlighted=true]:text-popover-foreground dark:hover:bg-foreground/8 dark:focus-visible:bg-foreground/8 dark:data-[highlighted=true]:bg-foreground/8'

const contextItemIcons: Record<string, typeof FileIcon> = {
  folder: FolderIcon,
  chat: MessageSquareIcon,
  agent: BotIcon,
  agentRole: BotIcon,
  skill: SparklesIcon,
  plugin: PuzzleIcon,
  app: PackageIcon,
  tool: WrenchIcon
}

export function ComposerAddContextPopover({
  disabled = false,
  localPickerEnabled,
  onOpenChange,
  onQueryChange,
  pickLocalContext,
  sections
}: ComposerAddContextPopoverProps): React.JSX.Element {
  const { controller, state } = useComposerContextSuggestion()
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelMaxHeight, setPanelMaxHeight] = useState(320)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [isPicking, setIsPicking] = useState(false)
  const normalizedQuery = state.query.trim().toLocaleLowerCase()
  const visibleSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        items:
          section.preFiltered || !normalizedQuery
            ? section.items
            : section.items.filter((item) => fuzzyMatches(item, normalizedQuery))
      })),
    [normalizedQuery, sections]
  )
  const indexedSections = useMemo(() => {
    const firstSectionIndex = !normalizedQuery && localPickerEnabled ? 1 : 0
    return visibleSections.map((section, sectionIndex) => ({
      section,
      startIndex:
        firstSectionIndex +
        visibleSections
          .slice(0, sectionIndex)
          .reduce((itemCount, previous) => itemCount + previous.items.length, 0)
    }))
  }, [localPickerEnabled, normalizedQuery, visibleSections])

  useEffect(() => {
    if (!onQueryChange) return undefined
    if (!state.open) {
      onQueryChange('')
      return undefined
    }
    onQueryChange(state.query)
    return undefined
  }, [onQueryChange, state.open, state.query])

  useEffect(() => {
    onOpenChange?.(state.open)
  }, [onOpenChange, state.open])

  useLayoutEffect(() => {
    if (!state.open || !panelRef.current) return undefined
    const panel = panelRef.current
    const updatePanelLayout = (): void => {
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
      const availableHeight = Math.floor(panel.getBoundingClientRect().bottom - headerBottom - 8)
      setPanelMaxHeight(Math.min(320, Math.max(96, availableHeight)))
      panel.scrollTop = 0
    }
    updatePanelLayout()
    window.addEventListener('resize', updatePanelLayout)
    return () => window.removeEventListener('resize', updatePanelLayout)
  }, [state.open, state.query, state.source])

  const pick = useCallback(
    async (kind: LocalContextPickerKind): Promise<void> => {
      setPickerError(null)
      setIsPicking(true)
      try {
        if (!(await pickLocalContext(kind))) return
        controller.dismiss({ removeQuery: true })
      } catch (error) {
        setPickerError(error instanceof Error ? error.message : String(error))
      } finally {
        setIsPicking(false)
      }
    },
    [controller, pickLocalContext]
  )

  useEffect(() => {
    const entries: ComposerContextSuggestionEntry[] = []
    if (!normalizedQuery && localPickerEnabled) {
      entries.push({ id: 'add:files-and-folders', select: () => void pick('filesAndFolders') })
    }
    for (const { section } of indexedSections) {
      for (const item of section.items) {
        entries.push({ id: `${section.id}:${item.id}`, select: () => controller.selectItem(item) })
      }
    }
    controller.setNavigationEntries(entries)
    return () => controller.setNavigationEntries([])
  }, [controller, indexedSections, localPickerEnabled, normalizedQuery, pick])

  useEffect(() => {
    if (!state.open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest('[data-composer-context-keep-open]') ||
        target.closest('.aui-lexical-input')
      ) {
        return
      }
      controller.dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [controller, state.open])

  const localPickerIndex = !normalizedQuery && localPickerEnabled ? 0 : -1

  return (
    <div data-composer-context-keep-open>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={state.open}
        aria-haspopup="listbox"
        aria-label="添加文件和更多"
        title="添加文件和更多（@）"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => controller.togglePlus()}
        data-state={state.open ? 'open' : 'closed'}
        className="aui-composer-add-context inline-grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-foreground/8 data-[state=open]:bg-foreground/5 dark:data-[state=open]:bg-foreground/8"
      >
        <PlusIcon className="size-4.5 stroke-[1.75px]" />
      </button>

      {state.open ? (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="添加上下文"
          className="aui-composer-context-panel absolute right-0 bottom-full left-0 z-50 mb-3 overflow-y-auto rounded-2xl border border-border bg-popover/90 p-1 text-popover-foreground shadow-lg backdrop-blur-md"
          style={{ maxHeight: panelMaxHeight }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {!normalizedQuery ? (
            <ContextSection label="添加">
              {localPickerEnabled ? (
                <ContextActionItem
                  highlighted={state.highlightedIndex === localPickerIndex}
                  disabled={isPicking}
                  icon={isPicking ? Loader2Icon : FolderOpenIcon}
                  label="Files and folders"
                  onMouseEnter={() => controller.highlight(localPickerIndex)}
                  onSelect={() => void pick('filesAndFolders')}
                  spinning={isPicking}
                />
              ) : null}
            </ContextSection>
          ) : null}

          {pickerError ? <ContextAlert message={pickerError} /> : null}

          {indexedSections.map(({ section, startIndex }) => {
            if (
              !section.loading &&
              !section.error &&
              !section.placeholder &&
              section.items.length === 0
            ) {
              return null
            }

            return (
              <ContextSection
                key={section.id}
                label={section.label}
                showTitle={section.showTitle !== false}
              >
                {section.loading ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    {normalizedQuery ? '正在搜索…' : '正在加载…'}
                  </div>
                ) : null}
                {section.error ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-destructive">
                    <span className="min-w-0 flex-1 truncate">{section.error}</span>
                    {section.onRetry ? (
                      <button
                        type="button"
                        className="rounded-md p-1 hover:bg-destructive/10"
                        aria-label={`重试加载 ${section.label}`}
                        onClick={section.onRetry}
                      >
                        <RefreshCwIcon className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {section.placeholder ? (
                  <div className="px-2.5 py-2 text-sm text-muted-foreground">
                    {section.placeholder}
                  </div>
                ) : null}
                {section.items.map((item, itemIndex) => {
                  const index = startIndex + itemIndex
                  return (
                    <ContextItem
                      key={`${section.id}:${item.id}`}
                      item={item}
                      highlighted={state.highlightedIndex === index}
                      onMouseEnter={() => controller.highlight(index)}
                      onSelect={() => controller.selectItem(item)}
                    />
                  )
                })}
              </ContextSection>
            )
          })}

          {!isPicking &&
          !pickerError &&
          visibleSections.every(
            (section) =>
              !section.loading &&
              !section.error &&
              !section.placeholder &&
              section.items.length === 0
          ) &&
          (normalizedQuery || !localPickerEnabled) ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {normalizedQuery ? '没有结果' : '没有可引用的上下文'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ContextSection({
  children,
  label,
  showTitle = true
}: {
  children: React.ReactNode
  label: string
  showTitle?: boolean
}): React.JSX.Element {
  return (
    <section className="py-1" aria-label={label}>
      {showTitle ? (
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
          {label}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function ContextActionItem({
  disabled,
  highlighted,
  icon: Icon,
  label,
  onMouseEnter,
  onSelect,
  spinning = false
}: {
  disabled?: boolean
  highlighted: boolean
  icon: typeof FolderOpenIcon
  label: string
  onMouseEnter: () => void
  onSelect: () => void
  spinning?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={highlighted}
      data-highlighted={highlighted}
      disabled={disabled}
      className={contextMenuItemClassName}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
    >
      <Icon className={cn('size-4', spinning && 'animate-spin')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function ContextItem({
  highlighted,
  item,
  onMouseEnter,
  onSelect
}: {
  highlighted: boolean
  item: Unstable_TriggerItem
  onMouseEnter: () => void
  onSelect: () => void
}): React.JSX.Element {
  const Icon = contextItemIcons[item.type] ?? FileIcon
  return (
    <button
      type="button"
      role="option"
      aria-selected={highlighted}
      data-highlighted={highlighted}
      className={contextMenuItemClassName}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
    >
      <Icon className="size-4 shrink-0" />
      <span data-context-item-text className="flex min-w-0 flex-1 items-center gap-2">
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

function ContextAlert({ message }: { message: string }): React.JSX.Element {
  return (
    <div role="alert" className="px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

function fuzzyMatches(item: Unstable_TriggerItem, query: string): boolean {
  const haystack = [item.label, item.id, item.description]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  let queryIndex = 0
  for (const character of haystack) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}
