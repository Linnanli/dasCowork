// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ConversationFollowUpState,
  DesktopCodexFollowUpApi,
  PreparedFollowUpTurnStart,
  QueuedFollowUpItem,
  QueuedUserMessageSnapshotInput
} from '../../../shared/codexFollowUpApi'
import type { ConversationChatEntry } from '../runtime/ConversationChatRegistry'
import {
  dispatchFollowUpHead,
  steerFollowUpItemWithOptimisticMessage,
  useConversationFollowUpCoordinator
} from './useConversationFollowUpCoordinator'

describe('conversation follow-up coordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts a normal queued turn with a main-owned request and stable message id', async () => {
    const item = createItem('queue')
    const state = createState([])
    const sendMessage = vi.fn(async () => undefined)
    const api = createApi({
      prepareNextTurn: vi.fn(async () => ({
        request: {
          conversationKey: item.conversationKey,
          itemId: item.id
        },
        message: {
          id: item.message.id,
          parts: [{ type: 'text' as const, text: item.message.text }],
          contextReferences: [],
          trustedContext: item.message.trustedContext
        }
      })),
      getState: vi.fn(async () => state)
    })

    await dispatchFollowUpHead(api, createEntry(sendMessage), item, false)

    expect(api.prepareNextTurn).toHaveBeenCalledWith('conversation-1', 'item-1')
    expect(sendMessage).toHaveBeenCalledWith(
      {
        id: 'item-1',
        role: 'user',
        parts: [{ type: 'text', text: 'follow up' }]
      },
      {
        body: {
          followUpRequest: {
            conversationKey: 'conversation-1',
            itemId: 'item-1'
          }
        }
      }
    )
  })

  it('continues reading the queue under a thread id bound during follow-up delivery', async () => {
    const item = createItem('queue')
    const migratedState = {
      ...createState([]),
      conversationKey: 'thread-migrated'
    }
    const sendMessage = vi.fn(async () => {
      entry.context.threadId = 'thread-migrated'
    })
    const entry = createEntry(sendMessage)
    const api = createApi({
      prepareNextTurn: vi.fn(async () => ({
        request: {
          conversationKey: item.conversationKey,
          itemId: item.id
        },
        message: {
          id: item.message.id,
          parts: [{ type: 'text' as const, text: item.message.text }],
          contextReferences: [],
          trustedContext: item.message.trustedContext
        }
      })),
      getState: vi.fn(async () => migratedState)
    })

    await dispatchFollowUpHead(api, entry, item, false)

    expect(api.getState).toHaveBeenCalledWith('thread-migrated')
  })

  it('shows one stable optimistic Steer message after app-server acceptance', async () => {
    const item = createItem('steer')
    const entry = createEntry()
    const state = createState([])
    const api = createApi({ steerNext: vi.fn(async () => state) })

    await dispatchFollowUpHead(api, entry, item, true)
    await dispatchFollowUpHead(api, entry, item, true)

    expect(entry.chat.messages.filter((message) => message.id === 'item-1')).toHaveLength(1)
    expect(api.steerNext).toHaveBeenCalledWith('conversation-1', 'item-1')
  })

  it('removes the optimistic Steer message when app-server rejects it', async () => {
    const item = createItem('steer')
    const entry = createEntry()
    const api = createApi({
      steerNext: vi.fn(async () => {
        throw new Error('turn ended')
      })
    })

    await expect(dispatchFollowUpHead(api, entry, item, true)).rejects.toThrow('turn ended')
    expect(entry.chat.messages).toEqual([])
  })

  it('renders a local image correctly in an optimistic Composer Steer message', async () => {
    const entry = createEntry()
    const message = {
      ...createItem('steer').message,
      attachments: [
        {
          kind: 'local-image',
          id: 'local-image-1',
          path: '/repo/截图 one.png',
          capabilityToken: 'picker-token',
          previewUrl: 'app://fs/@fs/repo/%E6%88%AA%E5%9B%BE%20one.png',
          displayName: '截图 one.png',
          mediaType: 'image/png'
        }
      ]
    } satisfies QueuedUserMessageSnapshotInput

    await steerFollowUpItemWithOptimisticMessage(
      entry.chat,
      message,
      vi.fn(async () => undefined)
    )

    expect(entry.chat.messages[0]?.parts).toEqual([
      { type: 'text', text: 'follow up' },
      {
        type: 'file',
        filename: '截图 one.png',
        mediaType: 'image/png',
        url: 'app://fs/@fs/repo/%E6%88%AA%E5%9B%BE%20one.png'
      }
    ])
  })

  it('keeps materialized persisted assets in an optimistic queue-row Steer message', async () => {
    const entry = createEntry()

    await steerFollowUpItemWithOptimisticMessage(
      entry.chat,
      {
        id: 'item-1',
        parts: [
          { type: 'text', text: 'follow up' },
          {
            type: 'file',
            filename: 'queued.png',
            mediaType: 'image/png',
            url: 'data:image/png;base64,cXVldWVk'
          }
        ],
        contextReferences: [],
        trustedContext: createItem('steer').message.trustedContext
      },
      vi.fn(async () => undefined)
    )

    expect(entry.chat.messages[0]?.parts).toEqual([
      { type: 'text', text: 'follow up' },
      {
        type: 'file',
        filename: 'queued.png',
        mediaType: 'image/png',
        url: 'data:image/png;base64,cXVldWVk'
      }
    ])
  })

  it('waits for the conversation to finish loading before dispatching the queue head', async () => {
    vi.useFakeTimers()
    const item = createItem('queue')
    const entry = createReadyEntry()
    entry.loaded = false
    const sendMessage = vi.mocked(entry.chat.sendMessage)
    const api = createApi({
      getState: vi
        .fn()
        .mockResolvedValueOnce(createState([item]))
        .mockResolvedValueOnce(createState([])),
      prepareNextTurn: vi.fn(async () => preparedTurn(item))
    })
    const root = createRoot(document.createElement('div'))

    try {
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(sendMessage).not.toHaveBeenCalled()

      entry.loaded = true
      entry.phase = 'error'
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(sendMessage).not.toHaveBeenCalled()

      entry.phase = 'ready'
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })
      expect(sendMessage).toHaveBeenCalledTimes(1)
    } finally {
      act(() => root.unmount())
    }
  })

  it('refreshes queue state and retries a transient renderer delivery failure', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const item = createItem('queue')
    const entry = createReadyEntry()
    const sendMessage = vi
      .mocked(entry.chat.sendMessage)
      .mockRejectedValueOnce(new Error('renderer transport was not ready'))
      .mockResolvedValueOnce(undefined)
    const api = createApi({
      getState: vi
        .fn()
        .mockResolvedValueOnce(createState([item]))
        .mockResolvedValueOnce(createState([item]))
        .mockResolvedValueOnce(createState([])),
      prepareNextTurn: vi.fn(async () => preparedTurn(item))
    })
    const root = createRoot(document.createElement('div'))

    try {
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(api.getState).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(249)
      })
      expect(sendMessage).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await flushPromises()
      })

      expect(sendMessage).toHaveBeenCalledTimes(2)
      expect(api.getState).toHaveBeenCalledTimes(3)
    } finally {
      act(() => root.unmount())
    }
  })
})

function CoordinatorProbe({
  api,
  entries
}: {
  api: DesktopCodexFollowUpApi
  entries: readonly ConversationChatEntry[]
}): null {
  useConversationFollowUpCoordinator(entries, api)
  return null
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createApi(overrides: Partial<DesktopCodexFollowUpApi> = {}): DesktopCodexFollowUpApi {
  return {
    getState: vi.fn(async () => createState([])),
    enqueue: vi.fn(),
    edit: vi.fn(),
    beginEdit: vi.fn(),
    commitEdit: vi.fn(),
    cancelEdit: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
    requestSendNow: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    setDefaultMode: vi.fn(),
    prepareNextTurn: vi.fn(),
    materializeItem: vi.fn(),
    steerItem: vi.fn(),
    steerNext: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    ...overrides
  }
}

function createEntry(
  sendMessage: (message?: unknown, options?: unknown) => Promise<void> = vi.fn(
    async () => undefined
  )
): ConversationChatEntry {
  return {
    localId: 'conversation-1',
    newConversation: false,
    chat: {
      messages: [],
      sendMessage
    },
    transport: {},
    context: {
      conversationId: 'conversation-1',
      threadId: 'conversation-1'
    },
    phase: 'streaming',
    unread: false,
    draft: '',
    draftAttachments: [],
    loaded: true
  } as unknown as ConversationChatEntry
}

function createReadyEntry(): ConversationChatEntry {
  const entry = createEntry()
  entry.phase = 'ready'
  Object.assign(entry.chat, { status: 'ready' })
  return entry
}

function preparedTurn(item: QueuedFollowUpItem): PreparedFollowUpTurnStart {
  return {
    request: {
      conversationKey: item.conversationKey,
      itemId: item.id
    },
    message: {
      id: item.message.id,
      parts: [{ type: 'text' as const, text: item.message.text }],
      contextReferences: [],
      trustedContext: item.message.trustedContext
    }
  }
}

function createItem(preferredMode: 'queue' | 'steer'): QueuedFollowUpItem {
  return {
    id: 'item-1',
    conversationKey: 'conversation-1',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    preferredMode,
    status: 'queued',
    message: {
      id: 'item-1',
      text: 'follow up',
      attachments: [],
      contextReferences: [],
      trustedContext: {
        conversationId: 'conversation-1',
        threadId: 'conversation-1',
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo']
      }
    }
  }
}

function createState(items: QueuedFollowUpItem[]): ConversationFollowUpState {
  return {
    version: 2,
    revision: 1,
    conversationKey: 'conversation-1',
    defaultMode: 'queue',
    archived: false,
    items
  }
}
