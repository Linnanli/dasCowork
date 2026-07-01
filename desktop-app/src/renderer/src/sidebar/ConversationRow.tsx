import { ArchiveIcon, SquareIcon } from 'lucide-react'

import { cn } from '../lib/utils'
import type { SidebarConversation } from '../../../shared/codexIpcApi'

export function ConversationRow({
  conversation,
  projectLabel,
  nativeBackdrop,
  onOpen,
  onArchive,
  onInterrupt
}: {
  conversation: SidebarConversation
  projectLabel?: string
  nativeBackdrop: boolean
  onOpen: () => void
  onArchive: () => void
  onInterrupt: () => void
}): React.JSX.Element {
  const title = conversation.title ?? 'New Chat'
  return (
    <div
      className={cn(
        'group flex min-h-8 items-center gap-1 rounded-md transition-colors',
        nativeBackdrop
          ? 'hover:bg-background/40 focus-within:bg-background/40 dark:hover:bg-foreground/8'
          : 'hover:bg-muted focus-within:bg-muted'
      )}
    >
      <button
        className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm font-medium text-foreground outline-none"
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
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          type="button"
          aria-label={`Interrupt ${title}`}
          title={`Interrupt ${title}`}
          onClick={onInterrupt}
        >
          <SquareIcon className="size-3.5" />
        </button>
      ) : null}
      <button
        className="mr-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent"
        type="button"
        aria-label={`Archive ${title}`}
        title={`Archive ${title}`}
        onClick={onArchive}
      >
        <ArchiveIcon className="size-3.5" />
        <span className="sr-only">Archive</span>
      </button>
    </div>
  )
}

function formatConversationMeta(conversation: SidebarConversation): string {
  if (conversation.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}
