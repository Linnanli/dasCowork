import { SquareIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { SidebarConversation } from '../../../shared/codexIpcApi'

export function ConversationRow({
  conversation,
  projectLabel,
  nativeBackdrop,
  onOpen,
  onInterrupt
}: {
  conversation: SidebarConversation
  projectLabel?: string
  nativeBackdrop: boolean
  onOpen: () => void
  onInterrupt: () => void
}): React.JSX.Element {
  const title = conversation.title ?? 'New Chat'
  return (
    <div
      className={cn(
        'group flex min-h-8 min-w-0 items-center gap-1 rounded-md transition-colors',
        nativeBackdrop
          ? 'hover:bg-background/40 focus-within:bg-background/40 dark:hover:bg-foreground/8'
          : 'hover:bg-muted focus-within:bg-muted'
      )}
    >
      <button
        className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm text-foreground outline-none"
        type="button"
        onClick={onOpen}
      >
        <span className="min-w-0 truncate">{title}</span>
        <span className="truncate text-[11px] font-normal text-muted-foreground">
          {projectLabel ?? formatConversationMeta(conversation)}
        </span>
      </button>
      {conversation.running ? (
        <button
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          type="button"
          aria-label={`Interrupt ${title}`}
          title={`Interrupt ${title}`}
          onClick={onInterrupt}
        >
          <SquareIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function formatConversationMeta(conversation: SidebarConversation): string {
  if (conversation.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}
