import { useEffect, useRef, useState } from 'react'
import type { Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'

import type {
  ConversationFollowUpState,
  DesktopCodexFollowUpApi,
  MaterializedQueuedUserMessage,
  QueuedFollowUpItem,
  QueuedUserMessageSnapshot,
  QueuedUserMessageSnapshotInput
} from '../../../shared/codexFollowUpApi'
import { materializedMediaTypeForLocalAttachment } from '../../../shared/codexFollowUpApi'
import type { ConversationChatEntry } from '../runtime/ConversationChatRegistry'

const CHAT_STATUS_POLL_INTERVAL_MS = 50
const DELIVERY_RETRY_INITIAL_DELAY_MS = 250
const DELIVERY_RETRY_MAX_DELAY_MS = 5_000

type DeliveryRetry = {
  attempt: number
  retryAt: number
}

export function useConversationFollowUpCoordinator(
  entries: readonly ConversationChatEntry[],
  api: DesktopCodexFollowUpApi | undefined
): void {
  const states = useRef(new Map<string, ConversationFollowUpState>())
  const loadedConversationKeys = useRef(new Set<string>())
  const dispatchingConversationKeys = useRef(new Set<string>())
  const deliveryRetries = useRef(new Map<string, DeliveryRetry>())
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!api) return
    return api.subscribe((event) => {
      const current = states.current.get(event.state.conversationKey)
      if (current && current.revision > event.state.revision) return
      states.current.set(event.state.conversationKey, event.state)
      for (const item of event.state.items) {
        if (item.status === 'queued') {
          deliveryRetries.current.delete(deliveryRetryKey(event.state.conversationKey, item.id))
        }
      }
      loadedConversationKeys.current.add(event.state.conversationKey)
      setRevision((value) => value + 1)
    })
  }, [api])

  useEffect(() => {
    if (!api) return
    let cancelled = false
    for (const entry of entries) {
      const conversationKey = conversationKeyForEntry(entry)
      if (loadedConversationKeys.current.has(conversationKey)) continue
      loadedConversationKeys.current.add(conversationKey)
      void api
        .getState(conversationKey)
        .then((state) => {
          if (cancelled) return
          states.current.set(conversationKey, state)
          setRevision((value) => value + 1)
        })
        .catch(() => {
          loadedConversationKeys.current.delete(conversationKey)
        })
    }
    return () => {
      cancelled = true
    }
  }, [api, entries])

  useEffect(() => {
    if (!api) return
    let nextWakeDelayMs: number | undefined
    const requestWake = (delayMs: number): void => {
      const boundedDelay = Math.max(0, delayMs)
      nextWakeDelayMs =
        nextWakeDelayMs === undefined ? boundedDelay : Math.min(nextWakeDelayMs, boundedDelay)
    }

    for (const entry of entries) {
      const conversationKey = conversationKeyForEntry(entry)
      const state = states.current.get(conversationKey)
      const head = state?.items[0]
      if (
        !state ||
        state.archived ||
        !head ||
        head.status !== 'queued' ||
        dispatchingConversationKeys.current.has(conversationKey)
      ) {
        continue
      }

      if (!entry.loaded || entry.phase === 'loading') {
        requestWake(CHAT_STATUS_POLL_INTERVAL_MS)
        continue
      }
      if (entry.phase !== 'ready') {
        if (entry.phase === 'submitted' || entry.phase === 'streaming') {
          requestWake(CHAT_STATUS_POLL_INTERVAL_MS)
        }
        continue
      }

      const retryKey = deliveryRetryKey(conversationKey, head.id)
      const retry = deliveryRetries.current.get(retryKey)
      if (retry && retry.retryAt > Date.now()) {
        requestWake(retry.retryAt - Date.now())
        continue
      }

      const chatStatus = entry.chat.status ?? entry.phase
      const running = chatStatus === 'submitted' || chatStatus === 'streaming'
      if (running) {
        // Running-turn Steer is always an explicit renderer action now. The
        // Composer and row action call steerItem(itemId), which also supports
        // selecting a non-head item. Keeping automatic head Steer here would
        // race that explicit call and can incorrectly steer an older Queue item.
        requestWake(CHAT_STATUS_POLL_INTERVAL_MS)
        continue
      }
      if (chatStatus !== 'ready') {
        if (chatStatus !== 'error') requestWake(CHAT_STATUS_POLL_INTERVAL_MS)
        continue
      }

      dispatchingConversationKeys.current.add(conversationKey)
      void dispatchFollowUpHead(api, entry, head, false)
        .then((nextState) => {
          deliveryRetries.current.delete(retryKey)
          states.current.set(nextState.conversationKey, nextState)
        })
        .catch(async (error) => {
          console.warn('[follow-up:renderer-dispatch-failed]', {
            conversationKey,
            itemId: head.id,
            error: error instanceof Error ? error.message : String(error)
          })

          let refreshedState: ConversationFollowUpState | undefined
          try {
            refreshedState = await api.getState(conversationKeyForEntry(entry))
            states.current.set(refreshedState.conversationKey, refreshedState)
          } catch {
            // A failed state refresh must not turn a transient renderer failure
            // into a permanently stranded queue item.
          }

          const refreshedHead = refreshedState?.items[0]
          if (
            refreshedState &&
            (refreshedState.archived ||
              !refreshedHead ||
              refreshedHead.id !== head.id ||
              refreshedHead.status !== 'queued')
          ) {
            deliveryRetries.current.delete(retryKey)
            return
          }

          const previousAttempt = deliveryRetries.current.get(retryKey)?.attempt ?? 0
          const attempt = previousAttempt + 1
          const delayMs = Math.min(
            DELIVERY_RETRY_INITIAL_DELAY_MS * 2 ** (attempt - 1),
            DELIVERY_RETRY_MAX_DELAY_MS
          )
          deliveryRetries.current.set(retryKey, {
            attempt,
            retryAt: Date.now() + delayMs
          })
        })
        .finally(() => {
          dispatchingConversationKeys.current.delete(conversationKey)
          setRevision((value) => value + 1)
        })
    }

    if (nextWakeDelayMs === undefined) return
    const timer = window.setTimeout(() => setRevision((value) => value + 1), nextWakeDelayMs)
    return () => window.clearTimeout(timer)
  }, [api, entries, revision])
}

function deliveryRetryKey(conversationKey: string, itemId: string): string {
  return `${conversationKey}\u0000${itemId}`
}

export async function dispatchFollowUpHead(
  api: DesktopCodexFollowUpApi,
  entry: ConversationChatEntry,
  head: QueuedFollowUpItem,
  running: boolean
): Promise<ConversationFollowUpState> {
  if (running) {
    return steerFollowUpItemWithOptimisticMessage(entry.chat, head.message, () =>
      api.steerNext(head.conversationKey, head.id)
    )
  }

  await waitForChatReady(entry)
  const delivery = await api.prepareNextTurn(head.conversationKey, head.id)
  await entry.chat.sendMessage(
    {
      id: delivery.message.id,
      role: 'user',
      parts: delivery.message.parts
    },
    { body: { followUpRequest: delivery.request } }
  )
  return api.getState(conversationKeyForEntry(entry))
}

export async function steerFollowUpItemWithOptimisticMessage<T>(
  chat: Chat<UIMessage>,
  message:
    | MaterializedQueuedUserMessage
    | QueuedUserMessageSnapshot
    | QueuedUserMessageSnapshotInput,
  steer: () => Promise<T>
): Promise<T> {
  const currentMessages = chat.messages ?? []
  const hadMessage = currentMessages.some((candidate) => candidate.id === message.id)
  if (!hadMessage) {
    chat.messages = [...currentMessages, optimisticSteerMessage(message)]
  }
  try {
    return await steer()
  } catch (error) {
    if (!hadMessage) {
      chat.messages = (chat.messages ?? []).filter((candidate) => candidate.id !== message.id)
    }
    throw error
  }
}

async function waitForChatReady(entry: ConversationChatEntry): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (entry.chat.status === 'ready' || entry.chat.status === undefined) return
    if (entry.chat.status === 'error') throw new Error('Conversation is not ready for a follow-up')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Conversation did not become ready for the queued follow-up')
}

function optimisticSteerMessage(
  message:
    | MaterializedQueuedUserMessage
    | QueuedUserMessageSnapshot
    | QueuedUserMessageSnapshotInput
): UIMessage {
  if ('parts' in message) {
    return {
      id: message.id,
      role: 'user',
      parts: message.parts
    }
  }

  return {
    id: message.id,
    role: 'user',
    parts: [
      { type: 'text', text: message.text },
      ...message.attachments.flatMap((attachment) => {
        if (attachment.kind === 'persisted-asset') return []
        if (attachment.kind === 'inline-asset') {
          return [
            {
              type: 'file' as const,
              filename: attachment.displayName,
              mediaType: attachment.mediaType,
              url: `data:${attachment.mediaType};base64,${attachment.data}`
            }
          ]
        }
        if (attachment.kind === 'local-image') {
          return [
            {
              type: 'file' as const,
              filename: attachment.displayName,
              mediaType: attachment.mediaType,
              url: attachment.previewUrl
            }
          ]
        }
        return [
          {
            type: 'file' as const,
            filename: attachment.label,
            mediaType: materializedMediaTypeForLocalAttachment(attachment.kind),
            url: attachment.fileUrl
          }
        ]
      })
    ]
  }
}

function conversationKeyForEntry(entry: ConversationChatEntry): string {
  return entry.context.threadId ?? entry.context.conversationId
}
