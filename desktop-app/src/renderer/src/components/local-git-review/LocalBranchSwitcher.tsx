/* eslint-disable @typescript-eslint/explicit-function-return-type, react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
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

export function LocalBranchSwitcher({
  target
}: {
  target?: LocalGitTarget
}): React.JSX.Element | null {
  const {
    finishGitWorkflow,
    getGitWorkflow,
    notifyGitOperation,
    startGitWorkflow,
    updateGitWorkflow
  } = useLocalGitReview()
  const [open, setOpen] = useState(false)
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
  const switcherRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const feedbackId = target ? `branch-operation:${target.hostId}:${target.cwd}` : 'branch-operation'

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

  useEffect(() => {
    if (!target || !open) return
    void loadBranches()
  }, [loadBranches, open, target])

  useEffect(() => {
    if (!open) return undefined
    const closeWhenPointerLeaves = (event: PointerEvent): void => {
      if (switcherRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeWhenPointerLeaves)
    return () => document.removeEventListener('pointerdown', closeWhenPointerLeaves)
  }, [open])

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
    setPendingBranch(branch)
    setError(undefined)
    const continuation: BranchContinuation = { kind: 'checkout', branch }
    try {
      const result = await window.desktopApp.git.checkoutBranch({ target, branch })
      if (result.status === 'success') {
        setSummary((current) => (current ? { ...current, current: result.current } : current))
        setOpen(false)
        setQuery('')
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
      setPendingBranch(undefined)
    }
  }

  const createBranch = async (branch: string) => {
    if (!target) return
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
        setOpen(false)
        setQuery('')
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
        setOpen(false)
        setQuery('')
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

  if (!target) return null

  const currentLabel = summary?.current ?? 'Branch'
  const commitWorkflow = getGitWorkflow(target)

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
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranchIcon className="size-3.5" />
        <span className="max-w-36 truncate">{currentLabel}</span>
        <ChevronDownIcon className="size-3" />
      </Button>
      {open ? (
        <div
          id="local-branch-switcher-popover"
          role="dialog"
          aria-label="Switch branch"
          className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border bg-popover p-2 shadow-lg"
        >
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
            <Input
              aria-label="Search branches"
              className="h-8 rounded-md pl-7 text-xs"
              placeholder="Search branches"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false)
                  triggerRef.current?.focus()
                }
              }}
            />
          </div>
          {error ? (
            <div
              role="alert"
              className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
            >
              <p>{error}</p>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="mt-1"
                onClick={() => void loadBranches()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {loading ? (
            <p role="status" className="flex items-center gap-1 p-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" /> Loading branches
            </p>
          ) : null}
          {!loading && !error ? (
            <div
              data-slot="local-branch-list"
              role="listbox"
              aria-label="Local branches"
              className="mt-2 max-h-72 overflow-y-auto"
            >
              {searching ? (
                <p
                  role="status"
                  className="flex items-center gap-1 p-2 text-xs text-muted-foreground"
                >
                  <LoaderCircleIcon className="size-3 animate-spin" /> Searching branches
                </p>
              ) : null}
              {rows.map((row) => (
                <button
                  key={row.branch}
                  type="button"
                  role="option"
                  aria-selected={row.isCurrent}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted focus:outline-none',
                    row.isCurrent && 'bg-muted'
                  )}
                  disabled={Boolean(pendingBranch) || commitWorkflow !== undefined}
                  onClick={() => void checkoutBranch(row.branch)}
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
                  {pendingBranch === row.branch ? (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  ) : row.isCurrent ? (
                    <CheckIcon className="size-3.5" />
                  ) : null}
                </button>
              ))}
              {!searching && rows.length === 0 ? (
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
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon className="size-3.5" /> Create and checkout new branch…
            </Button>
          </div>
        </div>
      ) : null}
      <BranchCreateDialog
        open={createOpen}
        existingBranches={summary?.local ?? []}
        pending={Boolean(pendingBranch) || commitWorkflow !== undefined}
        error={error}
        onOpenChange={setCreateOpen}
        onCreate={(branch) => createBranch(branch)}
        onError={setError}
      />
      <BranchSwitchBlockedDialog
        open={Boolean(blocked) && !commitOpen}
        branch={blocked?.continuation.branch ?? ''}
        conflictedPaths={blocked?.conflictedPaths ?? []}
        message={blocked?.message}
        onCancel={() => setBlocked(undefined)}
        onCommit={() => void openCommitDialog()}
      />
      <CommitOrPushDialog
        open={commitOpen}
        status={commitStatus}
        mode="commit-before-switch"
        pending={commitWorkflow !== undefined}
        onOpenChange={(nextOpen) => {
          setCommitOpen(nextOpen)
          if (!nextOpen) triggerRef.current?.focus()
        }}
        onAction={({ action, message, includeUnstaged }) => {
          if (action !== 'commit') throw new Error('Unsupported branch switch action')
          return commitAndRetry(message, includeUnstaged)
        }}
      />
    </div>
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
