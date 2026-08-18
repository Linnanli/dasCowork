import { memo, useCallback } from 'react'
import { LoaderIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { ConversationRuntimeIndicator } from '../runtime/ConversationRuntimeIndicatorStore'
import type { SidebarConversationView } from './sidebarTypes'
import { useConversationRuntimeIndicator } from './useConversationRuntimeIndicator'

export const ConversationRow = memo(function ConversationRow({
  conversation,
  projectLabel,
  nativeBackdrop,
  onOpenConversation
}: {
  conversation: SidebarConversationView
  projectLabel?: string
  nativeBackdrop: boolean
  onOpenConversation: (conversationId: string) => void
}): React.JSX.Element {
  const { active, attention, running, unread } = useConversationRuntimeIndicator(conversation)
  const onOpen = useCallback(
    () => onOpenConversation(conversation.id),
    [conversation.id, onOpenConversation]
  )
  const title = conversation.title ?? 'New Chat'
  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={conversationAriaLabel(title, { attention, running, unread })}
      className={cn(
        'group flex min-h-8 w-full min-w-0 cursor-default items-center gap-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        nativeBackdrop
          ? 'hover:bg-background/40 focus-within:bg-background/40 dark:hover:bg-foreground/8'
          : 'hover:bg-muted focus-within:bg-muted'
      )}
      type="button"
      onClick={onOpen}
    >
      <div className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm text-foreground">
        <span className="block w-full min-w-0 truncate">{title}</span>
        <span className="block w-full min-w-0 truncate text-[11px] font-normal text-muted-foreground">
          {projectLabel ?? formatConversationMeta(conversation, { attention, running })}
        </span>
      </div>
      {running ? (
        <span
          className="grid size-6 shrink-0 place-items-center text-muted-foreground"
          aria-hidden="true"
          title={`${title} is running`}
        >
          <LoaderIcon className="size-3.5 animate-spin [animation-duration:1.4s]" />
        </span>
      ) : null}
      {attention ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-amber-500"
          title={`${title} needs attention`}
        />
      ) : null}
      {unread ? (
        <span
          aria-hidden="true"
          className="mr-2 size-2 shrink-0 rounded-full bg-primary"
          title={`${title} has unread updates`}
        />
      ) : null}
    </button>
  )
})

function formatConversationMeta(
  conversation: SidebarConversationView,
  indicator: Pick<ConversationRuntimeIndicator, 'attention' | 'running'>
): string {
  if (indicator.attention) return 'Needs attention'
  if (indicator.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}

function conversationAriaLabel(
  title: string,
  indicator: Pick<ConversationRuntimeIndicator, 'attention' | 'running' | 'unread'>
): string {
  const states = [
    indicator.running ? 'running' : '',
    indicator.unread ? 'unread' : '',
    indicator.attention ? 'needs attention' : ''
  ].filter(Boolean)
  return states.length > 0 ? `${title}, ${states.join(', ')}` : title
}
