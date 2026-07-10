import { LoaderIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { SidebarConversationView } from './sidebarTypes'

export function ConversationRow({
  conversation,
  projectLabel,
  nativeBackdrop,
  onOpen
}: {
  conversation: SidebarConversationView
  projectLabel?: string
  nativeBackdrop: boolean
  onOpen: () => void
}): React.JSX.Element {
  const title = conversation.title ?? 'New Chat'
  return (
    <button
      aria-current={conversation.active ? 'page' : undefined}
      aria-label={conversationAriaLabel(conversation, title)}
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
          {projectLabel ?? formatConversationMeta(conversation)}
        </span>
      </div>
      {conversation.running ? (
        <span
          className="grid size-6 shrink-0 place-items-center text-muted-foreground"
          aria-hidden="true"
          title={`${title} is running`}
        >
          <LoaderIcon className="size-3.5 animate-spin [animation-duration:1.4s]" />
        </span>
      ) : null}
      {conversation.attention ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-amber-500"
          title={`${title} needs attention`}
        />
      ) : null}
      {conversation.unread ? (
        <span
          aria-hidden="true"
          className="mr-2 size-2 shrink-0 rounded-full bg-primary"
          title={`${title} has unread updates`}
        />
      ) : null}
    </button>
  )
}

function formatConversationMeta(conversation: SidebarConversationView): string {
  if (conversation.attention) return 'Needs attention'
  if (conversation.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}

function conversationAriaLabel(conversation: SidebarConversationView, title: string): string {
  const states = [
    conversation.running ? 'running' : '',
    conversation.unread ? 'unread' : '',
    conversation.attention ? 'needs attention' : ''
  ].filter(Boolean)
  return states.length > 0 ? `${title}, ${states.join(', ')}` : title
}
