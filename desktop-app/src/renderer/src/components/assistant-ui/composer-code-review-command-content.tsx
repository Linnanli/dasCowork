import { AlertCircleIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalBranchSummary, LocalGitTarget } from '../../../../shared/localGitApi'
import { useComposerSuggestionPanelMaxHeight } from './composer-suggestion-panel-layout'

export type ComposerReviewSelection =
  | { type: 'uncommitted' }
  | { type: 'base-branch'; sourceBranch: string; baseBranch: string }

export type ComposerCodeReviewCommandContentProps = {
  disabled?: boolean
  target?: LocalGitTarget
  onSubmit(selection: ComposerReviewSelection): void | Promise<void>
}

type BranchState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; summary: LocalBranchSummary }
  | { type: 'unavailable' }

/** Slash-command content for choosing a code-review scope while keeping the editor visible. */
export function ComposerCodeReviewCommandContent({
  disabled = false,
  target,
  onSubmit
}: ComposerCodeReviewCommandContentProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const panelMaxHeight = useComposerSuggestionPanelMaxHeight(panelRef)
  const [state, setState] = useState<{ key: string; value: BranchState }>({
    key: '',
    value: target ? { type: 'loading' } : { type: 'unavailable' }
  })
  const [revision, setRevision] = useState(0)
  const [pendingSelection, setPendingSelection] = useState<ComposerReviewSelection>()
  const [submitError, setSubmitError] = useState<string>()
  const requestKey = `${reviewTargetKey(target)}:${revision}`

  useEffect(() => {
    let current = true
    if (!target) return undefined

    void window.desktopApp.git
      .listBranches({ target })
      .then((summary) => {
        if (current) setState({ key: requestKey, value: { type: 'ready', summary } })
      })
      .catch((cause: unknown) => {
        if (!current) return
        setState({
          key: requestKey,
          value: {
            type: 'error',
            message: cause instanceof Error ? cause.message : '无法加载 Git 分支'
          }
        })
      })

    return () => {
      current = false
    }
  }, [requestKey, target])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const submit = useCallback(
    async (selection: ComposerReviewSelection): Promise<void> => {
      setSubmitError(undefined)
      setPendingSelection(selection)
      try {
        await onSubmit(selection)
      } catch (cause) {
        setSubmitError(cause instanceof Error ? cause.message : '无法开始代码审查')
      } finally {
        setPendingSelection(undefined)
      }
    },
    [onSubmit]
  )

  const visibleState: BranchState =
    state.key === requestKey ? state.value : target ? { type: 'loading' } : { type: 'unavailable' }
  const branches =
    visibleState.type === 'ready'
      ? [
          visibleState.summary.defaultBase,
          ...visibleState.summary.recent,
          ...visibleState.summary.local
        ].filter((branch): branch is string => Boolean(branch))
      : []
  const uniqueBranches = [...new Set(branches)]
  const submitting = Boolean(pendingSelection)

  return (
    <div
      ref={panelRef}
      data-testid="composer-suggestion-panel"
      data-slot="composer-code-review-command-content"
      data-composer-suggestion-keep-open
      className="aui-composer-context-panel absolute right-0 bottom-full left-0 z-50 mb-3 overflow-y-auto rounded-2xl border border-border bg-popover/90 p-2 text-popover-foreground shadow-lg backdrop-blur-md"
      style={{ maxHeight: panelMaxHeight }}
    >
      <button
        type="button"
        className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-foreground/8 dark:focus-visible:bg-foreground/8"
        disabled={disabled || submitting}
        aria-busy={pendingSelection?.type === 'uncommitted'}
        onClick={() => void submit({ type: 'uncommitted' })}
      >
        {pendingSelection?.type === 'uncommitted' ? '正在开始审查…' : '审查未提交的更改'}
      </button>

      <section className="pt-2" aria-label="基于基础分支进行审查">
        <div className="px-3 pb-1 text-sm font-medium text-muted-foreground">
          基于基础分支进行审查
        </div>
        {visibleState.type === 'loading' ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            正在加载分支…
          </div>
        ) : null}
        {visibleState.type === 'unavailable' ? (
          <div role="alert" className="px-3 py-2 text-sm text-destructive">
            当前会话没有可审核的 Git 仓库
          </div>
        ) : null}
        {visibleState.type === 'error' ? (
          <div role="alert" className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{visibleState.message}</span>
            <button
              type="button"
              className="rounded-md p-1 hover:bg-destructive/10"
              aria-label="重试加载 Git 分支"
              onClick={retry}
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
        {visibleState.type === 'ready' && uniqueBranches.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">没有可用分支</div>
        ) : null}
        {visibleState.type === 'ready'
          ? uniqueBranches.map((branch) => {
              const pending =
                pendingSelection?.type === 'base-branch' && pendingSelection.baseBranch === branch
              return (
                <button
                  key={branch}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-foreground/8 dark:focus-visible:bg-foreground/8"
                  disabled={disabled || submitting}
                  aria-busy={pending}
                  onClick={() =>
                    void submit({
                      type: 'base-branch',
                      sourceBranch: visibleState.summary.current ?? 'HEAD',
                      baseBranch: branch
                    })
                  }
                >
                  <span className="min-w-0 flex-1 truncate">
                    {pending ? '正在开始审查…' : branch}
                  </span>
                  {branch === visibleState.summary.defaultBase ? (
                    <span className="text-xs text-muted-foreground">默认</span>
                  ) : null}
                </button>
              )
            })
          : null}
      </section>

      {submitError ? (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircleIcon className="size-4 shrink-0" />
          {submitError}
        </div>
      ) : null}
    </div>
  )
}

function reviewTargetKey(target: LocalGitTarget | undefined): string {
  if (!target) return 'unavailable'
  return [target.conversationId, target.threadId, target.hostId, target.cwd, target.gitRoot].join(
    ':'
  )
}
