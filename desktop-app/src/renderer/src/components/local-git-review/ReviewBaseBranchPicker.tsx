import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { GitBranchIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'

import type { LocalBranchSummary, LocalGitTarget } from '../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'

type Props = {
  target?: LocalGitTarget
  pendingBranch?: string
  onSelectBranch(branch: string, sourceBranch: string): void
  onCancel(): void
  onError?(message: string): void
}

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; summary: LocalBranchSummary }
  | { status: 'error'; message: string }

export function ReviewBaseBranchPicker({
  target,
  pendingBranch,
  onSelectBranch,
  onCancel,
  onError
}: Props): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: target ? 'loading' : 'idle' })

  const loadBranches = useCallback(async () => {
    if (!target) {
      setState({ status: 'idle' })
      return
    }
    setState({ status: 'loading' })
    try {
      const summary = await window.desktopApp.git.listBranches({ target })
      setState({ status: 'ready', summary })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load branches'
      setState({ status: 'error', message })
      onError?.(message)
    }
  }, [onError, target])

  useEffect(() => {
    let active = true
    const run = async (): Promise<void> => {
      if (!target) {
        if (active) setState({ status: 'idle' })
        return
      }
      if (active) setState({ status: 'loading' })
      try {
        const summary = await window.desktopApp.git.listBranches({ target })
        if (active) setState({ status: 'ready', summary })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unable to load branches'
        if (active) {
          setState({ status: 'error', message })
          onError?.(message)
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [onError, target])

  const branches = useMemo(() => {
    if (state.status !== 'ready') return []
    const ordered = [
      state.summary.defaultBase,
      ...state.summary.recent,
      ...state.summary.local
    ].filter((branch): branch is string => Boolean(branch))
    return [...new Set(ordered)]
  }, [state])

  return (
    <div data-slot="review-base-branch-picker" className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {state.status === 'error' ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => void loadBranches()}>
            <RefreshCwIcon className="size-3" />
            Retry
          </Button>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <p
          role="status"
          className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
        >
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Loading branches
        </p>
      ) : null}

      {state.status === 'idle' ? (
        <p role="alert" className="px-2 py-3 text-xs text-destructive">
          Unable to load branches
        </p>
      ) : null}

      {state.status === 'error' ? (
        isXcodeLicenseError(state.message) ? (
          <div
            role="alert"
            className="grid gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
          >
            <p className="font-medium">Git requires the Xcode license to be accepted.</p>
            <code className="rounded bg-background px-2 py-1">sudo xcodebuild -license</code>
            <div>
              <Button type="button" size="xs" variant="ghost" onClick={() => void loadBranches()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <p role="alert" className="px-2 py-3 text-xs text-destructive">
            {state.message}
          </p>
        )
      ) : null}

      {state.status === 'ready' && branches.length === 0 ? (
        <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
          No branches found
        </p>
      ) : null}

      {state.status === 'ready' ? (
        <div role="listbox" aria-label="Review base branches" className="grid gap-1">
          {branches.map((branch) => (
            <Button
              key={branch}
              type="button"
              role="option"
              aria-selected={branch === state.summary.current}
              variant="ghost"
              className="h-9 w-full justify-start px-3"
              disabled={Boolean(pendingBranch)}
              aria-busy={pendingBranch === branch}
              onClick={() => onSelectBranch(branch, state.summary.current ?? 'HEAD')}
              onKeyDown={(event) =>
                moveRovingFocus(event, event.currentTarget.parentElement, 'button[role="option"]')
              }
            >
              <GitBranchIcon className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {pendingBranch === branch ? 'Starting review…' : branch}
              </span>
              {branch === state.summary.defaultBase ? (
                <span className="text-xs text-muted-foreground">default</span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function isXcodeLicenseError(message: string): boolean {
  return /xcode/iu.test(message) && /license|agree|accept/iu.test(message)
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
