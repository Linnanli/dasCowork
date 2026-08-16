/* eslint-disable @typescript-eslint/explicit-function-return-type, react-hooks/set-state-in-effect, react-refresh/only-export-components */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject
} from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon
} from 'lucide-react'

import type {
  LocalBranchCheckoutResult,
  LocalBranchSearchResult,
  LocalBranchSummary,
  LocalGitTarget
} from '../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { BranchCreateDialog } from './BranchCreateDialog'
import { BranchSwitchBlockedDialog } from './BranchSwitchBlockedDialog'
import { useLocalGitReview } from './LocalGitReviewProvider'
import {
  CommitOrPushDialog,
  type CommitOrPushDialogStatus
} from '../right-workspace/review/CommitOrPushDialog'

type BranchContinuation = {
  kind: 'checkout' | 'create-and-checkout'
  branch: string
}

type BranchRow = {
  branch: string
  isCurrent: boolean
  isDefault: boolean
  isRecent: boolean
  uncommittedFileCount: number
}

type BranchMenuController = {
  target?: LocalGitTarget
  summary?: LocalBranchSummary
  query: string
  searchResults: LocalBranchSearchResult[]
  rows: BranchRow[]
  loading: boolean
  searching: boolean
  error?: string
  pendingBranch?: string
  createOpen: boolean
  commitStatus?: CommitOrPushDialogStatus
  blocked?: {
    continuation: BranchContinuation
    conflictedPaths: string[]
    message?: string
  }
  commitOpen: boolean
  commitWorkflow: ReturnType<ReturnType<typeof useLocalGitReview>['getGitWorkflow']>
  currentLabel: string
  setQuery: (query: string) => void
  setCreateOpen: (open: boolean) => void
  setCommitOpen: (open: boolean) => void
  setBlocked: (blocked: undefined) => void
  setError: (error: string | undefined) => void
  loadBranches: () => Promise<void>
  checkoutBranch: (branch: string) => Promise<void>
  createBranch: (branch: string) => Promise<void>
  openCommitDialog: () => Promise<void>
  commitAndRetry: (message: string, includeUnstaged: boolean) => Promise<void>
  resetMenu: () => void
}

export function useBranchMenuController({
  open,
  target,
  onRequestClose
}: {
  open: boolean
  target?: LocalGitTarget
  onRequestClose?: () => void
}): BranchMenuController {
  const {
    finishGitWorkflow,
    getGitWorkflow,
    notifyGitOperation,
    startGitWorkflow,
    updateGitWorkflow
  } = useLocalGitReview()
  const [summary, setSummary] = useState<LocalBranchSummary>()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LocalBranchSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string>()
  const [pendingBranch, setPendingBranch] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const [commitStatus, setCommitStatus] = useState<CommitOrPushDialogStatus>()
  const [blocked, setBlocked] = useState<{
    continuation: BranchContinuation
    conflictedPaths: string[]
    message?: string
  }>()
  const [commitOpen, setCommitOpen] = useState(false)
  const feedbackId = target ? `branch-operation:${target.hostId}:${target.cwd}` : 'branch-operation'
  const commitWorkflow = target ? getGitWorkflow(target) : undefined

  const loadBranches = useCallback(async () => {
    if (!target) return
    setLoading(true)
    setError(undefined)
    try {
      setSummary(await window.desktopApp.git.listBranches({ target }))
    } catch (cause) {
      setSummary(undefined)
      setError(cause instanceof Error ? cause.message : 'Unable to load branches')
    } finally {
      setLoading(false)
    }
  }, [target])

  const resetMenu = useCallback(() => {
    setQuery('')
    setSearchResults([])
  }, [])

  useEffect(() => {
    if (!target || !open) return
    void loadBranches()
  }, [loadBranches, open, target])

  useEffect(() => {
    let active = true
    const trimmed = query.trim()
    if (!target || !open || trimmed.length === 0) {
      setSearchResults([])
      setSearching(false)
      return () => {
        active = false
      }
    }
    setSearching(true)
    void window.desktopApp.git
      .searchBranches({ target, query: trimmed })
      .then((results) => {
        if (active) setSearchResults(results)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to search branches')
      })
      .finally(() => {
        if (active) setSearching(false)
      })
    return () => {
      active = false
    }
  }, [open, query, target])

  const rows = useMemo(() => {
    if (!summary) return []
    if (query.trim()) return searchResults.map(searchResultToRow)
    return rowsFromSummary(summary)
  }, [query, searchResults, summary])

  const handleBlocked = (continuation: BranchContinuation, result: LocalBranchCheckoutResult) => {
    if (result.status !== 'error') return false
    if (result.errorCode !== 'blocked-by-working-tree-changes') return false
    setBlocked({
      continuation,
      conflictedPaths: result.conflictedPaths,
      message: result.message
    })
    notifyGitOperation({
      id: feedbackId,
      tone: 'info',
      message: `Commit changes before switching to ${continuation.branch}.`
    })
    return true
  }

  const retryContinuation = async (
    continuation: BranchContinuation
  ): Promise<LocalBranchCheckoutResult> => {
    if (!target) throw new Error('Missing local git target')
    return window.desktopApp.git.checkoutBranch({ target, branch: continuation.branch })
  }

  const checkoutBranch = async (branch: string) => {
    if (!target || branch === summary?.current) return
    if (!startGitWorkflow(target, { kind: 'branch-switch', phase: 'switching-branch' })) {
      notifyGitOperation({
        id: feedbackId,
        tone: 'info',
        message: 'A Git operation is already in progress for this repository.'
      })
      return
    }
    setPendingBranch(branch)
    setError(undefined)
    const continuation: BranchContinuation = { kind: 'checkout', branch }
    try {
      const result = await window.desktopApp.git.checkoutBranch({ target, branch })
      if (result.status === 'success') {
        setSummary((current) => (current ? { ...current, current: result.current } : current))
        onRequestClose?.()
        resetMenu()
        notifyGitOperation({
          id: feedbackId,
          tone: 'success',
          message: `Switched to ${result.current}.`
        })
      } else if (!handleBlocked(continuation, result)) {
        const message = result.message ?? result.errorCode
        setError(message)
        notifyGitOperation({ id: feedbackId, tone: 'error', message })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to switch branch'
      setError(message)
      notifyGitOperation({ id: feedbackId, tone: 'error', message })
    } finally {
      finishGitWorkflow(target)
      setPendingBranch(undefined)
    }
  }

  const createBranch = async (branch: string) => {
    if (!target) return
    if (!startGitWorkflow(target, { kind: 'branch-switch', phase: 'creating-branch' })) {
      notifyGitOperation({
        id: feedbackId,
        tone: 'info',
        message: 'A Git operation is already in progress for this repository.'
      })
      return
    }
    setPendingBranch(branch)
    setError(undefined)
    const continuation: BranchContinuation = { kind: 'create-and-checkout', branch }
    try {
      const result = await window.desktopApp.git.createBranch({
        target,
        branch,
        failIfExists: true
      })
      if (result.status === 'success') {
        setSummary((current) =>
          current
            ? {
                ...current,
                current: result.current,
                local: current.local.includes(result.current)
                  ? current.local
                  : [result.current, ...current.local]
              }
            : current
        )
        setCreateOpen(false)
        onRequestClose?.()
        resetMenu()
        notifyGitOperation({
          id: feedbackId,
          tone: 'success',
          message: `Created and switched to ${result.current}.`
        })
      } else if (handleBlocked(continuation, result)) {
        setCreateOpen(false)
      } else {
        throw new Error(result.message ?? result.errorCode)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to create branch'
      setError(message)
      notifyGitOperation({ id: feedbackId, tone: 'error', message })
    } finally {
      finishGitWorkflow(target)
      setPendingBranch(undefined)
    }
  }

  const openCommitDialog = async () => {
    if (!target) return
    setCommitOpen(true)
    setError(undefined)
    try {
      setCommitStatus(await window.desktopApp.git.getPublishStatus({ target }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to refresh changes'
      setError(message)
      notifyGitOperation({ id: feedbackId, tone: 'error', message })
    }
  }

  const commitAndRetry = async (message: string, includeUnstaged: boolean) => {
    if (!target || !blocked) throw new Error('Missing blocked branch switch')
    if (!startGitWorkflow(target, { kind: 'commit-and-switch', phase: 'committing' })) {
      const duplicateMessage = 'A commit is already in progress for this repository.'
      notifyGitOperation({ id: feedbackId, tone: 'info', message: duplicateMessage })
      throw new Error(duplicateMessage)
    }
    try {
      const commitResult = await window.desktopApp.git.commitChanges({
        target,
        message: message.trim(),
        includeUnstaged
      })
      if (commitResult.status !== 'success') {
        throw new Error(commitResult.message ?? commitResult.status)
      }
      updateGitWorkflow(target, { kind: 'commit-and-switch', phase: 'switching-branch' })
      const retryResult = await retryContinuation(blocked.continuation)
      if (retryResult.status === 'success') {
        setSummary((current) =>
          current
            ? {
                ...current,
                current: retryResult.current,
                uncommittedFileCount: 0
              }
            : current
        )
        setBlocked(undefined)
        setCommitOpen(false)
        onRequestClose?.()
        resetMenu()
        notifyGitOperation({
          id: feedbackId,
          tone: 'success',
          message: `Committed changes and switched to ${retryResult.current}.`
        })
        return
      }
      if (retryResult.errorCode === 'blocked-by-working-tree-changes') {
        setBlocked({
          continuation: blocked.continuation,
          conflictedPaths: retryResult.conflictedPaths,
          message: retryResult.message
        })
        throw new Error(retryResult.message ?? 'Branch switch is still blocked')
      }
      throw new Error(retryResult.message ?? retryResult.errorCode)
    } catch (cause) {
      const failureMessage = cause instanceof Error ? cause.message : 'Unable to commit changes'
      notifyGitOperation({ id: feedbackId, tone: 'error', message: failureMessage })
      throw cause
    } finally {
      finishGitWorkflow(target)
    }
  }

  const currentLabel = summary?.current ?? 'Branch'

  return {
    target,
    summary,
    query,
    searchResults,
    rows,
    loading,
    searching,
    error,
    pendingBranch,
    createOpen,
    commitStatus,
    blocked,
    commitOpen,
    commitWorkflow,
    currentLabel,
    setQuery,
    setCreateOpen,
    setCommitOpen,
    setBlocked,
    setError,
    loadBranches,
    checkoutBranch,
    createBranch,
    openCommitDialog,
    commitAndRetry,
    resetMenu
  }
}

export function LocalBranchSwitcher({
  target
}: {
  target?: LocalGitTarget
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const controller = useBranchMenuController({
    open,
    target,
    onRequestClose: () => setOpen(false)
  })

  useEffect(() => {
    if (!open) return undefined
    const closeWhenPointerLeaves = (event: PointerEvent): void => {
      if (switcherRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeWhenPointerLeaves)
    return () => document.removeEventListener('pointerdown', closeWhenPointerLeaves)
  }, [open])

  if (!target) return null

  return (
    <div
      ref={switcherRef}
      data-slot="local-branch-switcher"
      className="relative"
      onBlur={(event) => {
        if (switcherRef.current?.contains(event.relatedTarget)) return
        setOpen(false)
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        size="xs"
        variant="ghost"
        aria-expanded={open}
        aria-controls="local-branch-switcher-popover"
        title="Switch branch"
        disabled={controller.commitWorkflow !== undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranchIcon className="size-3.5" />
        <span className="max-w-36 truncate">{controller.currentLabel}</span>
        <ChevronDownIcon className="size-3" />
      </Button>
      {open ? (
        <BranchMenuContent
          id="local-branch-switcher-popover"
          controller={controller}
          role="dialog"
          ariaLabel="Switch branch"
          className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border bg-popover p-2 shadow-lg"
          searchPlaceholder="Search branches"
          autoFocusSearch
          onEscape={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        />
      ) : null}
      <BranchMenuDialogs controller={controller} restoreFocusRef={triggerRef} />
    </div>
  )
}

export function BranchMenuContent({
  id,
  controller,
  role,
  ariaLabel,
  className,
  searchPlaceholder = 'Search branches',
  autoFocusSearch = false,
  onEscape
}: {
  id?: string
  controller: BranchMenuController
  role?: 'dialog'
  ariaLabel?: string
  className?: string
  searchPlaceholder?: string
  autoFocusSearch?: boolean
  onEscape?: () => void
}): React.JSX.Element {
  return (
    <div id={id} role={role} aria-label={ariaLabel} className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
        <Input
          aria-label="Search branches"
          className="h-8 rounded-md pl-7 text-xs"
          placeholder={searchPlaceholder}
          value={controller.query}
          autoFocus={autoFocusSearch}
          onChange={(event) => controller.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onEscape?.()
          }}
        />
      </div>
      {controller.error ? (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <p>{controller.error}</p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="mt-1"
            onClick={() => void controller.loadBranches()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {controller.loading ? (
        <p role="status" className="flex items-center gap-1 p-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin" /> Loading branches
        </p>
      ) : null}
      {!controller.loading && !controller.error ? (
        <div
          data-slot="local-branch-list"
          role="listbox"
          aria-label="Local branches"
          className="mt-2 max-h-72 overflow-y-auto"
        >
          {controller.searching ? (
            <p role="status" className="flex items-center gap-1 p-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" /> Searching branches
            </p>
          ) : null}
          {controller.rows.map((row) => (
            <button
              key={row.branch}
              type="button"
              role="option"
              aria-selected={row.isCurrent}
              title={row.branch}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted focus:outline-none',
                row.isCurrent && 'bg-muted'
              )}
              disabled={
                Boolean(controller.pendingBranch) || controller.commitWorkflow !== undefined
              }
              onClick={() => void controller.checkoutBranch(row.branch)}
              onKeyDown={(event) =>
                moveRovingFocus(
                  event,
                  event.currentTarget.closest('[data-slot="local-branch-list"]'),
                  'button[role="option"]'
                )
              }
            >
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{row.branch}</span>
                {row.isDefault || row.isRecent || row.uncommittedFileCount > 0 ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {branchMeta(row)}
                  </span>
                ) : null}
              </span>
              {controller.pendingBranch === row.branch ? (
                <LoaderCircleIcon className="size-3 animate-spin" />
              ) : row.isCurrent ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </button>
          ))}
          {!controller.searching && controller.rows.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No branches found</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 border-t pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          disabled={controller.commitWorkflow !== undefined}
          onClick={() => controller.setCreateOpen(true)}
        >
          <PlusIcon className="size-3.5" /> Create and checkout new branch…
        </Button>
      </div>
    </div>
  )
}

export function BranchMenuContentForTarget({
  open,
  target,
  onRequestClose,
  ...contentProps
}: Omit<Parameters<typeof BranchMenuContent>[0], 'controller'> & {
  open: boolean
  target?: LocalGitTarget
  onRequestClose?: () => void
}): React.JSX.Element {
  const controller = useBranchMenuController({ open, target, onRequestClose })
  return <BranchMenuContent {...contentProps} controller={controller} />
}

/**
 * The summary panel uses the exact branch state machine as the composer
 * switcher, but lets Radix own pointer grace and keyboard transitions between
 * the parent panel and its left-opening submenu.
 */
export function LocalBranchSubmenu({
  target,
  branch
}: {
  target?: LocalGitTarget
  branch?: string | null
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const controller = useBranchMenuController({
    open,
    target,
    onRequestClose: () => setOpen(false)
  })

  useEffect(() => {
    if (controller.createOpen || controller.commitOpen || controller.blocked) setOpen(false)
  }, [controller.blocked, controller.commitOpen, controller.createOpen])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || !contentRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [open])

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        ref={triggerRef}
        data-slot="conversation-pinned-summary-branch"
        disabled={!target}
        title={branch ?? 'Git 分支不可用'}
        className="h-10 w-full rounded-xl px-2.5 text-sm"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-left">当前分支</span>
        <span className="max-w-28 truncate text-xs text-muted-foreground">
          {branch ?? '不可用'}
        </span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={contentRef}
        data-slot="conversation-pinned-summary-branch-submenu"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[300px] rounded-2xl p-2"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft') return
          event.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
        }}
      >
        <div dir="ltr">
          <BranchMenuContent
            controller={controller}
            searchPlaceholder={`搜索 ${repositoryName(target)} 分支`}
            onEscape={() => setOpen(false)}
          />
        </div>
      </DropdownMenuSubContent>
      <BranchMenuDialogs controller={controller} restoreFocusRef={triggerRef} />
    </DropdownMenuSub>
  )
}

export function BranchMenuDialogs({
  controller,
  restoreFocusRef
}: {
  controller: BranchMenuController
  restoreFocusRef?: RefObject<HTMLElement | null>
}): React.JSX.Element {
  return (
    <>
      <BranchCreateDialog
        open={controller.createOpen}
        existingBranches={controller.summary?.local ?? []}
        pending={Boolean(controller.pendingBranch) || controller.commitWorkflow !== undefined}
        error={controller.error}
        onOpenChange={controller.setCreateOpen}
        onCreate={(branch) => controller.createBranch(branch)}
        onError={controller.setError}
      />
      <BranchSwitchBlockedDialog
        open={Boolean(controller.blocked) && !controller.commitOpen}
        branch={controller.blocked?.continuation.branch ?? ''}
        conflictedPaths={controller.blocked?.conflictedPaths ?? []}
        message={controller.blocked?.message}
        onCancel={() => controller.setBlocked(undefined)}
        onCommit={() => void controller.openCommitDialog()}
      />
      <CommitOrPushDialog
        open={controller.commitOpen}
        status={controller.commitStatus}
        mode="commit-before-switch"
        pending={controller.commitWorkflow !== undefined}
        onOpenChange={(nextOpen) => {
          controller.setCommitOpen(nextOpen)
          if (!nextOpen) restoreFocusRef?.current?.focus()
        }}
        onAction={({ action, message, includeUnstaged }) => {
          if (action !== 'commit') throw new Error('Unsupported branch switch action')
          return controller.commitAndRetry(message, includeUnstaged)
        }}
      />
    </>
  )
}

function rowsFromSummary(summary: LocalBranchSummary): BranchRow[] {
  const rows = new Map<string, BranchRow>()
  const add = (branch: string, recent = false) => {
    const current = rows.get(branch)
    rows.set(branch, {
      branch,
      isCurrent: branch === summary.current,
      isDefault: branch === summary.defaultBase,
      isRecent: recent || current?.isRecent === true,
      uncommittedFileCount: branch === summary.current ? summary.uncommittedFileCount : 0
    })
  }
  if (summary.defaultBase) add(summary.defaultBase)
  if (summary.current) add(summary.current)
  for (const branch of summary.recent) add(branch, true)
  for (const branch of summary.local) add(branch)
  return [...rows.values()]
}

function searchResultToRow(result: LocalBranchSearchResult): BranchRow {
  return {
    branch: result.branch,
    isCurrent: result.isCurrent,
    isDefault: result.isDefault,
    isRecent: result.isRecent,
    uncommittedFileCount: result.uncommittedFileCount
  }
}

function branchMeta(row: BranchRow): string {
  const parts: string[] = []
  if (row.isDefault) parts.push('Default')
  if (row.isRecent) parts.push('Recent')
  if (row.uncommittedFileCount > 0) parts.push(`Uncommitted: ${row.uncommittedFileCount} files`)
  return parts.join(' · ')
}

function repositoryName(target: LocalGitTarget | undefined): string {
  if (!target) return '仓库'
  const path = target.gitRoot || target.cwd
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? '仓库'
}

function moveRovingFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  selector: string
): void {
  const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!direction || !container) return

  const candidates = [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (candidate) => !candidate.matches(':disabled')
  )
  const currentIndex = candidates.indexOf(event.currentTarget)
  if (currentIndex < 0 || candidates.length === 0) return
  event.preventDefault()
  candidates[(currentIndex + direction + candidates.length) % candidates.length]?.focus()
}
