/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderCircleIcon
} from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Command } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { validateBranchName } from '@/components/local-git-review/branchNameValidation'
import type {
  LocalGitPublishStatus,
  LocalGitPushBlockedReason,
  LocalGitSelectionSummary
} from '../../../../../shared/localGitApi'

export type CommitOrPushAction = 'commit' | 'commit-and-push' | 'push'

export type CommitOrPushDialogStatus = LocalGitPublishStatus

export type CommitOrPushDialogActionInput = {
  action: CommitOrPushAction
  message: string
  includeUnstaged: boolean
  newBranch?: string
}

type Props = {
  open: boolean
  status?: CommitOrPushDialogStatus
  branches?: readonly string[]
  pending?: boolean
  mode?: 'commit-or-push' | 'commit-before-switch'
  onOpenChange(open: boolean): void
  onAction(input: CommitOrPushDialogActionInput): Promise<void>
}

const actionOrder: readonly CommitOrPushAction[] = ['commit', 'commit-and-push', 'push']

export function CommitOrPushDialog({
  open,
  status,
  branches = [],
  pending = false,
  mode = 'commit-or-push',
  onOpenChange,
  onAction
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [branchMode, setBranchMode] = useState<'current' | 'new'>('current')
  const [newBranch, setNewBranch] = useState('')
  const [selectedAction, setSelectedAction] = useState<CommitOrPushAction>()
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string>()
  const isPending = pending || executing

  useEffect(() => {
    if (!open) return
    setMessage('')
    setIncludeUnstaged(true)
    setBranchMode('current')
    setNewBranch('')
    setSelectedAction(undefined)
    setExecuting(false)
    setError(undefined)
  }, [open])

  const selectedSummary = useMemo(
    () => combineSummaries(status?.staged, includeUnstaged ? status?.unstaged : undefined),
    [includeUnstaged, status?.staged, status?.unstaged]
  )
  const branchError =
    mode === 'commit-or-push' && branchMode === 'new'
      ? validateBranchName(newBranch, branches)
      : undefined
  const actionState = useMemo(
    () =>
      actionStates({
        status,
        selectedSummary,
        branchMode,
        branchError,
        mode
      }),
    [branchError, branchMode, mode, selectedSummary, status]
  )
  const visibleActions = useMemo(
    () => (mode === 'commit-before-switch' ? (['commit'] as const) : actionOrder),
    [mode]
  )
  const enabledActions = useMemo(
    () => visibleActions.filter((action) => !actionState[action]),
    [actionState, visibleActions]
  )

  useEffect(() => {
    if (!open) return
    setSelectedAction((current) =>
      current && enabledActions.includes(current) ? current : enabledActions[0]
    )
  }, [enabledActions, open])

  const perform = async (action: CommitOrPushAction): Promise<void> => {
    if (isPending || actionState[action]) return
    setExecuting(true)
    setError(undefined)
    try {
      await onAction({
        action,
        message: message.trim(),
        includeUnstaged,
        newBranch: branchMode === 'new' ? newBranch.trim() : undefined
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Git 操作失败。')
    } finally {
      setExecuting(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (selectedAction) void perform(selectedAction)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
      return
    event.preventDefault()
    if (enabledActions.length === 0) return
    const index = selectedAction ? enabledActions.indexOf(selectedAction) : -1
    const step = event.key === 'ArrowDown' ? 1 : -1
    setSelectedAction(
      enabledActions[
        index < 0 && event.key === 'ArrowUp'
          ? enabledActions.length - 1
          : (index + step + enabledActions.length) % enabledActions.length
      ]!
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-slot="commit-or-push-dialog"
        showCloseButton={false}
        className="w-[420px] max-w-[92vw] gap-0 overflow-visible rounded-[2rem] bg-popover p-2 sm:max-w-[420px]"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault()
        }}
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">提交或推送</DialogTitle>
        <TooltipProvider>
          <Command shouldFilter={false} loop className="overflow-visible bg-transparent">
            <div className="px-4 pt-4 pb-3">
              <BranchTarget
                branch={status?.branch}
                branchMode={branchMode}
                disabled={isPending || mode === 'commit-before-switch'}
                newBranch={newBranch}
                branchError={branchError}
                onBranchModeChange={setBranchMode}
                onNewBranchChange={setNewBranch}
              />
              <textarea
                aria-label="提交信息"
                className="mt-5 h-20 w-full resize-none bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
                placeholder="提交信息（留空将自动生成）…"
                value={message}
                disabled={isPending}
                onChange={(event) => setMessage(event.target.value)}
              />
              <div className="mt-3 flex items-center gap-2">
                <Checkbox
                  id="commit-or-push-include-unstaged"
                  checked={includeUnstaged}
                  disabled={isPending}
                  onCheckedChange={(checked) => setIncludeUnstaged(checked === true)}
                />
                <label
                  htmlFor="commit-or-push-include-unstaged"
                  className="min-w-0 flex-1 cursor-pointer text-[13px] font-medium"
                >
                  包含未暂存的更改
                </label>
                <ChangeStats summary={selectedSummary} />
              </div>
              {error ? (
                <p role="alert" className="mt-2 text-[11px] text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="border-t px-0 pt-2 pb-2">
              {visibleActions.map((action) => (
                <ActionRow
                  key={action}
                  action={action}
                  disabledReason={actionState[action]}
                  selected={selectedAction === action}
                  pending={isPending}
                  onFocus={() => setSelectedAction(action)}
                  onClick={() => void perform(action)}
                />
              ))}
            </div>
          </Command>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}

function BranchTarget({
  branch,
  branchMode,
  disabled,
  newBranch,
  branchError,
  onBranchModeChange,
  onNewBranchChange
}: {
  branch: string | null | undefined
  branchMode: 'current' | 'new'
  disabled: boolean
  newBranch: string
  branchError?: string
  onBranchModeChange(value: 'current' | 'new'): void
  onNewBranchChange(value: string): void
}): React.JSX.Element {
  return (
    <div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex max-w-full items-center gap-2 text-left text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
          >
            <GitBranchIcon className="size-4 shrink-0" />
            <span className="truncate">
              {branchMode === 'new' ? '新分支' : (branch ?? '当前分支')}
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted"
            onClick={() => onBranchModeChange('current')}
          >
            {branchMode === 'current' ? (
              <CheckIcon className="size-4" />
            ) : (
              <span className="size-4" />
            )}
            <span className="truncate">{branch ?? '当前分支'}</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted"
            onClick={() => onBranchModeChange('new')}
          >
            {branchMode === 'new' ? <CheckIcon className="size-4" /> : <span className="size-4" />}
            新分支
          </button>
        </PopoverContent>
      </Popover>
      {branchMode === 'new' ? (
        <div className="mt-3">
          <Input
            aria-label="新分支名称"
            className="text-[13px]"
            value={newBranch}
            placeholder="feature/local-review"
            disabled={disabled}
            aria-invalid={Boolean(branchError)}
            onChange={(event) => onNewBranchChange(event.target.value)}
          />
          {branchError ? (
            <p role="alert" className="mt-1 text-[11px] text-destructive">
              {branchError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ChangeStats({ summary }: { summary: LocalGitSelectionSummary }): React.JSX.Element {
  return (
    <span className="shrink-0 text-[13px] tabular-nums">
      <span className="text-emerald-500">+{summary.additions}</span>{' '}
      <span className="text-red-500">-{summary.deletions}</span>
    </span>
  )
}

function ActionRow({
  action,
  disabledReason,
  selected,
  pending,
  onFocus,
  onClick
}: {
  action: CommitOrPushAction
  disabledReason?: string
  selected: boolean
  pending: boolean
  onFocus(): void
  onClick(): void
}): React.JSX.Element {
  const { Icon, label } = actionLabel(action)
  const disabled = Boolean(disabledReason) || pending
  const button = (
    <button
      type="button"
      data-action={action}
      data-disabled-reason={disabledReason}
      className={cn(
        'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[1.4rem] px-4 py-2.5 text-left text-[13px] font-medium transition-colors',
        selected && !disabled && 'bg-muted',
        disabled && 'cursor-not-allowed text-muted-foreground'
      )}
      title={disabledReason}
      aria-disabled={disabled}
      disabled={disabled}
      onFocus={onFocus}
      onClick={onClick}
    >
      {pending && selected ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <Icon className="size-4" />
      )}
      <span className="min-w-0 flex-1">{label}</span>
      {selected && !disabled ? (
        <kbd className="rounded-xl bg-background/60 px-2 py-1 text-[11px] font-medium text-muted-foreground">
          ⌘↵
        </kbd>
      ) : null}
    </button>
  )
  if (!disabledReason) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="left">{disabledReason}</TooltipContent>
    </Tooltip>
  )
}

function actionLabel(action: CommitOrPushAction): {
  label: string
  Icon: typeof GitCommitHorizontalIcon
} {
  if (action === 'commit') return { label: '提交', Icon: GitCommitHorizontalIcon }
  if (action === 'commit-and-push') return { label: '提交并推送', Icon: CloudUploadIcon }
  return { label: '推送', Icon: CloudUploadIcon }
}

function combineSummaries(
  first?: LocalGitSelectionSummary,
  second?: LocalGitSelectionSummary
): LocalGitSelectionSummary {
  return {
    fileCount: (first?.fileCount ?? 0) + (second?.fileCount ?? 0),
    additions: (first?.additions ?? 0) + (second?.additions ?? 0),
    deletions: (first?.deletions ?? 0) + (second?.deletions ?? 0)
  }
}

function actionStates({
  status,
  selectedSummary,
  branchMode,
  branchError,
  mode
}: {
  status?: CommitOrPushDialogStatus
  selectedSummary: LocalGitSelectionSummary
  branchMode: 'current' | 'new'
  branchError?: string
  mode: Props['mode']
}): Record<CommitOrPushAction, string | undefined> {
  const unavailableReason =
    status?.unavailableReason ?? (status ? undefined : '正在读取 Git 状态。')
  const targetBranchMissing = branchMode === 'current' && !status?.branch
  const selectedNewBranchCanPublish = branchMode === 'new' && Boolean(status?.selectedPushRemote)
  const commitReason =
    unavailableReason ??
    branchError ??
    (selectedSummary.fileCount === 0 ? '没有可提交的更改。' : undefined)
  const publishReason =
    unavailableReason ??
    branchError ??
    publishBlockedMessage(
      selectedNewBranchCanPublish && status?.pushBlockedReason === 'branch-missing'
        ? null
        : status?.pushBlockedReason,
      targetBranchMissing
    )
  const pushReason =
    publishReason ??
    (branchMode === 'new'
      ? status?.hasHead
        ? undefined
        : '当前没有可推送的提交。'
      : status && status.commitsAhead > 0
        ? undefined
        : '没有待推送的提交。')
  return {
    commit: commitReason,
    'commit-and-push':
      mode === 'commit-before-switch' ? '此操作不可用。' : (commitReason ?? publishReason),
    push: mode === 'commit-before-switch' ? '此操作不可用。' : pushReason
  }
}

function publishBlockedMessage(
  reason: LocalGitPushBlockedReason | null | undefined,
  targetBranchMissing: boolean
): string | undefined {
  if (targetBranchMissing || reason === 'branch-missing') return '当前不在分支上。'
  if (reason === 'remote-missing') return '未配置可用的远端。'
  if (reason === 'remote-ambiguous') return '无法确定要推送到哪个远端。'
  if (reason === 'status-unavailable') return '无法读取推送状态。'
  return undefined
}
