/* eslint-disable react-hooks/set-state-in-effect -- the summary is intentionally reset whenever its conversation-scoped Git target changes. */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalGitSummary } from '../../../../shared/localGitApi'
import { useGitRepository } from '@/components/local-git-review/GitRepositoryProvider'

export type ConversationSummaryState =
  | { status: 'idle'; summary?: undefined; reason?: undefined }
  | { status: 'loading'; summary?: undefined; reason?: undefined }
  | { status: 'ready'; summary: LocalGitSummary; reason?: undefined }
  | { status: 'unavailable'; summary?: undefined; reason: string }

/**
 * Reads the small, conversation-scoped Git summary shown in the header panel.
 * It deliberately only subscribes while the panel is visible: the full review
 * workspace owns its own more detailed refresh lifecycle.
 */
export function useConversationSummaryController({
  open,
  refreshVersion = 0
}: {
  open: boolean
  refreshVersion?: number
}): {
  state: ConversationSummaryState
} {
  const repository = useGitRepository()
  const target = repository.status === 'ready' ? repository.target : undefined
  const [state, setState] = useState<ConversationSummaryState>(() => unavailableState(repository))
  const [refreshRevision, setRefreshRevision] = useState(0)
  const requestGenerationRef = useRef(0)

  const refresh = useCallback(() => {
    if (target) setRefreshRevision((revision) => revision + 1)
  }, [target])

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current
    if (!open) {
      setState((current) => (current.status === 'idle' ? current : { status: 'idle' }))
      return
    }
    if (!target) {
      setState(unavailableState(repository))
      return
    }

    setState({ status: 'loading' })
    void window.desktopApp.git
      .getSummary({ target })
      .then((summary) => {
        if (requestGeneration !== requestGenerationRef.current) return
        if (!summary.gitRoot) {
          setState({
            status: 'unavailable',
            reason: summary.unavailableReason ?? 'Git 环境信息不可用。'
          })
          return
        }
        setState({ status: 'ready', summary })
      })
      .catch((cause) => {
        if (requestGeneration !== requestGenerationRef.current) return
        setState({
          status: 'unavailable',
          reason: cause instanceof Error ? cause.message : '无法读取 Git 环境信息。'
        })
      })
  }, [open, refreshRevision, refreshVersion, repository, target])

  useEffect(() => {
    if (!open || !target) return
    return window.desktopApp.git.subscribe((event) => {
      if (
        event.target.hostId !== target.hostId ||
        event.target.cwd !== target.cwd ||
        event.target.gitRoot !== target.gitRoot ||
        !event.changeTypes.some((type) =>
          ['config', 'head', 'index', 'remote-refs', 'working-tree'].includes(type)
        )
      ) {
        return
      }
      refresh()
    })
  }, [open, refresh, target])

  return { state }
}

function unavailableState(
  repository: ReturnType<typeof useGitRepository>
): ConversationSummaryState {
  if (repository.status === 'loading') return { status: 'loading' }
  if (repository.status === 'unavailable')
    return { status: 'unavailable', reason: repository.reason }
  if (repository.status === 'error') {
    return { status: 'unavailable', reason: repository.error.message }
  }
  return { status: 'idle' }
}
