/* eslint-disable react-hooks/set-state-in-effect -- the panel must close as soon as its conversation-scoped Git target changes. */
import {
  ChevronRightIcon,
  FolderGit2Icon,
  GitCommitHorizontalIcon,
  ListIcon,
  LoaderCircleIcon,
  PencilLineIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ProjectSelection } from '../../../../shared/projects/projectTypes'
import { useCommitOrPushControl } from '@/components/local-git-review/CommitOrPushControlProvider'
import { useGitRepository } from '@/components/local-git-review/GitRepositoryProvider'
import { useLocalGitReview } from '@/components/local-git-review/LocalGitReviewProvider'
import { LocalBranchSubmenu } from '@/components/local-git-review/LocalBranchSwitcher'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ConversationExecutionTargetSubmenu } from './ConversationExecutionTargetSubmenu'
import { useConversationSummaryController } from './useConversationSummaryController'

/** Header-anchored, transient environment summary for the active conversation. */
export function ConversationPinnedSummary({
  selection,
  taskStarted
}: {
  selection?: ProjectSelection
  taskStarted: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const repository = useGitRepository()
  const { openUncommittedReview } = useLocalGitReview()
  const commit = useCommitOrPushControl()
  const { state } = useConversationSummaryController({
    open,
    refreshVersion: commit.refreshVersion
  })
  const target = repository.status === 'ready' ? repository.target : undefined
  const unavailableReason = summaryUnavailableReason(state, repository)

  useEffect(() => {
    setOpen(false)
  }, [target?.conversationId, target?.threadId, target?.cwd, target?.gitRoot])

  const closeAndRestoreFocus = (): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const openCommitDialog = (): void => {
    closeAndRestoreFocus()
    window.requestAnimationFrame(() => void commit.openDialog('summary-panel'))
  }

  return (
    <DropdownMenu dir="rtl" open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={(element) => {
            triggerRef.current = element
            commit.registerTrigger('summary-panel', element)
          }}
          data-slot="conversation-pinned-summary-trigger"
          type="button"
          aria-label="切换置顶摘要"
          title="切换置顶摘要"
          className="inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ListIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-slot="conversation-pinned-summary"
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[300px] rounded-[24px] p-2 shadow-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <div dir="ltr">
          <div className="flex h-9 items-center px-2.5">
            <h2 className="flex-1 text-sm font-medium">环境信息</h2>
          </div>
          <div className="space-y-0.5">
            <SummaryRow
              dataSlot="conversation-pinned-summary-changes"
              icon={<PencilLineIcon className="size-4" />}
              label="变更"
              disabled={!target}
              title={target ? '审阅未提交的变更' : unavailableReason}
              onClick={() => {
                openUncommittedReview()
                closeAndRestoreFocus()
              }}
            >
              <ChangeStats state={state} />
            </SummaryRow>
            <WorktreeRow
              selection={selection}
              taskStarted={taskStarted}
              onCurrentSelected={closeAndRestoreFocus}
            />
            <LocalBranchSubmenu
              target={target}
              branch={state.status === 'ready' ? state.summary.branch : undefined}
            />
            <SummaryRow
              dataSlot="conversation-pinned-summary-commit"
              icon={<GitCommitHorizontalIcon className="size-4" />}
              label="提交或推送"
              disabled={!commit.targetAvailable || commit.pending || !commit.buttonEnabled}
              title={
                !commit.targetAvailable
                  ? unavailableReason
                  : !commit.buttonEnabled
                    ? '当前没有可提交或推送的变更。'
                    : '提交或推送'
              }
              onClick={openCommitDialog}
            >
              {commit.pending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
            </SummaryRow>
          </div>
          {state.status === 'unavailable' ? (
            <p
              data-slot="conversation-pinned-summary-unavailable"
              className="px-2.5 pt-2 text-xs text-muted-foreground"
            >
              {state.reason}
            </p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorktreeRow({
  selection,
  taskStarted,
  onCurrentSelected
}: {
  selection?: ProjectSelection
  taskStarted: boolean
  onCurrentSelected(): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const label = worktreeLabel(selection)

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
        data-slot="conversation-pinned-summary-worktree"
        className="h-10 w-full rounded-xl px-2.5 text-sm"
        onKeyDown={(event) => openSummarySubmenuWithArrowRight(event, setOpen)}
      >
        <FolderGit2Icon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-left">工作树</span>
        <span className="max-w-24 truncate text-xs text-muted-foreground">{label}</span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={contentRef}
        data-slot="conversation-pinned-summary-worktree-submenu"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="rounded-2xl p-1"
        onKeyDown={(event) => closeSummarySubmenuWithArrowLeft(event, setOpen, triggerRef)}
      >
        <div dir="ltr">
          <ConversationExecutionTargetSubmenu
            selection={selection}
            taskStarted={taskStarted}
            onCurrentSelected={onCurrentSelected}
          />
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function openSummarySubmenuWithArrowRight(
  event: React.KeyboardEvent<HTMLElement>,
  setOpen: (open: boolean) => void
): void {
  if (event.key !== 'ArrowRight') return
  event.preventDefault()
  setOpen(true)
}

function closeSummarySubmenuWithArrowLeft(
  event: React.KeyboardEvent<HTMLElement>,
  setOpen: (open: boolean) => void,
  triggerRef: React.RefObject<HTMLDivElement | null>
): void {
  if (event.key !== 'ArrowLeft') return
  event.preventDefault()
  setOpen(false)
  triggerRef.current?.focus()
}

function SummaryRow({
  dataSlot,
  icon,
  label,
  disabled = false,
  title,
  onClick,
  children
}: {
  dataSlot: string
  icon: React.ReactNode
  label: string
  disabled?: boolean
  title: string
  onClick(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      data-slot={dataSlot}
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="h-10 w-full justify-start rounded-xl px-2.5 text-sm"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 text-left">{label}</span>
      {children}
    </Button>
  )
}

function ChangeStats({
  state
}: {
  state: ReturnType<typeof useConversationSummaryController>['state']
}): React.JSX.Element {
  if (state.status === 'loading')
    return <LoaderCircleIcon aria-label="Loading changes" className="size-3.5 animate-spin" />
  if (state.status !== 'ready') return <span className="text-xs text-muted-foreground">不可用</span>
  return (
    <span className="shrink-0 tabular-nums text-xs">
      <span className="text-emerald-600 dark:text-emerald-400">+{state.summary.additions}</span>
      <span className="ml-1 text-red-600 dark:text-red-400">-{state.summary.deletions}</span>
    </span>
  )
}

function summaryUnavailableReason(
  state: ReturnType<typeof useConversationSummaryController>['state'],
  repository: ReturnType<typeof useGitRepository>
): string {
  if (state.status === 'unavailable') return state.reason
  if (repository.status === 'unavailable') return repository.reason
  if (repository.status === 'error') return repository.error.message
  return 'Git 环境信息不可用。'
}

function worktreeLabel(selection: ProjectSelection | undefined): string {
  if (selection?.projectKind === 'remote') return '云端'
  if (selection?.projectKind === 'local' || selection?.projectKind === 'path') return '本地检出'
  return '未知'
}
