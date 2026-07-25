import { useCallback, useEffect, useState } from 'react'

import type { WorkspaceRecoveryStatus } from '../../../../shared/projects/projectTypes'
import { Button } from '@/components/ui/button'

type WorkspaceRecoveryBannerProps = {
  conversationId?: string
  threadId?: string
  onCreateNewTask: () => void
}

export function WorkspaceRecoveryBanner({
  conversationId,
  threadId,
  onCreateNewTask
}: WorkspaceRecoveryBannerProps): React.JSX.Element | null {
  const [status, setStatus] = useState<WorkspaceRecoveryStatus | null>(null)
  const [requesting, setRequesting] = useState(false)

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setStatus(null)
      return
    }
    setStatus(await window.desktopApp.projects.getWorkspaceRecovery({ conversationId, threadId }))
  }, [conversationId, threadId])

  useEffect(() => {
    // `refresh` updates state only after the asynchronous IPC request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() =>
      setStatus({ state: 'checking-failed', message: '无法检查原工作区。请重试。' })
    )
  }, [refresh])

  const restore = useCallback(async () => {
    if (!conversationId || requesting) return
    setRequesting(true)
    setStatus({ state: 'restoring', message: '正在恢复工作区…' })
    try {
      setStatus(await window.desktopApp.projects.restoreWorkspace({ conversationId, threadId }))
    } catch {
      setStatus({ state: 'restore-failed', message: '恢复工作区失败。请重试，或选择项目后新建任务。' })
    } finally {
      setRequesting(false)
    }
  }, [conversationId, requesting, threadId])

  if (!status || status.state === 'available' || status.state === 'not-applicable') return null

  const action = recoveryAction(status.state, { refresh, restore, onCreateNewTask, requesting })
  return (
    <section
      data-slot="workspace-recovery-banner"
      data-workspace-recovery-state={status.state}
      role="status"
      aria-live="polite"
      className="mb-2 flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs"
    >
      <span>{status.message ?? recoveryMessage(status.state)}</span>
      {action}
    </section>
  )
}

function recoveryAction(
  state: WorkspaceRecoveryStatus['state'],
  actions: {
    refresh: () => Promise<void>
    restore: () => Promise<void>
    onCreateNewTask: () => void
    requesting: boolean
  }
): React.JSX.Element | null {
  if (state === 'checking-failed' || state === 'init-failed' || state === 'remote-unavailable') {
    return (
      <Button type="button" size="xs" variant="secondary" onClick={() => void actions.refresh()}>
        重试检查
      </Button>
    )
  }
  if (state === 'restorable' || state === 'restore-failed') {
    return (
      <Button type="button" size="xs" variant="secondary" onClick={() => void actions.restore()}>
        恢复工作区
      </Button>
    )
  }
  if (state === 'gone') {
    return (
      <Button type="button" size="xs" variant="secondary" onClick={actions.onCreateNewTask}>
        新建任务
      </Button>
    )
  }
  if (state === 'restoring' && actions.requesting) return null
  return null
}

function recoveryMessage(state: WorkspaceRecoveryStatus['state']): string {
  if (state === 'restorable') return '原工作区可恢复。'
  if (state === 'restoring') return '正在恢复工作区…'
  if (state === 'gone') return '原工作区已不可用。请选择项目并新建任务继续。'
  if (state === 'restore-failed') return '恢复工作区失败。请重试，或选择项目后新建任务。'
  if (state === 'remote-unavailable') return '远程工作区暂时不可用。'
  return '无法检查原工作区。请重试。'
}
