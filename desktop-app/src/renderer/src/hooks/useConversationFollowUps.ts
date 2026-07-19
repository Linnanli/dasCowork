import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ConversationFollowUpState,
  DesktopCodexFollowUpApi,
  FollowUpMode,
  MaterializedQueuedUserMessage,
  PreparedFollowUpEdit,
  QueuedFollowUpItem,
  QueuedUserMessageSnapshotInput
} from '../../../shared/codexFollowUpApi'

export type ConversationFollowUpsController = {
  state: ConversationFollowUpState | null
  items: QueuedFollowUpItem[]
  defaultMode: FollowUpMode
  loading: boolean
  error: string | null
  announcement: string
  pendingItemIds: ReadonlySet<string>
  refresh: () => Promise<void>
  setDefaultMode: (mode: FollowUpMode) => Promise<void>
  enqueue: (snapshot: QueuedUserMessageSnapshotInput, preferredMode?: FollowUpMode) => Promise<void>
  beginEdit: (itemId: string) => Promise<PreparedFollowUpEdit>
  commitEdit: (itemId: string, replacement: QueuedUserMessageSnapshotInput) => Promise<void>
  cancelEdit: (itemId: string) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  moveUp: (itemId: string) => Promise<void>
  moveDown: (itemId: string) => Promise<void>
  reorder: (itemId: string, position: { beforeId: string } | { afterId: string }) => Promise<void>
  materializeItem: (itemId: string) => Promise<MaterializedQueuedUserMessage>
  steerItem: (itemId: string) => Promise<void>
  retry: (itemId: string) => Promise<void>
  resume: () => Promise<void>
  clear: () => Promise<void>
}

type UseConversationFollowUpsOptions = {
  api: DesktopCodexFollowUpApi
  conversationKey: string
}

export function useConversationFollowUps({
  api,
  conversationKey
}: UseConversationFollowUpsOptions): ConversationFollowUpsController {
  const [state, setState] = useState<ConversationFollowUpState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedConversationKey, setLoadedConversationKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    conversationKey: string
    error: string | null
    announcement: string
  } | null>(null)
  const [pendingItemKeys, setPendingItemKeys] = useState<ReadonlySet<string>>(new Set())
  const stateRef = useRef<ConversationFollowUpState | null>(null)

  const applyState = useCallback(
    (nextState: ConversationFollowUpState) => {
      if (nextState.conversationKey !== conversationKey) return
      const currentState = stateRef.current
      if (
        currentState?.conversationKey === nextState.conversationKey &&
        currentState.revision > nextState.revision
      ) {
        return
      }
      stateRef.current = nextState
      setState(nextState)
    },
    [conversationKey]
  )

  const loadState = useCallback(async () => {
    setLoading(true)
    setFeedback((current) => ({
      conversationKey,
      error: null,
      announcement: current?.conversationKey === conversationKey ? current.announcement : ''
    }))
    try {
      applyState(await api.getState(conversationKey))
    } catch (loadError) {
      setFeedback({
        conversationKey,
        error: errorMessage(loadError),
        announcement: ''
      })
    } finally {
      setLoadedConversationKey(conversationKey)
      setLoading(false)
    }
  }, [api, applyState, conversationKey])

  useEffect(() => {
    let active = true
    stateRef.current = null

    const unsubscribe = api.subscribe((event) => {
      if (!active || event.state.conversationKey !== conversationKey) return
      applyState(event.state)
      setLoadedConversationKey(conversationKey)
      setLoading(false)
    })

    void api
      .getState(conversationKey)
      .then((nextState) => {
        if (active) applyState(nextState)
      })
      .catch((loadError: unknown) => {
        if (active && stateRef.current?.conversationKey !== conversationKey) {
          setFeedback({
            conversationKey,
            error: errorMessage(loadError),
            announcement: ''
          })
        }
      })
      .finally(() => {
        if (active) {
          setLoadedConversationKey(conversationKey)
          setLoading(false)
        }
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [api, applyState, conversationKey])

  const runItemAction = useCallback(
    async (
      itemId: string,
      successAnnouncement: string | ((nextState: ConversationFollowUpState) => string),
      action: () => Promise<ConversationFollowUpState>
    ) => {
      const itemKey = pendingItemKey(conversationKey, itemId)
      setPendingItemKeys((current) => new Set(current).add(itemKey))
      setFeedback((current) => ({
        conversationKey,
        error: null,
        announcement: current?.conversationKey === conversationKey ? current.announcement : ''
      }))
      try {
        const nextState = await action()
        applyState(nextState)
        setFeedback({
          conversationKey,
          error: null,
          announcement:
            typeof successAnnouncement === 'function'
              ? successAnnouncement(nextState)
              : successAnnouncement
        })
      } catch (actionError) {
        const message = errorMessage(actionError)
        setFeedback({
          conversationKey,
          error: message,
          announcement: `Follow-up action failed: ${message}`
        })
        throw actionError
      } finally {
        setPendingItemKeys((current) => {
          const next = new Set(current)
          next.delete(itemKey)
          return next
        })
      }
    },
    [applyState, conversationKey]
  )

  const beginEdit = useCallback(
    async (itemId: string): Promise<PreparedFollowUpEdit> => {
      const itemKey = pendingItemKey(conversationKey, itemId)
      setPendingItemKeys((current) => new Set(current).add(itemKey))
      setFeedback({ conversationKey, error: null, announcement: '' })
      try {
        const prepared = await api.beginEdit(conversationKey, itemId)
        applyState(prepared.state)
        setFeedback({
          conversationKey,
          error: null,
          announcement: '排队消息已恢复到输入框。'
        })
        return prepared
      } catch (actionError) {
        const message = errorMessage(actionError)
        setFeedback({
          conversationKey,
          error: message,
          announcement: `无法编辑排队消息：${message}`
        })
        throw actionError
      } finally {
        setPendingItemKeys((current) => {
          const next = new Set(current)
          next.delete(itemKey)
          return next
        })
      }
    },
    [api, applyState, conversationKey]
  )

  const commitEdit = useCallback(
    async (itemId: string, replacement: QueuedUserMessageSnapshotInput) => {
      await runItemAction(itemId, '排队消息已更新。', () =>
        api.commitEdit(conversationKey, itemId, replacement)
      )
    },
    [api, conversationKey, runItemAction]
  )

  const cancelEdit = useCallback(
    async (itemId: string) => {
      await runItemAction(itemId, '已取消编辑，消息已回到队列。', () =>
        api.cancelEdit(conversationKey, itemId)
      )
    },
    [api, conversationKey, runItemAction]
  )

  const deleteItem = useCallback(
    async (itemId: string) => {
      await runItemAction(itemId, 'Follow-up deleted.', () => api.delete(conversationKey, itemId))
    },
    [api, conversationKey, runItemAction]
  )

  const moveUp = useCallback(
    async (itemId: string) => {
      const items = stateRef.current?.items ?? []
      const index = items.findIndex((item) => item.id === itemId)
      if (index <= 0) return
      await runItemAction(itemId, 'Follow-up moved up.', () =>
        api.reorder(conversationKey, itemId, { beforeId: items[index - 1].id })
      )
    },
    [api, conversationKey, runItemAction]
  )

  const moveDown = useCallback(
    async (itemId: string) => {
      const items = stateRef.current?.items ?? []
      const index = items.findIndex((item) => item.id === itemId)
      if (index < 0 || index >= items.length - 1) return
      await runItemAction(itemId, 'Follow-up moved down.', () =>
        api.reorder(conversationKey, itemId, { afterId: items[index + 1].id })
      )
    },
    [api, conversationKey, runItemAction]
  )

  const reorder = useCallback(
    async (itemId: string, position: { beforeId: string } | { afterId: string }) => {
      await runItemAction(itemId, 'Follow-up reordered.', () =>
        api.reorder(conversationKey, itemId, position)
      )
    },
    [api, conversationKey, runItemAction]
  )

  const materializeItem = useCallback(
    (itemId: string) => api.materializeItem(conversationKey, itemId),
    [api, conversationKey]
  )

  const steerItem = useCallback(
    async (itemId: string) => {
      await runItemAction(
        itemId,
        (nextState) =>
          nextState.items.some(
            (item) => item.id === itemId && item.status === 'paused-recovery-uncertain'
          )
            ? '引导结果尚未确认，队列已安全暂停。'
            : '正在用这条消息引导当前任务。',
        () => api.steerItem(conversationKey, itemId)
      )
    },
    [api, conversationKey, runItemAction]
  )

  const retry = useCallback(
    async (itemId: string) => {
      await runItemAction(itemId, 'Follow-up retry requested.', () =>
        api.retry(conversationKey, itemId)
      )
    },
    [api, conversationKey, runItemAction]
  )

  const runConversationAction = useCallback(
    async (
      successAnnouncement: string,
      action: () => Promise<ConversationFollowUpState>
    ): Promise<void> => {
      setFeedback((current) => ({
        conversationKey,
        error: null,
        announcement: current?.conversationKey === conversationKey ? current.announcement : ''
      }))
      try {
        applyState(await action())
        setFeedback({ conversationKey, error: null, announcement: successAnnouncement })
      } catch (actionError) {
        const message = errorMessage(actionError)
        setFeedback({
          conversationKey,
          error: message,
          announcement: `Follow-up action failed: ${message}`
        })
        throw actionError
      }
    },
    [applyState, conversationKey]
  )

  const enqueue = useCallback(
    (
      snapshot: QueuedUserMessageSnapshotInput,
      preferredMode = stateRef.current?.defaultMode ?? 'queue'
    ) =>
      runConversationAction(
        `Follow-up added in ${preferredMode === 'queue' ? 'Queue' : 'Steer'} mode.`,
        () => api.enqueue(conversationKey, snapshot, preferredMode)
      ),
    [api, conversationKey, runConversationAction]
  )

  const resume = useCallback(
    () => runConversationAction('Follow-up queue resumed.', () => api.resume(conversationKey)),
    [api, conversationKey, runConversationAction]
  )

  const clear = useCallback(
    () => runConversationAction('Follow-up queue cleared.', () => api.clear(conversationKey)),
    [api, conversationKey, runConversationAction]
  )

  const setDefaultMode = useCallback(
    async (mode: FollowUpMode) => {
      const previousState = stateRef.current
      if (previousState) {
        const optimisticState = { ...previousState, defaultMode: mode }
        stateRef.current = optimisticState
        setState(optimisticState)
      }
      setFeedback((current) => ({
        conversationKey,
        error: null,
        announcement: current?.conversationKey === conversationKey ? current.announcement : ''
      }))
      try {
        await api.setDefaultMode(mode)
        setFeedback({
          conversationKey,
          error: null,
          announcement: `Default follow-up mode set to ${mode === 'queue' ? 'Queue' : 'Steer'}.`
        })
      } catch (modeError) {
        if (previousState) {
          stateRef.current = previousState
          setState(previousState)
        }
        const message = errorMessage(modeError)
        setFeedback({
          conversationKey,
          error: message,
          announcement: `Could not save follow-up mode: ${message}`
        })
        throw modeError
      }
    },
    [api, conversationKey]
  )

  const visibleState = state?.conversationKey === conversationKey ? state : null
  const visiblePendingItemIds = useMemo(() => {
    const prefix = `${conversationKey}\n`
    return new Set(
      [...pendingItemKeys]
        .filter((itemKey) => itemKey.startsWith(prefix))
        .map((itemKey) => itemKey.slice(prefix.length))
    )
  }, [conversationKey, pendingItemKeys])

  return useMemo(
    () => ({
      state: visibleState,
      items: visibleState?.items ?? [],
      defaultMode: visibleState?.defaultMode ?? 'queue',
      loading: loading || loadedConversationKey !== conversationKey,
      error:
        loadedConversationKey === conversationKey && feedback?.conversationKey === conversationKey
          ? feedback.error
          : null,
      announcement:
        loadedConversationKey === conversationKey && feedback?.conversationKey === conversationKey
          ? feedback.announcement
          : '',
      pendingItemIds: visiblePendingItemIds,
      refresh: loadState,
      setDefaultMode,
      enqueue,
      beginEdit,
      commitEdit,
      cancelEdit,
      deleteItem,
      moveUp,
      moveDown,
      reorder,
      materializeItem,
      steerItem,
      retry,
      resume,
      clear
    }),
    [
      beginEdit,
      cancelEdit,
      clear,
      commitEdit,
      conversationKey,
      deleteItem,
      enqueue,
      feedback,
      loadState,
      loadedConversationKey,
      loading,
      moveDown,
      moveUp,
      materializeItem,
      reorder,
      resume,
      retry,
      steerItem,
      setDefaultMode,
      visiblePendingItemIds,
      visibleState
    ]
  )
}

function pendingItemKey(conversationKey: string, itemId: string): string {
  return `${conversationKey}\n${itemId}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
