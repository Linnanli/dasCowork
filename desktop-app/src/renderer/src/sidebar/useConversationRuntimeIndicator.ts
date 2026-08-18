import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react'

import type { ConversationRuntimeIndicator } from '../runtime/ConversationRuntimeIndicatorStore'
import { ConversationRuntimeIndicatorContext } from './ConversationRuntimeIndicatorContext'
import type { SidebarConversationView } from './sidebarTypes'

const subscribeToNothing = (): (() => void) => () => undefined

export function useConversationRuntimeIndicator(
  conversation: SidebarConversationView
): ConversationRuntimeIndicator {
  const store = useContext(ConversationRuntimeIndicatorContext)
  const fallback = useMemo<ConversationRuntimeIndicator>(
    () => ({
      active: Boolean(conversation.active),
      attention: Boolean(conversation.attention),
      running: Boolean(conversation.running),
      unread: Boolean(conversation.unread)
    }),
    [conversation.active, conversation.attention, conversation.running, conversation.unread]
  )
  const getSnapshot = useCallback(
    () => store?.getSnapshot(conversation) ?? fallback,
    [conversation, fallback, store]
  )

  return useSyncExternalStore(store?.subscribe ?? subscribeToNothing, getSnapshot, getSnapshot)
}
