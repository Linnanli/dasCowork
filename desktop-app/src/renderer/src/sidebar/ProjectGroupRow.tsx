import {
  AlertTriangleIcon,
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  TrashIcon
} from 'lucide-react'

import { cn } from '../lib/utils'
import { ConversationRow } from './ConversationRow'
import type { SidebarProjectGroup } from './sidebarTypes'

export function ProjectGroupRow({
  group,
  nativeBackdrop,
  onToggleCollapsed,
  onNewChat,
  onArchiveConversation,
  onArchiveProjectChats,
  onRemoveProject,
  onOpenConversation,
  onInterruptConversation
}: {
  group: SidebarProjectGroup
  nativeBackdrop: boolean
  onToggleCollapsed: () => void
  onNewChat: () => void
  onArchiveConversation: (conversationId: string) => void
  onArchiveProjectChats: () => void
  onRemoveProject: () => void
  onOpenConversation: (conversationId: string) => void
  onInterruptConversation: (conversationId: string) => void
}): React.JSX.Element {
  const Chevron = group.collapsed ? ChevronRightIcon : ChevronDownIcon
  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          'group flex min-h-8 items-center gap-1 rounded-md px-1 transition-colors',
          group.active && 'bg-muted',
          nativeBackdrop ? 'hover:bg-background/40 dark:hover:bg-foreground/8' : 'hover:bg-muted'
        )}
      >
        <button
          className="grid size-6 place-items-center rounded-md text-muted-foreground"
          type="button"
          aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          aria-expanded={!group.collapsed}
          onClick={onToggleCollapsed}
        >
          <Chevron className="size-3.5" />
        </button>
        <button
          className="flex min-w-0 flex-1 py-1 text-left text-sm"
          type="button"
          onClick={onToggleCollapsed}
        >
          <span className="truncate font-medium text-foreground">{group.label}</span>
        </button>
        {group.warning ? (
          <span
            className="grid size-6 place-items-center text-amber-600 dark:text-amber-400"
            title={group.warning}
          >
            <AlertTriangleIcon className="size-3.5" />
          </span>
        ) : null}
        <button
          className="pointer-events-none grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-accent focus-visible:pointer-events-auto focus-visible:opacity-100"
          type="button"
          aria-label={`New chat in ${group.label}`}
          title={`New chat in ${group.label}`}
          onClick={onNewChat}
        >
          <PencilIcon className="size-3.5" />
        </button>
        <button
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          type="button"
          aria-label={`Archive chats in ${group.label}`}
          title={`Archive chats in ${group.label}`}
          disabled={group.threadCount === 0}
          onClick={onArchiveProjectChats}
        >
          <ArchiveIcon className="size-3.5" />
        </button>
        <button
          className="grid size-6 place-items-center rounded-md text-destructive hover:bg-destructive/10"
          type="button"
          aria-label={`Remove ${group.label}`}
          title={`Remove ${group.label}`}
          onClick={onRemoveProject}
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>
      {!group.collapsed ? (
        <div className="space-y-0.5 pl-5">
          {group.conversations.length === 0 ? (
            <div className="px-3 py-1 text-xs text-muted-foreground">暂无对话</div>
          ) : (
            group.conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                nativeBackdrop={nativeBackdrop}
                onOpen={() => onOpenConversation(conversation.id)}
                onArchive={() => onArchiveConversation(conversation.id)}
                onInterrupt={() => onInterruptConversation(conversation.id)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
