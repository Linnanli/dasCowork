import { PencilIcon } from 'lucide-react'

import type { SidebarConversation } from '../../../shared/codexIpcApi'
import { ConversationRow } from './ConversationRow'
import type { ConversationStateController } from './useConversationState'

export function SidebarChatsSection({
  quickChats,
  chronologicalChats,
  showChronological,
  nativeBackdrop,
  conversationState,
  onNewQuickChat
}: {
  quickChats: SidebarConversation[]
  chronologicalChats: SidebarConversation[]
  showChronological: boolean
  nativeBackdrop: boolean
  conversationState: ConversationStateController
  onNewQuickChat: () => void
}): React.JSX.Element {
  const chats = showChronological ? chronologicalChats : quickChats
  const quickChatActionLabel = 'New quick chat'
  return (
    <section className="space-y-1" aria-label={showChronological ? 'Recent chats' : 'Quick chats'}>
      <div className="group flex items-center justify-between px-2 text-[11px] font-medium text-muted-foreground uppercase">
        <span>{showChronological ? 'Recent chats' : 'Quick chats'}</span>
        {!showChronological ? (
          <button
            aria-label={quickChatActionLabel}
            className="pointer-events-none grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
            title={quickChatActionLabel}
            type="button"
            onClick={onNewQuickChat}
          >
            <PencilIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {chats.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {showChronological ? 'No recent chats' : 'No quick chats'}
          </div>
        ) : (
          chats.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              nativeBackdrop={nativeBackdrop}
              onOpen={() =>
                void conversationState.openConversation({ conversationId: conversation.id })
              }
              onArchive={() =>
                void conversationState.archiveConversation({ conversationId: conversation.id })
              }
              onInterrupt={() =>
                void conversationState.interruptConversation({ conversationId: conversation.id })
              }
            />
          ))
        )}
      </div>
    </section>
  )
}
