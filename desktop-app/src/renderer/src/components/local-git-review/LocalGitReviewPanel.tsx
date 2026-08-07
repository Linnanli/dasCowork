/* eslint-disable react-hooks/set-state-in-effect -- effects synchronize asynchronously loaded Git snapshots with the panel. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'

import type {
  LocalBranchSummary,
  LocalGitCommitSummary,
  LocalGitMutationResult,
  LocalGitReviewFile,
  LocalGitReviewFileTarget,
  LocalGitReviewSource,
  LocalGitReviewSnapshot,
  LocalGitTarget
} from '../../../../shared/localGitApi'
import { LOCAL_GIT_REVIEW_MUTATION_MAX_FILES } from '../../../../shared/localGitApi'
import { DiffViewer } from '@/components/assistant-ui/diff-viewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { LocalGitOperationFeedback, LocalGitReviewLastTurn } from './LocalGitReviewProvider'

type Props = {
  open: boolean
  target?: LocalGitTarget
  source: LocalGitReviewSource
  lastTurn?: LocalGitReviewLastTurn
  onClose(): void
  onSourceChange(source: LocalGitReviewSource): void
  onGitOperationFeedback?(feedback: LocalGitOperationFeedback): void
}

const sourceLabels: Record<LocalGitReviewSource['type'], string> = {
  unstaged: 'Unstaged',
  staged: 'Staged',
  commit: 'Commit',
  branch: 'Branch',
  'last-turn': 'Last turn'
}

type ReviewMutationScope = 'section' | 'file' | 'hunk'

type FrozenReviewMutationTarget = {
  target: LocalGitTarget
  source: LocalGitReviewSource
  snapshotGeneration: string
  scope: ReviewMutationScope
  hunkIndex?: number
  files: LocalGitReviewFileTarget[]
}

export function LocalGitReviewPanel({
  open,
  target,
  source,
  lastTurn,
  onClose,
  onSourceChange,
  onGitOperationFeedback
}: Props): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<LocalGitReviewSnapshot>()
  const [selectedFile, setSelectedFile] = useState<LocalGitReviewFile>()
  const [diff, setDiff] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const [mutationFeedback, setMutationFeedback] = useState<string>()
  const [pending, setPending] = useState(false)
  const [showFiles, setShowFiles] = useState(true)
  const [fileQuery, setFileQuery] = useState('')
  const [split, setSplit] = useState(false)
  const [diffsCollapsed, setDiffsCollapsed] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [pendingRevertTarget, setPendingRevertTarget] = useState<FrozenReviewMutationTarget>()
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [sourcePicker, setSourcePicker] = useState<'commit' | 'branch'>()
  const [sourcePickerLoading, setSourcePickerLoading] = useState(false)
  const [sourcePickerError, setSourcePickerError] = useState<string>()
  const [commits, setCommits] = useState<LocalGitCommitSummary[]>([])
  const [branchSummary, setBranchSummary] = useState<LocalBranchSummary>()
  const loadRequestId = useRef(0)

  const load = useCallback(
    async (refresh = false): Promise<void> => {
      if (!open) return
      const requestId = ++loadRequestId.current
      if (source.type === 'last-turn') {
        const files = (lastTurn?.files ?? []).map((file) => ({
          path: file.path,
          changeKind: 'modified' as const,
          revision: `${lastTurn?.turnId ?? source.turnId}:${file.path}`,
          additions: file.additions,
          deletions: file.deletions,
          binary: false,
          conflicted: false
        }))
        const next: LocalGitReviewSnapshot = {
          snapshotGeneration: `turn:${lastTurn?.turnId ?? source.turnId}`,
          gitRoot: '',
          source,
          files,
          stagedFileCount: 0,
          unstagedFileCount: 0,
          largeDiff: false
        }
        if (requestId === loadRequestId.current) {
          setSnapshot(next)
          setSelectedFile(
            (current) => files.find((file) => file.path === current?.path) ?? files[0]
          )
          setDiff(undefined)
          setLoading(false)
          setRefreshing(false)
          setError(undefined)
        }
        return
      }
      if (!target) return
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(undefined)
      try {
        const next = await window.desktopApp.git.getReviewSnapshot({ target, source })
        if (requestId !== loadRequestId.current) return
        setSnapshot(next)
        setSelectedFile((current) => {
          const currentFile = next.files.find((file) => file.path === current?.path)
          if (currentFile) return currentFile
          return next.largeDiff ? undefined : next.files[0]
        })
      } catch (cause) {
        if (requestId !== loadRequestId.current) return
        setSnapshot(undefined)
        setSelectedFile(undefined)
        setDiff(undefined)
        setError(cause instanceof Error ? cause.message : 'Unable to load changes')
      } finally {
        if (requestId === loadRequestId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [lastTurn, open, source, target]
  )

  useEffect(() => {
    void load()
  }, [load])

  const refreshReviewPaths = useCallback(
    async ({
      target: refreshTarget,
      source: refreshSource,
      snapshotGeneration,
      paths
    }: {
      target: LocalGitTarget
      source: LocalGitReviewSource
      snapshotGeneration: string
      paths: readonly string[]
    }): Promise<void> => {
      if (refreshSource.type === 'last-turn' || paths.length === 0) return
      const requestId = ++loadRequestId.current
      setRefreshing(true)
      try {
        const refreshed = await window.desktopApp.git.refreshReviewFiles({
          target: refreshTarget,
          source: refreshSource,
          snapshotGeneration,
          paths: [...paths]
        })
        if (requestId !== loadRequestId.current || !snapshot) return
        if (
          snapshot.snapshotGeneration !== snapshotGeneration ||
          !sameReviewSource(snapshot.source, refreshSource)
        ) {
          return
        }
        const files = mergeRefreshedReviewFiles(snapshot.files, paths, refreshed.files)
        const next = {
          ...snapshot,
          snapshotGeneration: refreshed.snapshotGeneration,
          files,
          largeDiff: snapshot.largeDiff && files.length > 0
        }
        setSnapshot(next)
        setSelectedFile((current) => {
          const currentFile = files.find((file) => file.path === current?.path)
          if (currentFile) return currentFile
          return next.largeDiff ? undefined : files[0]
        })
      } finally {
        if (requestId === loadRequestId.current) setRefreshing(false)
      }
    },
    [snapshot]
  )

  useEffect(() => {
    if (!open || !target || source.type === 'last-turn') return
    return window.desktopApp.git.subscribe?.((event) => {
      if (
        event.target.conversationId === target.conversationId &&
        event.target.threadId === target.threadId
      ) {
        if (event.changedPaths && snapshot && sameReviewSource(snapshot.source, source)) {
          void refreshReviewPaths({
            target,
            source,
            snapshotGeneration: snapshot.snapshotGeneration,
            paths: event.changedPaths
          }).catch((cause) => {
            setError(cause instanceof Error ? cause.message : 'Unable to refresh changed files')
          })
          return
        }
        void load(true)
      }
    })
  }, [load, open, refreshReviewPaths, snapshot, source, target])

  useEffect(() => {
    let active = true
    if (source.type === 'last-turn') {
      setDiff(lastTurn?.files.find((file) => file.path === selectedFile?.path)?.diff)
      return () => {
        active = false
      }
    }
    // A source change renders once with the previous snapshot while the new one is
    // loading. Do not ask Main for a diff that pairs the new source with that stale
    // snapshot: Main correctly rejects it, but the rejected request used to surface
    // as an error in the newly selected source.
    if (!target || !snapshot || !selectedFile || !sameReviewSource(snapshot.source, source)) {
      setDiff(undefined)
      return () => {
        active = false
      }
    }
    setDiff(undefined)
    void window.desktopApp.git
      .getFileDiff({
        target,
        source,
        snapshotGeneration: snapshot.snapshotGeneration,
        file: {
          path: selectedFile.path,
          previousPath: selectedFile.previousPath,
          revision: selectedFile.revision
        }
      })
      .then((result) => {
        if (active) setDiff(result.diff)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load file diff')
      })
    return () => {
      active = false
    }
  }, [lastTurn, selectedFile, snapshot, source, target])

  const loadSourcePicker = useCallback(async (): Promise<void> => {
    if (!sourcePicker || !target) return
    setSourcePickerLoading(true)
    setSourcePickerError(undefined)
    try {
      if (sourcePicker === 'commit') {
        setCommits(await window.desktopApp.git.listCommits({ target }))
      } else {
        setBranchSummary(await window.desktopApp.git.listBranches({ target }))
      }
    } catch (cause) {
      setSourcePickerError(cause instanceof Error ? cause.message : 'Unable to load review sources')
    } finally {
      setSourcePickerLoading(false)
    }
  }, [sourcePicker, target])

  useEffect(() => {
    void loadSourcePicker()
  }, [loadSourcePicker])

  const branches = branchOptions(branchSummary)

  const mutationAction = mutationActionForSource(source)
  const snapshotMatchesSource = Boolean(snapshot && sameReviewSource(snapshot.source, source))
  const hasSectionFiles = Boolean(snapshotMatchesSource && snapshot && snapshot.files.length > 0)
  const visibleFiles = snapshot?.files.filter((file) =>
    file.path.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase())
  )
  const sectionMutationIsAllowed = Boolean(
    snapshotMatchesSource &&
    snapshot &&
    snapshot.files.length <= LOCAL_GIT_REVIEW_MUTATION_MAX_FILES
  )
  const sectionMutationLimitMessage = `A section can contain at most ${LOCAL_GIT_REVIEW_MUTATION_MAX_FILES} files. Select individual files instead.`
  const captureMutationTarget = (
    scope: ReviewMutationScope,
    hunkIndex?: number
  ): FrozenReviewMutationTarget | undefined => {
    if (!target || !snapshot || !snapshotMatchesSource) return undefined
    if (scope === 'section' && !sectionMutationIsAllowed) {
      setError(sectionMutationLimitMessage)
      return undefined
    }
    const files = scope === 'section' ? snapshot.files : selectedFile ? [selectedFile] : []
    if (files.length === 0) return undefined
    return {
      target,
      source,
      snapshotGeneration: snapshot.snapshotGeneration,
      scope,
      ...(scope === 'hunk' && hunkIndex !== undefined ? { hunkIndex } : {}),
      files: files.map(({ path, previousPath, revision }) => ({
        path,
        ...(previousPath === undefined ? {} : { previousPath }),
        revision
      }))
    }
  }

  const applyAction = async (
    action: 'stage' | 'unstage' | 'revert',
    mutationTarget: FrozenReviewMutationTarget
  ): Promise<void> => {
    const {
      files,
      hunkIndex,
      scope,
      snapshotGeneration,
      source: mutationSource,
      target: mutationTargetRef
    } = mutationTarget
    setPending(true)
    setError(undefined)
    setMutationFeedback(undefined)
    let result: LocalGitMutationResult | undefined
    try {
      result = await window.desktopApp.git.applyReviewAction({
        target: mutationTargetRef,
        source: mutationSource,
        snapshotGeneration,
        action,
        scope,
        ...(scope === 'hunk' && hunkIndex !== undefined ? { hunkIndex } : {}),
        files
      })
      const feedback = reviewMutationFeedback({
        action,
        scope,
        file: files[0]?.path,
        hunkIndex,
        status: result.status,
        errorCode: result.errorCode
      })
      onGitOperationFeedback?.(feedback)
      if (result.status === 'error') {
        setError(feedback.message)
        return
      }
      if (result.status === 'partial-success') {
        setMutationFeedback(mutationResultDetails(result))
      }
    } catch (cause) {
      const fallback = reviewMutationFeedback({
        action,
        scope,
        file: selectedFile?.path,
        hunkIndex,
        status: 'error'
      })
      onGitOperationFeedback?.(fallback)
      setError(cause instanceof Error ? cause.message : fallback.message)
    } finally {
      if (mutationSource.type !== 'last-turn') {
        const paths = mutationRefreshPaths(result, files)
        try {
          await refreshReviewPaths({
            target: mutationTargetRef,
            source: mutationSource,
            snapshotGeneration,
            paths
          })
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to refresh changed files')
        }
      }
      setPending(false)
    }
  }

  const requestAction = (
    action: 'stage' | 'unstage' | 'revert',
    scope: ReviewMutationScope = 'file',
    hunkIndex?: number
  ): void => {
    const mutationTarget = captureMutationTarget(scope, hunkIndex)
    if (!mutationTarget) return
    if (action !== 'revert') {
      void applyAction(action, mutationTarget)
      return
    }
    if (window.localStorage.getItem('local-git-review.skip-revert-confirmation') === 'true') {
      void applyAction('revert', mutationTarget)
      return
    }
    setPendingRevertTarget(mutationTarget)
    setConfirmRevert(true)
  }

  const hunkCount = diff?.match(/^@@/gmu)?.length ?? 0
  const gitApplyCommand =
    selectedFile && source.type !== 'last-turn'
      ? buildGitApplyCommand(source, selectedFile.path)
      : undefined

  const copyGitApplyCommand = async (): Promise<void> => {
    if (!gitApplyCommand) return
    setError(undefined)
    try {
      await copyText(gitApplyCommand)
      setMutationFeedback('Copied git apply command')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to copy git apply command')
    }
  }

  void onClose
  if (!open) return null
  return (
    <div
      data-slot="local-git-review-panel"
      aria-label="Review"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-13 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div>
          <h2 className="text-sm font-semibold">Review</h2>
          <p className="text-xs text-muted-foreground">{sourceLabels[source.type]}</p>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={diffsCollapsed}
            onClick={() => setDiffsCollapsed((value) => !value)}
          >
            {diffsCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh changes"
            title="Refresh"
            disabled={loading || refreshing}
            onClick={() => void load(true)}
          >
            <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
      <div className="space-y-2 border-b p-2">
        <div role="toolbar" aria-label="Review sources" className="flex flex-wrap gap-1">
          {(['unstaged', 'staged', 'commit', 'branch', 'last-turn'] as const).map((type) => (
            <Button
              key={type}
              type="button"
              size="xs"
              variant={source.type === type || sourcePicker === type ? 'secondary' : 'ghost'}
              aria-pressed={source.type === type || sourcePicker === type}
              disabled={type === 'last-turn' && !lastTurn}
              title={
                type === 'last-turn' && !lastTurn
                  ? 'Select a completed turn to review it'
                  : undefined
              }
              onClick={() => {
                if (type === 'unstaged' || type === 'staged') {
                  setSourcePicker(undefined)
                  onSourceChange({ type })
                  return
                }
                if (type === 'last-turn') {
                  if (lastTurn) {
                    setSourcePicker(undefined)
                    onSourceChange({ type, turnId: lastTurn.turnId })
                  }
                  return
                }
                setSourcePicker(type)
              }}
              onKeyDown={(event) =>
                moveRovingFocus(event, event.currentTarget.parentElement, 'button')
              }
            >
              {sourceLabels[type]}
            </Button>
          ))}
        </div>
        {sourcePicker ? (
          <div
            role="listbox"
            aria-label={sourcePicker === 'commit' ? 'Choose a commit' : 'Choose a base branch'}
            className="max-h-44 overflow-y-auto rounded-md border bg-muted/20 p-1"
          >
            <div className="flex items-center justify-between gap-2 px-1 py-1">
              <span className="text-xs font-medium">
                {sourcePicker === 'commit' ? 'Choose a commit' : 'Choose a base branch'}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label="Close review source picker"
                onClick={() => setSourcePicker(undefined)}
              >
                Cancel
              </Button>
            </div>
            {sourcePickerLoading ? (
              <p
                role="status"
                className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
              >
                <LoaderCircleIcon className="size-3.5 animate-spin" /> Loading {sourcePicker}s
              </p>
            ) : null}
            {sourcePickerError ? (
              <div role="alert" className="px-2 py-2 text-xs text-destructive">
                <p>{sourcePickerError}</p>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void loadSourcePicker()}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {!sourcePickerLoading && !sourcePickerError && sourcePicker === 'commit' ? (
              commits.length > 0 ? (
                commits.map((commit) => (
                  <button
                    key={commit.sha}
                    type="button"
                    role="option"
                    aria-selected={source.type === 'commit' && source.commitSha === commit.sha}
                    className="flex w-full flex-col rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted"
                    onClick={() => {
                      setSourcePicker(undefined)
                      onSourceChange({ type: 'commit', commitSha: commit.sha })
                    }}
                    onKeyDown={(event) =>
                      moveRovingFocus(
                        event,
                        event.currentTarget.parentElement,
                        'button[role="option"]'
                      )
                    }
                  >
                    <span className="truncate font-medium">{commit.subject}</span>
                    <span className="font-mono text-muted-foreground">
                      {commit.sha.slice(0, 12)}
                    </span>
                  </button>
                ))
              ) : (
                <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
                  No commits found
                </p>
              )
            ) : null}
            {!sourcePickerLoading && !sourcePickerError && sourcePicker === 'branch' ? (
              branches.length > 0 ? (
                branches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    role="option"
                    aria-selected={source.type === 'branch' && source.baseBranch === branch}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted"
                    onClick={() => {
                      setSourcePicker(undefined)
                      onSourceChange({ type: 'branch', baseBranch: branch })
                    }}
                    onKeyDown={(event) =>
                      moveRovingFocus(
                        event,
                        event.currentTarget.parentElement,
                        'button[role="option"]'
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                    {branch === branchSummary?.current ? (
                      <span className="text-muted-foreground">current</span>
                    ) : null}
                    {branch === branchSummary?.defaultBase ? (
                      <span className="text-muted-foreground">base</span>
                    ) : null}
                  </button>
                ))
              ) : (
                <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
                  No branches found
                </p>
              )
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={showFiles}
            onClick={() => setShowFiles((value) => !value)}
          >
            {showFiles ? 'Hide files' : 'Show files'}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={split}
            onClick={() => setSplit((value) => !value)}
          >
            {split ? 'Unified' : 'Split'}
          </Button>
          {gitApplyCommand ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="xs" variant="ghost">
                  Review options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void copyGitApplyCommand()}>
                  Copy git apply command
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <p>{error}</p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="mt-1"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {mutationFeedback ? (
        <div role="status" className="mx-3 mt-3 rounded-md border bg-muted/30 p-2 text-xs">
          {mutationFeedback}
        </div>
      ) : null}
      {loading ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircleIcon className="size-4 animate-spin" /> Loading changes
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {showFiles ? (
            <div
              data-slot="local-git-review-file-tree"
              role="tree"
              aria-label="Changed files"
              className="order-2 flex w-[32%] min-w-52 shrink-0 flex-col border-l p-2"
            >
              <Input
                aria-label="Search changed files"
                placeholder="Search files"
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
                className="mb-2 h-9 shrink-0 text-xs"
              />
              <div className="min-h-0 overflow-y-auto">
                {visibleFiles?.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    role="treeitem"
                    aria-selected={selectedFile?.path === file.path}
                    data-selected={selectedFile?.path === file.path}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted data-[selected=true]:bg-muted"
                    onClick={() => {
                      setSelectedFile(file)
                      setDiffsCollapsed(false)
                    }}
                  >
                    <span className="block truncate">{file.path}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {reviewFileStatus(file)}
                    </span>
                    <span className="text-emerald-600">+{file.additions}</span>{' '}
                    <span className="text-red-600">-{file.deletions}</span>
                  </button>
                ))}
              </div>
              {snapshot?.files.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  No {sourceLabels[source.type].toLowerCase()} changes
                </p>
              ) : null}
              {snapshot && snapshot.files.length > 0 && visibleFiles?.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No matching files</p>
              ) : null}
            </div>
          ) : null}
          <div
            data-slot="local-git-review-diff"
            className="order-1 min-w-0 flex-1 overflow-auto p-3"
          >
            {snapshotMatchesSource && snapshot?.largeDiff && !selectedFile ? (
              <p className="text-sm text-muted-foreground">
                Diff too large to display. Select a file.
              </p>
            ) : null}
            {selectedFile?.binary ? (
              <p className="text-sm text-muted-foreground">Binary file cannot be displayed.</p>
            ) : null}
            {selectedFile?.conflicted ? (
              <p className="text-sm text-destructive">This file has conflicts.</p>
            ) : null}
            {selectedFile && diffsCollapsed ? (
              <p role="status" className="text-sm text-muted-foreground">
                Diffs are collapsed.
              </p>
            ) : null}
            {selectedFile &&
            !diffsCollapsed &&
            !selectedFile.binary &&
            !selectedFile.conflicted &&
            diff ? (
              <DiffViewer patch={diff} viewMode={split ? 'split' : 'unified'} />
            ) : null}
            {selectedFile && !diffsCollapsed && !diff && source.type === 'last-turn' ? (
              <p className="text-sm text-muted-foreground">
                This turn can be reviewed from its recorded patch.
              </p>
            ) : null}
            {selectedFile && !diffsCollapsed && !diff && source.type !== 'last-turn' ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading file diff…
              </p>
            ) : null}
            {(selectedFile || hasSectionFiles) &&
            (mutationAction || source.type === 'staged' || source.type === 'unstaged') ? (
              <div className="mt-3 border-t pt-3">
                {mutationAction ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedFile ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending || !snapshotMatchesSource}
                          onClick={() => requestAction(mutationAction, 'file')}
                        >
                          {mutationAction === 'stage' ? 'Stage' : 'Unstage'}
                        </Button>
                      </>
                    ) : null}
                    {hasSectionFiles ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending || !sectionMutationIsAllowed}
                        title={sectionMutationIsAllowed ? undefined : sectionMutationLimitMessage}
                        onClick={() => requestAction(mutationAction, 'section')}
                      >
                        {mutationAction === 'stage' ? 'Stage section' : 'Unstage section'}
                      </Button>
                    ) : null}
                    {selectedFile
                      ? Array.from({ length: hunkCount }, (_, hunkIndex) => (
                          <Button
                            key={hunkIndex}
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending || !snapshotMatchesSource}
                            onClick={() => requestAction(mutationAction, 'hunk', hunkIndex)}
                          >
                            {mutationAction === 'stage' ? 'Stage' : 'Unstage'} hunk {hunkIndex + 1}
                          </Button>
                        ))
                      : null}
                  </div>
                ) : null}
                {source.type === 'staged' || source.type === 'unstaged' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedFile ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={pending || !snapshotMatchesSource}
                        onClick={() => requestAction('revert', 'file')}
                      >
                        Revert
                      </Button>
                    ) : null}
                    {hasSectionFiles ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending || !sectionMutationIsAllowed}
                        title={sectionMutationIsAllowed ? undefined : sectionMutationLimitMessage}
                        onClick={() => requestAction('revert', 'section')}
                      >
                        Revert section
                      </Button>
                    ) : null}
                    {selectedFile
                      ? Array.from({ length: hunkCount }, (_, hunkIndex) => (
                          <Button
                            key={hunkIndex}
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending || !snapshotMatchesSource}
                            onClick={() => requestAction('revert', 'hunk', hunkIndex)}
                          >
                            Revert hunk {hunkIndex + 1}
                          </Button>
                        ))
                      : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <Dialog open={confirmRevert} onOpenChange={setConfirmRevert}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Revert changes?</DialogTitle>
            <DialogDescription>This action removes all of these changes.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(event) => setDontAskAgain(event.target.checked)}
            />{' '}
            Don&apos;t ask again
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmRevert(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (dontAskAgain)
                  window.localStorage.setItem('local-git-review.skip-revert-confirmation', 'true')
                setConfirmRevert(false)
                if (pendingRevertTarget) void applyAction('revert', pendingRevertTarget)
                setPendingRevertTarget(undefined)
              }}
            >
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function sameReviewSource(left: LocalGitReviewSource, right: LocalGitReviewSource): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'commit' && right.type === 'commit') {
    return left.commitSha === right.commitSha
  }
  if (left.type === 'branch' && right.type === 'branch') {
    return left.baseBranch === right.baseBranch
  }
  if (left.type === 'last-turn' && right.type === 'last-turn') {
    return left.turnId === right.turnId
  }
  return true
}

function branchOptions(summary: LocalBranchSummary | undefined): string[] {
  if (!summary) return []
  return [summary.defaultBase, summary.current, ...summary.recent, ...summary.local].filter(
    (branch, index, values): branch is string => Boolean(branch) && values.indexOf(branch) === index
  )
}

function mutationActionForSource(source: LocalGitReviewSource): 'stage' | 'unstage' | undefined {
  if (source.type === 'unstaged') return 'stage'
  if (source.type === 'staged') return 'unstage'
  return undefined
}

function reviewMutationFeedback({
  action,
  scope,
  file,
  hunkIndex,
  status,
  errorCode
}: {
  action: 'stage' | 'unstage' | 'revert'
  scope: 'section' | 'file' | 'hunk'
  file?: string
  hunkIndex?: number
  status: 'success' | 'partial-success' | 'error'
  errorCode?: string
}): LocalGitOperationFeedback {
  if (errorCode === 'not-git-repo') {
    return {
      tone: 'error',
      message:
        action === 'revert'
          ? 'Revert requires a Git repository'
          : 'This action requires a Git repository'
    }
  }
  if (action === 'stage') return stageMutationFeedback(status)
  if (action === 'unstage') return unstageMutationFeedback(status)
  return revertMutationFeedback({ scope, file, hunkIndex, status })
}

function stageMutationFeedback(
  status: 'success' | 'partial-success' | 'error'
): LocalGitOperationFeedback {
  if (status === 'success') return { tone: 'success', message: 'Staged successfully' }
  if (status === 'partial-success') return { tone: 'info', message: 'Partial success' }
  return { tone: 'error', message: 'Failed to stage' }
}

function unstageMutationFeedback(
  status: 'success' | 'partial-success' | 'error'
): LocalGitOperationFeedback {
  if (status === 'success') return { tone: 'success', message: 'Unstaged successfully' }
  if (status === 'partial-success') return { tone: 'info', message: 'Partial success' }
  return { tone: 'error', message: 'Failed to unstage' }
}

function revertMutationFeedback({
  scope,
  file,
  hunkIndex,
  status
}: {
  scope: 'section' | 'file' | 'hunk'
  file?: string
  hunkIndex?: number
  status: 'success' | 'partial-success' | 'error'
}): LocalGitOperationFeedback {
  if (scope === 'section') {
    if (status === 'success') return { tone: 'success', message: 'Section reverted' }
    if (status === 'partial-success') return { tone: 'info', message: 'Section partially reverted' }
    return { tone: 'error', message: 'Failed to revert section' }
  }

  const target =
    scope === 'file' ? (file ?? 'file') : `hunk ${(hunkIndex ?? 0) + 1}${file ? ` in ${file}` : ''}`
  if (status === 'success') return { tone: 'success', message: `Reverted ${target}` }
  if (status === 'partial-success') return { tone: 'info', message: `Partially reverted ${target}` }
  return { tone: 'error', message: `Failed to revert ${target}` }
}

function mutationResultDetails(result: {
  appliedPaths: string[]
  skippedPaths: string[]
  conflictedPaths: string[]
}): string {
  const parts = [
    result.appliedPaths.length > 0 ? `Applied: ${result.appliedPaths.join(', ')}` : undefined,
    result.skippedPaths.length > 0 ? `Skipped: ${result.skippedPaths.join(', ')}` : undefined,
    result.conflictedPaths.length > 0
      ? `Conflicts: ${result.conflictedPaths.join(', ')}`
      : undefined
  ].filter((part): part is string => Boolean(part))
  return parts.join(' · ') || 'Partial success'
}

function mutationRefreshPaths(
  result: LocalGitMutationResult | undefined,
  files: readonly LocalGitReviewFileTarget[]
): string[] {
  const paths = new Set<string>([
    ...(result?.appliedPaths ?? []),
    ...(result?.skippedPaths ?? []),
    ...(result?.conflictedPaths ?? [])
  ])
  if (paths.size === 0) {
    for (const file of files) {
      paths.add(file.path)
      if (file.previousPath !== undefined) paths.add(file.previousPath)
    }
  }
  return [...paths].sort()
}

function mergeRefreshedReviewFiles(
  previousFiles: readonly LocalGitReviewFile[],
  refreshedPaths: readonly string[],
  refreshedFiles: readonly LocalGitReviewFile[]
): LocalGitReviewFile[] {
  const paths = new Set(refreshedPaths)
  const nextFiles = new Map(
    previousFiles
      .filter(
        (file) =>
          !paths.has(file.path) &&
          (file.previousPath === undefined || !paths.has(file.previousPath))
      )
      .map((file) => [file.path, file])
  )
  for (const file of refreshedFiles) {
    if (file.previousPath !== undefined) nextFiles.delete(file.previousPath)
    nextFiles.set(file.path, file)
  }
  return [...nextFiles.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function reviewFileStatus(file: LocalGitReviewFile): string {
  if (file.conflicted) return 'Conflicted'
  if (file.binary) return 'Binary'
  if (file.changeKind === 'renamed' && file.previousPath) {
    return `Renamed from ${file.previousPath}`
  }
  if (file.changeKind === 'copied' && file.previousPath) {
    return `Copied from ${file.previousPath}`
  }
  return file.changeKind.replace('-', ' ')
}

function moveRovingFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  selector: string
): void {
  const direction =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0
  if (!direction || !container) return

  const candidates = [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (candidate) => !candidate.matches(':disabled')
  )
  const currentIndex = candidates.indexOf(event.currentTarget)
  if (currentIndex < 0 || candidates.length === 0) return
  event.preventDefault()
  candidates[(currentIndex + direction + candidates.length) % candidates.length]?.focus()
}

function buildGitApplyCommand(
  source: Exclude<LocalGitReviewSource, { type: 'last-turn' }>,
  path: string
): string {
  const quotedPath = shellQuote(path)
  if (source.type === 'unstaged') return `git diff -- ${quotedPath} | git apply`
  if (source.type === 'staged') return `git diff --cached -- ${quotedPath} | git apply --cached`
  if (source.type === 'commit')
    return `git show ${shellQuote(source.commitSha)} -- ${quotedPath} | git apply`
  return `git diff ${shellQuote(source.baseBranch)}...HEAD -- ${quotedPath} | git apply`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.className = 'fixed -left-full opacity-0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Unable to copy git apply command')
}
