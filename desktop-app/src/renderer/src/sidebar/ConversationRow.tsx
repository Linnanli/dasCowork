import { SquareIcon } from 'lucide-react'

import type { SidebarConversation } from '../../../shared/codexIpcApi'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'

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
        'group flex min-h-8 min-w-0 cursor-default items-center gap-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        nativeBackdrop
          ? 'hover:bg-background/40 focus-within:bg-background/40 dark:hover:bg-foreground/8'
          : 'hover:bg-muted focus-within:bg-muted'
      )}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm text-foreground">
        <span className="min-w-0 truncate">{title}</span>
        <span className="truncate text-[11px] font-normal text-muted-foreground">
          {projectLabel ?? formatConversationMeta(conversation)}
        </span>
      </div>
      {conversation.running ? (
        <Button
          className="shrink-0 text-muted-foreground"
          size="icon-xs"
          type="button"
          variant="ghost"
          aria-label={`Interrupt ${title}`}
          title={`Interrupt ${title}`}
          onClick={(event) => {
            event.stopPropagation()
            onInterrupt()
          }}
        >
          <SquareIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

function formatConversationMeta(conversation: SidebarConversation): string {
  if (conversation.running) return 'Running'
  if (conversation.updatedAt) return new Date(conversation.updatedAt).toLocaleString()
  return conversation.cwd ?? 'Conversation'
}
