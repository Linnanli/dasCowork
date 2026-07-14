import { type Unstable_TriggerItem } from '@assistant-ui/react'
import {
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
  PlusIcon,
  WrenchIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { LocalContextPickerKind } from '../../../../shared/codexIpcApi'
import { type ComposerContextReferenceType } from '@/composer/composerContextDirectiveFormatter'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Card } from '@/components/ui/card'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

export type ComposerAddContextPopoverProps = {
  anchorElement: HTMLDivElement | null
  disabled?: boolean
  files: readonly Unstable_TriggerItem[]
  tools: readonly Unstable_TriggerItem[]
  isSearching: boolean
  localPickerEnabled: boolean
  onInsertItem: (item: Unstable_TriggerItem) => void
  onSearch: (query: string) => void
  pickLocalContext: (kind: LocalContextPickerKind) => Promise<boolean>
  searchError: string | null
  searchEnabled: boolean
}

const contextMenuItemClassName =
  'cursor-pointer rounded-lg px-2.5 py-2 text-popover-foreground/75 transition-colors hover:bg-foreground/5 hover:text-popover-foreground focus:bg-foreground/5 focus:text-popover-foreground data-[selected=true]:bg-foreground/5 data-[selected=true]:text-popover-foreground data-[selected=true]:opacity-100 dark:hover:bg-foreground/8 dark:focus:bg-foreground/8 dark:data-[selected=true]:bg-foreground/8'

export function ComposerAddContextPopover({
  anchorElement,
  disabled = false,
  files,
  tools,
  isSearching,
  localPickerEnabled,
  onInsertItem,
  onSearch,
  pickLocalContext,
  searchError,
  searchEnabled
}: ComposerAddContextPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [isPicking, setIsPicking] = useState(false)

  useEffect(() => {
    if (!open || !searchEnabled) return
    const timeout = window.setTimeout(() => onSearch(query), 150)
    return () => window.clearTimeout(timeout)
  }, [onSearch, open, query, searchEnabled])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setPickerError(null)
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '.aui-composer-input.aui-lexical-input, .aui-composer-input .aui-lexical-input'
        )
        ?.focus()
    })
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setOpen(true)
      return
    }
    close()
  }

  const toggle = (): void => {
    if (disabled) return
    setOpen((currentOpen) => !currentOpen)
  }

  const selectItem = (item: Unstable_TriggerItem): void => {
    onInsertItem(item)
    close()
  }

  const pick = async (kind: LocalContextPickerKind): Promise<void> => {
    setPickerError(null)
    setIsPicking(true)
    try {
      if (!(await pickLocalContext(kind))) return
      close()
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsPicking(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {anchorElement ? <PopoverAnchor virtualRef={{ current: anchorElement }} /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="添加文件和更多"
        title="添加文件和更多"
        onClick={toggle}
        data-state={open ? 'open' : 'closed'}
        className="aui-composer-add-context inline-grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-foreground/8 data-[state=open]:bg-foreground/5 dark:data-[state=open]:bg-foreground/8"
      >
        <PlusIcon className="size-4.5 stroke-[1.75px]" />
      </button>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        className="aui-composer-add-context-popover h-80 w-(--radix-popover-trigger-width) border-0 bg-transparent p-0 shadow-none"
      >
        <Card className="h-full gap-0 rounded-2xl border-border bg-popover/80 p-1 text-popover-foreground shadow-none backdrop-blur-sm">
          <Command
            shouldFilter={false}
            className="min-h-0 rounded-xl bg-transparent text-popover-foreground"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="搜索文件和工具"
              aria-label="搜索当前上下文"
            />
            <CommandList className="min-h-0 max-h-none flex-1">
              <CommandGroup heading="添加">
                {localPickerEnabled ? (
                  <CommandItem
                    disabled={isPicking}
                    value="local-files-and-folders"
                    onSelect={() => void pick('filesAndFolders')}
                    className={contextMenuItemClassName}
                  >
                    <FolderOpenIcon className="size-4" />
                    <span className="flex-1">选择文件文件夹</span>
                    {isPicking ? <Loader2Icon className="size-4 animate-spin" /> : null}
                  </CommandItem>
                ) : null}
              </CommandGroup>
              {pickerError ? <ContextAlert message={pickerError} /> : null}
              {searchError ? <ContextAlert message={searchError} /> : null}
              {isSearching ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  正在搜索…
                </div>
              ) : (
                <ContextSearchResults
                  files={files}
                  query={query}
                  tools={tools}
                  onSelect={selectItem}
                />
              )}
            </CommandList>
          </Command>
        </Card>
      </PopoverContent>
    </Popover>
  )
}

function ContextSearchResults({
  files,
  query,
  tools,
  onSelect
}: {
  files: readonly Unstable_TriggerItem[]
  query: string
  tools: readonly Unstable_TriggerItem[]
  onSelect: (item: Unstable_TriggerItem) => void
}): React.JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingFiles = files.filter((item) => matches(item, normalizedQuery))
  const matchingTools = tools.filter((item) => matches(item, normalizedQuery))
  const hasResults = matchingFiles.length > 0 || matchingTools.length > 0

  if (!hasResults) {
    return (
      <CommandEmpty>{normalizedQuery ? '没有匹配的文件或工具' : '没有可引用的上下文'}</CommandEmpty>
    )
  }

  return (
    <>
      {matchingFiles.length > 0 ? (
        <CommandGroup heading="文件">
          {matchingFiles.map((item) => (
            <ContextItem key={`file-${item.id}`} item={item} onSelect={onSelect} type="file" />
          ))}
        </CommandGroup>
      ) : null}
      {matchingTools.length > 0 ? (
        <CommandGroup heading="工具">
          {matchingTools.map((item) => (
            <ContextItem key={`tool-${item.id}`} item={item} onSelect={onSelect} type="tool" />
          ))}
        </CommandGroup>
      ) : null}
    </>
  )
}

function ContextItem({
  item,
  onSelect,
  type
}: {
  item: Unstable_TriggerItem
  onSelect: (item: Unstable_TriggerItem) => void
  type: ComposerContextReferenceType | 'tool'
}): React.JSX.Element {
  const Icon = type === 'tool' ? WrenchIcon : type === 'folder' ? FolderIcon : FileIcon
  return (
    <CommandItem
      value={`${item.label} ${item.id}`}
      onSelect={() => onSelect(item)}
      className={contextMenuItemClassName}
    >
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.description ? (
        <span className="max-w-32 truncate text-xs text-muted-foreground">{item.description}</span>
      ) : null}
    </CommandItem>
  )
}

function ContextAlert({ message }: { message: string }): React.JSX.Element {
  return (
    <div role="alert" className="px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

function matches(item: Unstable_TriggerItem, query: string): boolean {
  if (!query) return true
  return [item.id, item.label, item.description]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLocaleLowerCase().includes(query))
}
