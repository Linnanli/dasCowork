import { useEffect, useRef, useState } from 'react'
import { AlertTriangleIcon, ChevronDownIcon, FolderIcon, PencilIcon, TrashIcon } from 'lucide-react'

import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import { ConversationRow } from './ConversationRow'
import type { SidebarProjectGroup } from './sidebarTypes'

const collapseTransitionMs = 200

export function ProjectGroupRow({
  group,
  nativeBackdrop,
  onToggleCollapsed,
  onNewChat,
  onRemoveProject,
  onOpenConversation,
  onInterruptConversation
}: {
  group: SidebarProjectGroup
  nativeBackdrop: boolean
  onToggleCollapsed: () => void
  onNewChat: () => void
  onRemoveProject: () => void
  onOpenConversation: (conversationId: string) => void
  onInterruptConversation: (conversationId: string) => void
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-0.5">
      <div
        className={cn(
          'group flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1 transition-colors',
          group.active && 'bg-muted',
          nativeBackdrop ? 'hover:bg-background/40 dark:hover:bg-foreground/8' : 'hover:bg-muted'
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-foreground">{group.label}</span>
        </div>
        <Button
          className="pointer-events-none shrink-0 text-muted-foreground opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          size="icon-xs"
          type="button"
          variant="ghost"
          aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          aria-expanded={!group.collapsed}
          onClick={onToggleCollapsed}
        >
          <ChevronDownIcon
            className={cn(
              'size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
              group.collapsed && '-rotate-90'
            )}
          />
        </Button>
        {group.warning ? (
          <span
            className="grid size-6 shrink-0 place-items-center text-amber-600 dark:text-amber-400"
            title={group.warning}
          >
            <AlertTriangleIcon className="size-3.5" />
          </span>
        ) : null}
        <Button
          className="pointer-events-none shrink-0 text-muted-foreground opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          size="icon-xs"
          type="button"
          variant="ghost"
          aria-label={`New chat in ${group.label}`}
          title={`New chat in ${group.label}`}
          onClick={onNewChat}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          className="pointer-events-none shrink-0 text-destructive opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100"
          size="icon-xs"
          type="button"
          variant="ghost"
          aria-label={`Remove ${group.label}`}
          title={`Remove ${group.label}`}
          onClick={onRemoveProject}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
      <ProjectGroupConversations
        collapsed={group.collapsed}
        group={group}
        nativeBackdrop={nativeBackdrop}
        onOpenConversation={onOpenConversation}
        onInterruptConversation={onInterruptConversation}
      />
    </div>
  )
}

function ProjectGroupConversations({
  collapsed,
  group,
  nativeBackdrop,
  onOpenConversation,
  onInterruptConversation
}: {
  collapsed: boolean
  group: SidebarProjectGroup
  nativeBackdrop: boolean
  onOpenConversation: (conversationId: string) => void
  onInterruptConversation: (conversationId: string) => void
}): React.JSX.Element | null {
  const [shouldRender, setShouldRender] = useState(!collapsed)
  const [expanded, setExpanded] = useState(!collapsed)
  const collapseTimeoutRef = useRef<number | null>(null)
  const expandFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current)
      collapseTimeoutRef.current = null
    }
    if (expandFrameRef.current !== null) {
      window.cancelAnimationFrame(expandFrameRef.current)
      expandFrameRef.current = null
    }

    if (!collapsed) {
      expandFrameRef.current = window.requestAnimationFrame(() => {
        setShouldRender(true)
        expandFrameRef.current = window.requestAnimationFrame(() => {
          setExpanded(true)
          expandFrameRef.current = null
        })
      })
      return
    }

    expandFrameRef.current = window.requestAnimationFrame(() => {
      setExpanded(false)
      expandFrameRef.current = null
      collapseTimeoutRef.current = window.setTimeout(() => {
        setShouldRender(false)
        collapseTimeoutRef.current = null
      }, collapseTransitionMs)
    })
  }, [collapsed])

  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current !== null) window.clearTimeout(collapseTimeoutRef.current)
      if (expandFrameRef.current !== null) window.cancelAnimationFrame(expandFrameRef.current)
    }
  }, [])

  if (!shouldRender) return null

  return (
    <div
      aria-hidden={collapsed}
      className={cn(
        'grid min-w-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      )}
      inert={collapsed ? true : undefined}
      onTransitionEnd={(event) => {
        if (event.currentTarget !== event.target) return
        if (event.propertyName !== 'grid-template-rows') return
        if (!collapsed) return
        if (collapseTimeoutRef.current !== null) {
          window.clearTimeout(collapseTimeoutRef.current)
          collapseTimeoutRef.current = null
        }
        setShouldRender(false)
      }}
    >
      <div className={cn('min-h-0 min-w-0 overflow-hidden', collapsed && 'pointer-events-none')}>
        <div className="min-w-0 space-y-0.5 pl-5">
          {group.conversations.length === 0 ? (
            <div className="px-3 py-1 text-xs text-muted-foreground">暂无对话</div>
          ) : (
            group.conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                nativeBackdrop={nativeBackdrop}
                onOpen={() => onOpenConversation(conversation.id)}
                onInterrupt={() => onInterruptConversation(conversation.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
