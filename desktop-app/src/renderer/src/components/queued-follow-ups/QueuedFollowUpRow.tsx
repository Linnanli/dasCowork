import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  GripVerticalIcon,
  ListRestartIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon
} from 'lucide-react'
import { forwardRef, useRef } from 'react'
import type { DragEvent } from 'react'

import type { FollowUpMode, QueuedFollowUpItem } from '../../../../shared/codexFollowUpApi'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

export type QueuedFollowUpRowProps = {
  item: QueuedFollowUpItem
  position: number
  totalItems: number
  defaultMode: FollowUpMode
  busy?: boolean
  onEdit?: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onMoveUp: () => void | Promise<void>
  onMoveDown: () => void | Promise<void>
  onSteer: () => void | Promise<void>
  onRetry: () => void | Promise<void>
  onToggleQueueing: () => void | Promise<void>
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver?: (event: DragEvent<HTMLLIElement>) => void
  onDrop?: (event: DragEvent<HTMLLIElement>) => void
}

export const QueuedFollowUpRow = forwardRef<HTMLLIElement, QueuedFollowUpRowProps>(
  function QueuedFollowUpRow(
    {
      item,
      position,
      totalItems,
      defaultMode,
      busy = false,
      onEdit,
      onDelete,
      onMoveUp,
      onMoveDown,
      onSteer,
      onRetry,
      onToggleQueueing,
      onDragStart,
      onDragEnd,
      onDragOver,
      onDrop
    },
    ref
  ) {
    const paused = item.status.startsWith('paused-')
    const settling = item.status === 'sending' || item.status === 'steering'
    const summary = messageSummary(item)
    const canReorder =
      !busy && !settling && item.status !== 'editing' && !(position === 0 && paused)
    const menuActionSelected = useRef(false)

    return (
      <li
        ref={ref}
        onDragOver={onDragOver}
        onDrop={onDrop}
        tabIndex={-1}
        data-item-id={item.id}
        data-slot="queued-follow-up-row"
        data-status={item.status}
        aria-label={`第 ${position + 1} 条排队消息，共 ${totalItems} 条：${summary}`}
        className="group flex min-h-13 items-center gap-1 border-b border-border/55 px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          draggable={canReorder}
          aria-label={`拖动第 ${position + 1} 条排队消息`}
          title="拖动排序"
          disabled={!canReorder}
          data-slot="queued-follow-up-drag-handle"
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <GripVerticalIcon />
        </Button>
        <ListRestartIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 px-1.5">
          <p className="truncate text-sm text-foreground" title={summary}>
            {summary}
          </p>
          {paused && item.pause?.userMessage ? (
            <p className="truncate text-xs text-destructive" title={item.pause.userMessage}>
              {item.pause.userMessage}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {paused && item.status !== 'paused-interrupted' ? (
            <ActionButton
              label={`重试第 ${position + 1} 条排队消息`}
              disabled={busy || position !== 0}
              onClick={onRetry}
              className="w-auto gap-1 px-2 text-muted-foreground"
            >
              <RotateCcwIcon />
              <span>重试</span>
            </ActionButton>
          ) : item.status === 'queued' ? (
            <ActionButton
              label={`引导第 ${position + 1} 条排队消息`}
              disabled={busy}
              onClick={onSteer}
              className="w-auto gap-1 px-2 text-muted-foreground"
            >
              <CornerDownLeftIcon />
              <span>引导</span>
            </ActionButton>
          ) : null}
          <ActionButton
            label={`删除第 ${position + 1} 条排队消息`}
            disabled={busy || settling}
            onClick={onDelete}
          >
            <Trash2Icon />
          </ActionButton>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) menuActionSelected.current = false
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`第 ${position + 1} 条排队消息的更多操作`}
                title="更多"
                disabled={busy || settling}
                data-slot="queued-follow-up-more"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (menuActionSelected.current) event.preventDefault()
              }}
            >
              {onEdit ? (
                <DropdownMenuItem
                  onSelect={() => {
                    menuActionSelected.current = true
                    void onEdit()
                  }}
                >
                  <PencilIcon />
                  编辑消息
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => {
                  menuActionSelected.current = true
                  void onToggleQueueing()
                }}
              >
                <ListRestartIcon />
                {defaultMode === 'queue' ? '关闭排队' : '开启排队'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canReorder || position === 0}
                onSelect={() => {
                  menuActionSelected.current = true
                  void onMoveUp()
                }}
              >
                <ArrowUpIcon />
                上移
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canReorder || position === totalItems - 1}
                onSelect={() => {
                  menuActionSelected.current = true
                  void onMoveDown()
                }}
              >
                <ArrowDownIcon />
                下移
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
    )
  }
)

function ActionButton({
  label,
  disabled,
  onClick,
  className,
  children
}: {
  label: string
  disabled: boolean
  onClick: () => void | Promise<void>
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={className}
      onClick={() => void onClick()}
    >
      {children}
    </Button>
  )
}

function messageSummary(item: QueuedFollowUpItem): string {
  const text = item.message.text.replace(/\s+/gu, ' ').trim()
  if (text) return text
  if (item.message.attachments.length > 0) return 'Attachment-only follow-up'
  return 'Empty follow-up'
}
