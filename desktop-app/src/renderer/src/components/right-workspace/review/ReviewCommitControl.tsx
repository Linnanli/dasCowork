import { GitCommitHorizontalIcon, LoaderCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { LocalBranchSummary } from '../../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import { useLocalGitReview } from '@/components/local-git-review/LocalGitReviewProvider'
import {
  CommitOrPushDialog,
  type CommitOrPushDialogActionInput,
  type CommitOrPushDialogStatus
} from './CommitOrPushDialog'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  onFeedback(feedback: { id?: string; tone: 'success' | 'info' | 'error'; message: string }): void
}

export function ReviewCommitControl({ controller, onFeedback }: Props): React.JSX.Element {
  const { finishGitWorkflow, getGitWorkflow, startGitWorkflow, updateGitWorkflow } =
    useLocalGitReview()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<CommitOrPushDialogStatus>()
  const [branches, setBranches] = useState<LocalBranchSummary>()
  const [pending, setPending] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!controller.target) {
      setStatus(undefined)
      return
    }
    try {
      setStatus(await window.desktopApp.git.getPublishStatus({ target: controller.target }))
    } catch (cause) {
      setStatus({
        branch: null,
        hasHead: false,
        staged: { fileCount: 0, additions: 0, deletions: 0 },
        unstaged: { fileCount: 0, additions: 0, deletions: 0 },
        upstreamTrackingRef: null,
        upstreamRemote: null,
        upstreamRemoteRef: null,
        selectedPushRemote: null,
        commitsAhead: 0,
        pushBlockedReason: 'status-unavailable',
        unavailableReason: cause instanceof Error ? cause.message : '无法读取 Git 状态。'
      })
    }
  }, [controller.target])

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshStatus()
    }, 0)
    return () => window.clearTimeout(refreshTimer)
  }, [refreshStatus])

  useEffect(() => {
    if (!controller.target) return undefined
    return window.desktopApp.git.subscribe((event): void => {
      if (
        event.target.hostId !== controller.target?.hostId ||
        event.target.cwd !== controller.target?.cwd ||
        !event.changeTypes.some((type) =>
          ['config', 'head', 'index', 'remote-refs', 'working-tree'].includes(type)
        )
      ) {
        return
      }
      void refreshStatus()
    })
  }, [controller.target, refreshStatus])

  const openDialog = async (): Promise<void> => {
    setOpen(true)
    await Promise.all([
      refreshStatus(),
      controller.target
        ? window.desktopApp.git
            .listBranches({ target: controller.target })
            .then(setBranches, () => setBranches(undefined))
        : Promise.resolve()
    ])
  }

  const runAction = async ({
    action,
    message,
    includeUnstaged,
    newBranch
  }: CommitOrPushDialogActionInput): Promise<void> => {
    if (!controller.target) throw new Error('当前项目不可提交。')
    const target = controller.target
    const feedbackId = `publish-operation:${target.hostId}:${target.cwd}`
    const previousBranch = status?.branch
    let branch = newBranch ?? previousBranch ?? '当前分支'
    let committed = false

    const initialPhase = newBranch
      ? 'creating-branch'
      : action === 'push'
        ? 'pushing'
        : 'committing'
    if (!startGitWorkflow(target, { kind: 'commit-or-push', phase: initialPhase })) {
      onFeedback({
        id: feedbackId,
        tone: 'info',
        message: '当前仓库已有 Git 操作进行中。'
      })
      return
    }

    setOpen(false)
    setPending(true)
    try {
      if (newBranch) {
        onFeedback({ id: feedbackId, tone: 'info', message: '正在创建新分支…' })
        const created = await window.desktopApp.git.createBranch({
          target,
          branch: newBranch,
          failIfExists: true
        })
        if (created.status !== 'success') throw new Error(created.message ?? '创建分支失败。')
        branch = created.current
      }

      if (action === 'commit' || action === 'commit-and-push') {
        updateGitWorkflow(target, { kind: 'commit-or-push', phase: 'committing' })
        onFeedback({ id: feedbackId, tone: 'info', message: '正在提交更改…' })
        const result = await window.desktopApp.git.commitChanges({
          target,
          message,
          includeUnstaged
        })
        if (result.status !== 'success') throw new Error(result.message ?? '提交失败。')
        committed = true
      }

      if (action === 'commit-and-push' || action === 'push') {
        updateGitWorkflow(target, { kind: 'commit-or-push', phase: 'pushing' })
        onFeedback({ id: feedbackId, tone: 'info', message: '正在推送提交…' })
        const result = await window.desktopApp.git.pushChanges({ target })
        if (result.status !== 'success') throw new PushOperationError(pushFailureReason(result))
        branch = result.branch
      }

      onFeedback({
        id: feedbackId,
        tone: 'success',
        message:
          action === 'push' || action === 'commit-and-push'
            ? `已推送 ${branch}。`
            : `已提交到 ${branch}。`
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Git 操作失败。'
      onFeedback({
        id: feedbackId,
        tone: 'error',
        message: committed ? `提交成功，但推送失败：${message}` : message
      })
    } finally {
      finishGitWorkflow(target)
      setPending(false)
      controller.refresh()
      void refreshStatus()
    }
  }

  const workflow = controller.target ? getGitWorkflow(controller.target) : undefined
  const buttonEnabled = isCommitOrPushAvailable(status)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!controller.target || pending || workflow !== undefined || !buttonEnabled}
        title="提交或推送"
        onClick={() => void openDialog()}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <GitCommitHorizontalIcon />}
        提交或推送
      </Button>
      <CommitOrPushDialog
        open={open}
        status={status}
        branches={branches?.local}
        pending={pending || workflow !== undefined}
        onOpenChange={setOpen}
        onAction={runAction}
      />
    </>
  )
}

function isCommitOrPushAvailable(status: CommitOrPushDialogStatus | undefined): boolean {
  if (!status || status.pushBlockedReason === 'status-unavailable') return false
  if (status.staged.fileCount + status.unstaged.fileCount > 0 || status.commitsAhead > 0)
    return true
  return status.branch === null && status.hasHead && status.selectedPushRemote !== null
}

class PushOperationError extends Error {}

function pushFailureReason(
  result: Exclude<
    Awaited<ReturnType<typeof window.desktopApp.git.pushChanges>>,
    { status: 'success' }
  >
): string {
  switch (result.status) {
    case 'branch-missing':
      return '当前不在可推送的分支上，请先创建或切换分支。'
    case 'remote-missing':
      return '未配置可用的远端。'
    case 'remote-ambiguous':
      return '无法确定要推送到哪个远端。'
    case 'nothing-to-push':
      return '没有待推送的提交。'
    case 'status-unavailable':
      return withPushDetail('无法读取推送状态。', result.message)
    case 'push-failed':
      return withPushDetail('推送失败。', result.message)
  }
}

function withPushDetail(message: string, detail: string | undefined): string {
  const trimmedDetail = detail?.trim().slice(0, 2_000)
  return trimmedDetail ? `${message}\n${trimmedDetail}` : message
}
