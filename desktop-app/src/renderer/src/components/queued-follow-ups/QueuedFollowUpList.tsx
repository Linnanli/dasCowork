import { useCallback, useEffect, useRef, useState } from 'react'

import type { FollowUpMode, QueuedFollowUpItem } from '../../../../shared/codexFollowUpApi'
import { QueuedFollowUpRow } from './QueuedFollowUpRow'

type MaybePromise = void | Promise<void>

export type QueuedFollowUpEditContext = {
  beforeId?: string
  afterId?: string
}

export type QueuedFollowUpListProps = {
  items: QueuedFollowUpItem[]
  conversationKey?: string
  defaultMode: FollowUpMode
  pendingItemIds?: ReadonlySet<string>
  announcement?: string
  onEdit?: (item: QueuedFollowUpItem, context: QueuedFollowUpEditContext) => MaybePromise
  onDelete: (itemId: string) => MaybePromise
  onMoveUp: (itemId: string) => MaybePromise
  onMoveDown: (itemId: string) => MaybePromise
  onReorder?: (itemId: string, position: { beforeId: string } | { afterId: string }) => MaybePromise
  onSteer: (itemId: string) => MaybePromise
  onRetry: (itemId: string) => MaybePromise
  onToggleQueueing: () => MaybePromise
  onRequestComposerFocus?: () => void
  onActionError?: (error: unknown) => void
}

export function QueuedFollowUpList({
  items,
  conversationKey,
  defaultMode,
  pendingItemIds = EMPTY_PENDING_IDS,
  announcement = '',
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onReorder,
  onSteer,
  onRetry,
  onToggleQueueing,
  onRequestComposerFocus,
  onActionError
}: QueuedFollowUpListProps): React.JSX.Element | null {
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const [focusRequest, setFocusRequest] = useState<{
    itemId: string | null
    serial: number
  } | null>(null)
  const [localAnnouncement, setLocalAnnouncement] = useState('')
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)

  useEffect(() => {
    if (!focusRequest) return
    if (focusRequest.itemId) {
      const row = rowRefs.current.get(focusRequest.itemId)
      if (row) {
        row.focus()
        return
      }
    }
    onRequestComposerFocus?.()
  }, [focusRequest, items, onRequestComposerFocus])

  const requestFocus = useCallback((itemId: string | null) => {
    setFocusRequest((current) => ({ itemId, serial: (current?.serial ?? 0) + 1 }))
  }, [])

  const runAction = useCallback(
    async ({
      action,
      successFocusId,
      failureFocusId,
      successMessage
    }: {
      action: () => MaybePromise
      successFocusId: string | null
      failureFocusId: string
      successMessage: string
    }) => {
      try {
        await action()
        setLocalAnnouncement(successMessage)
        requestFocus(successFocusId)
      } catch (error) {
        onActionError?.(error)
        requestFocus(failureFocusId)
      }
    },
    [onActionError, requestFocus]
  )

  if (items.length === 0) return null

  return (
    <section
      aria-label="Queued follow-ups"
      className="max-h-[30dvh] overflow-y-auto overscroll-contain rounded-t-3xl border border-b-0 border-border/60 bg-background/95 dark:bg-muted/55"
      data-conversation-key={conversationKey}
      data-slot="queued-follow-up-list"
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {announcement || localAnnouncement}
      </p>
      <ol data-slot="queued-follow-up-items">
        {items.map((item, index) => {
          const previousItem = items[index - 1]
          const nextItem = items[index + 1]
          const deleteFocusId = nextItem?.id ?? previousItem?.id ?? null
          const editContext = {
            beforeId: nextItem?.id,
            afterId: previousItem?.id
          }

          return (
            <QueuedFollowUpRow
              key={item.id}
              ref={(node) => {
                if (node) rowRefs.current.set(item.id, node)
                else rowRefs.current.delete(item.id)
              }}
              item={item}
              position={index}
              totalItems={items.length}
              defaultMode={defaultMode}
              busy={pendingItemIds.has(item.id)}
              onEdit={
                onEdit
                  ? () =>
                      runAction({
                        action: () => onEdit(item, editContext),
                        successFocusId: null,
                        failureFocusId: item.id,
                        successMessage: `Editing follow-up ${index + 1}.`
                      })
                  : undefined
              }
              onDelete={() =>
                runAction({
                  action: () => onDelete(item.id),
                  successFocusId: deleteFocusId,
                  failureFocusId: item.id,
                  successMessage: `Deleted follow-up ${index + 1}.`
                })
              }
              onMoveUp={() =>
                runAction({
                  action: () => onMoveUp(item.id),
                  successFocusId: item.id,
                  failureFocusId: item.id,
                  successMessage: `Moved follow-up ${index + 1} up.`
                })
              }
              onMoveDown={() =>
                runAction({
                  action: () => onMoveDown(item.id),
                  successFocusId: item.id,
                  failureFocusId: item.id,
                  successMessage: `Moved follow-up ${index + 1} down.`
                })
              }
              onSteer={() =>
                runAction({
                  action: () => onSteer(item.id),
                  successFocusId: item.id,
                  failureFocusId: item.id,
                  successMessage: `第 ${index + 1} 条排队消息正在引导当前任务。`
                })
              }
              onRetry={() =>
                runAction({
                  action: () => onRetry(item.id),
                  successFocusId: item.id,
                  failureFocusId: item.id,
                  successMessage: `Retrying follow-up ${index + 1}.`
                })
              }
              onToggleQueueing={() =>
                runAction({
                  action: onToggleQueueing,
                  successFocusId: item.id,
                  failureFocusId: item.id,
                  successMessage:
                    defaultMode === 'queue' ? '已关闭后续消息排队。' : '已开启后续消息排队。'
                })
              }
              onDragStart={(event) => {
                setDraggedItemId(item.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.id)
              }}
              onDragEnd={() => setDraggedItemId(null)}
              onDragOver={(event) => {
                if (!onReorder || !draggedItemId || draggedItemId === item.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = draggedItemId ?? event.dataTransfer.getData('text/plain')
                setDraggedItemId(null)
                if (!onReorder || !sourceId || sourceId === item.id) return
                const sourceIndex = items.findIndex((candidate) => candidate.id === sourceId)
                if (sourceIndex < 0) return
                void runAction({
                  action: () =>
                    onReorder(
                      sourceId,
                      sourceIndex < index ? { afterId: item.id } : { beforeId: item.id }
                    ),
                  successFocusId: sourceId,
                  failureFocusId: sourceId,
                  successMessage: `Moved follow-up ${sourceIndex + 1} to position ${index + 1}.`
                })
              }}
            />
          )
        })}
      </ol>
    </section>
  )
}

const EMPTY_PENDING_IDS: ReadonlySet<string> = new Set()
