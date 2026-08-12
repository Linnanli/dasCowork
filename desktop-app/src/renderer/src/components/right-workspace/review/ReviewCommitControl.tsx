import { GitCommitHorizontalIcon, LoaderCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { LocalBranchSummary } from '../../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import {
  CommitOrPushDialog,
  type CommitOrPushDialogActionInput,
  type CommitOrPushDialogStatus
} from './CommitOrPushDialog'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  onFeedback(feedback: { tone: 'success' | 'info' | 'error'; message: string }): void
}

export function ReviewCommitControl({ controller, onFeedback }: Props): React.JSX.Element {
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
    const previousBranch = status?.branch
    let branch = newBranch ?? previousBranch ?? '当前分支'
    let committed = false

    setOpen(false)
    setPending(true)
    try {
      if (newBranch) {
        const created = await window.desktopApp.git.createBranch({
          target,
          branch: newBranch,
          failIfExists: true
        })
        if (created.status !== 'success') throw new Error(created.message ?? '创建分支失败。')
        branch = created.current
      }

      if (action === 'commit' || action === 'commit-and-push') {
        const result = await window.desktopApp.git.commitChanges({
          target,
          message,
          includeUnstaged
        })
        if (result.status !== 'success') throw new Error(result.message ?? '提交失败。')
        committed = true
      }

      if (action === 'commit-and-push' || action === 'push') {
        const result = await window.desktopApp.git.pushChanges({ target })
        if (result.status !== 'success') throw new Error(result.message ?? '推送失败。')
        branch = result.branch
      }

      onFeedback({
        tone: 'success',
        message:
          action === 'push' || action === 'commit-and-push'
            ? `已推送 ${branch}。`
            : `已提交到 ${branch}。`
      })
      controller.refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Git 操作失败。'
      onFeedback({
        tone: 'error',
        message: committed ? `提交成功，但推送失败：${message}` : message
      })
      controller.refresh()
    } finally {
      setPending(false)
      void refreshStatus()
    }
  }

  const buttonEnabled = Boolean(
    status && (status.staged.fileCount + status.unstaged.fileCount > 0 || status.commitsAhead > 0)
  )

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!controller.target || pending || !buttonEnabled}
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
        pending={pending}
        onOpenChange={setOpen}
        onAction={runAction}
      />
    </>
  )
}
