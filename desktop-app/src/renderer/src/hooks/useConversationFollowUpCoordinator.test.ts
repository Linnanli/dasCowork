// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createVitestPlanAssertionRecorder,
  planAssertionsForScenarios
} from '../../../../scripts/lib/test-plan-assertions.mjs'

import type {
  ConversationFollowUpState,
  DesktopCodexFollowUpApi,
  FollowUpSteerPendingAck,
  PreparedFollowUpTurnStart,
  QueuedFollowUpItem,
  QueuedUserMessageSnapshotInput
} from '../../../shared/codexFollowUpApi'
import type { ConversationChatEntry } from '../runtime/ConversationChatRegistry'
import {
  parseComposerContextReferences,
  serializeComposerContextReference
} from '../composer/composerContextDirectiveFormatter'
import {
  dispatchFollowUpHead,
  steerFollowUpItemWithTranscript,
  toSteeringUIMessage,
  useConversationFollowUpCoordinator
} from './useConversationFollowUpCoordinator'

const steerAssertionIds = [
  '已显示回答保持不变',
  '复用原 turn，不能额外启动 turn',
  '队列顺序与对话隔离正确'
]
const { planAssert } = createVitestPlanAssertionRecorder(expect)

async function assertSteerPlanEvidence(
  scenarioIds: readonly string[],
  assertion: () => void | Promise<void>
): Promise<void> {
  const record = planAssertionsForScenarios(scenarioIds, planAssert)
  for (const assertionId of steerAssertionIds) {
    await record(assertionId, assertion)
  }
}

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

    await dispatchFollowUpHead(api, createReadyEntry(sendMessage), item)

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
    const entry = createReadyEntry(sendMessage)
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

    await dispatchFollowUpHead(api, entry, item)

    expect(api.getState).toHaveBeenCalledWith('thread-migrated')
  })

  it('stages one stable first-class Steer message before awaiting app-server acceptance', async () => {
    const item = createItem('steer')
    const entry = createEntry()
    const acknowledgement = deferred({
      delivery: 'pending-ack' as const,
      clientUserMessageId: 'item-1',
      targetTurnId: 'turn-server'
    })
    const steering = steerFollowUpItemWithTranscript(
      item.message,
      entry,
      () => acknowledgement.promise
    )

    expect(entry.controller.stageSteeringMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      { clientUserMessageId: 'item-1', targetTurnId: 'turn-active' }
    )
    expect(entry.controller.retargetSteeringMessage).not.toHaveBeenCalled()

    acknowledgement.resolve()
    await steering
    expect(entry.controller.retargetSteeringMessage).toHaveBeenCalledWith('item-1', 'turn-server')
  })

  it('rejects the first-class Steer message when app-server rejects it', async () => {
    const item = createItem('steer')
    const entry = createEntry()

    await expect(
      steerFollowUpItemWithTranscript(item.message, entry, async () => {
        throw new Error('turn ended')
      })
    ).rejects.toThrow('turn ended')
    expect(entry.controller.rejectSteeringMessage).toHaveBeenCalledWith('item-1')
  })

  it('materializes a local image correctly in a first-class Composer Steer message', () => {
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

    expect(toSteeringUIMessage(message).parts).toEqual([
      { type: 'text', text: 'follow up' },
      {
        type: 'file',
        filename: '截图 one.png',
        mediaType: 'image/png',
        url: 'app://fs/@fs/repo/%E6%88%AA%E5%9B%BE%20one.png'
      }
    ])
  })

  it('keeps materialized persisted assets in a first-class queue-row Steer message', () => {
    const message = toSteeringUIMessage({
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
    })

    expect(message.parts).toEqual([
      { type: 'text', text: 'follow up' },
      {
        type: 'file',
        filename: 'queued.png',
        mediaType: 'image/png',
        url: 'data:image/png;base64,cXVldWVk'
      }
    ])
  })

  it('A12 preserves text, image, file, folder, and context directives on the existing Steer turn', async () => {
    const directiveReference = {
      type: 'file' as const,
      label: 'implementation.ts',
      path: '/repo/src/implementation.ts'
    }
    const contextReference = {
      version: 1 as const,
      canonicalId: 'file:/repo/src/implementation.ts',
      kind: 'file' as const,
      presentation: 'mention' as const,
      label: directiveReference.label,
      path: directiveReference.path
    }
    const message = {
      id: 'rich-steer',
      text: `Please inspect ${serializeComposerContextReference(directiveReference)}`,
      attachments: [
        {
          kind: 'local-image' as const,
          id: 'image-1',
          path: '/repo/diagram.png',
          capabilityToken: 'image-token',
          previewUrl: 'app://fs/@fs/repo/diagram.png',
          displayName: 'diagram.png',
          mediaType: 'image/png'
        },
        {
          kind: 'file' as const,
          path: '/repo/src/implementation.ts',
          label: 'implementation.ts',
          fileUrl: 'file:///repo/src/implementation.ts'
        },
        {
          kind: 'folder' as const,
          path: '/repo/docs',
          label: 'docs',
          fileUrl: 'file:///repo/docs'
        }
      ],
      contextReferences: [contextReference],
      trustedContext: createItem('steer').message.trustedContext
    } satisfies QueuedUserMessageSnapshotInput
    const entry = createEntry()

    await steerFollowUpItemWithTranscript(message, entry, async () => createSteerAck(message.id))

    const stagedMessage = vi.mocked(entry.controller.stageSteeringMessage).mock.calls[0]?.[0]
    expect(stagedMessage).toEqual({
      id: 'rich-steer',
      role: 'user',
      parts: [
        { type: 'text', text: message.text },
        {
          type: 'file',
          filename: 'diagram.png',
          mediaType: 'image/png',
          url: 'app://fs/@fs/repo/diagram.png'
        },
        {
          type: 'file',
          filename: 'implementation.ts',
          mediaType: 'application/vnd.dascowork.local-file',
          url: 'file:///repo/src/implementation.ts'
        },
        {
          type: 'file',
          filename: 'docs',
          mediaType: 'application/vnd.dascowork.local-folder',
          url: 'file:///repo/docs'
        }
      ]
    })
    const textPart = stagedMessage?.parts.find((part) => part.type === 'text')
    expect(textPart?.type === 'text' ? parseComposerContextReferences(textPart.text) : []).toEqual([
      directiveReference
    ])
    expect(entry.controller.stageSteeringMessage).toHaveBeenCalledWith(expect.anything(), {
      clientUserMessageId: 'rich-steer',
      targetTurnId: 'turn-active'
    })
    expect(entry.controller.sendMessage).not.toHaveBeenCalled()
    await assertSteerPlanEvidence(['A12'], () => {
      expect(stagedMessage?.parts).toHaveLength(4)
      expect(entry.controller.stageSteeringMessage).toHaveBeenCalledWith(expect.anything(), {
        clientUserMessageId: 'rich-steer',
        targetTurnId: 'turn-active'
      })
      expect(entry.controller.sendMessage).not.toHaveBeenCalled()
    })
  })

  it('waits for loading, then dispatches a recovered failed conversation queue head as a new turn', async () => {
    vi.useFakeTimers()
    const item = createItem('queue')
    const entry = createReadyEntry()
    entry.loaded = false
    const sendMessage = vi.mocked(entry.controller.sendMessage)
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
      entry.status = 'error'
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(entry.controller.clearError).toHaveBeenCalledOnce()
    } finally {
      act(() => root.unmount())
    }
  })

  it('keeps a recovery queue load alive across registry snapshot updates', async () => {
    const item = createItem('queue')
    const entry = createReadyEntry()
    const pendingState = deferred(createState([item]))
    const api = createApi({
      getState: vi
        .fn()
        .mockResolvedValueOnce(pendingState.promise)
        .mockResolvedValue(createState([])),
      prepareNextTurn: vi.fn(async () => preparedTurn(item))
    })
    const root = createRoot(document.createElement('div'))

    try {
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
      })

      pendingState.resolve()
      await act(async () => {
        await flushPromises()
        await flushPromises()
      })

      expect(api.getState).toHaveBeenCalledTimes(2)
      expect(entry.controller.sendMessage).toHaveBeenCalledOnce()
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
      .mocked(entry.controller.sendMessage)
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

  it('does not race an explicit first-class Steer while the turn is running', async () => {
    const item = createItem('steer')
    const entry = createEntry()
    const api = createApi({
      getState: vi.fn(async () => createState([item])),
      materializeItem: vi.fn(async () => ({
        id: item.message.id,
        parts: [{ type: 'text' as const, text: item.message.text }],
        contextReferences: [],
        trustedContext: item.message.trustedContext
      })),
      steerNext: vi.fn(async () => createSteerAck(item.id))
    })
    const root = createRoot(document.createElement('div'))

    try {
      await act(async () => {
        root.render(createElement(CoordinatorProbe, { api, entries: [entry] }))
        await flushPromises()
        await flushPromises()
      })

      expect(api.materializeItem).not.toHaveBeenCalled()
      expect(entry.controller.stageSteeringMessage).not.toHaveBeenCalled()
      expect(api.steerNext).not.toHaveBeenCalled()
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
    materializeItem: vi.fn(async () => {
      throw new Error('materializeItem was not configured')
    }),
    steerItem: vi.fn(async () => createSteerAck('item-1')),
    steerNext: vi.fn(async () => createSteerAck('item-1')),
    subscribe: vi.fn(() => () => undefined),
    ...overrides
  }
}

function createEntry(
  sendMessage: (message?: unknown, options?: unknown) => Promise<void> = vi.fn(
    async () => undefined
  )
): ConversationChatEntry {
  const controller = {
    id: 'conversation-1',
    sendMessage,
    getActiveTurnId: vi.fn(() => 'turn-active'),
    stageSteeringMessage: vi.fn(() => ({ renderId: 'steer:item-1' })),
    rejectSteeringMessage: vi.fn(),
    retargetSteeringMessage: vi.fn(),
    clearError: vi.fn()
  }
  const entry = {
    localId: 'conversation-1',
    newConversation: false,
    controller,
    transport: {},
    messages: [],
    context: {
      conversationId: 'conversation-1',
      threadId: 'conversation-1'
    },
    status: 'streaming',
    unread: false,
    draft: '',
    draftAttachments: [],
    loaded: true
  } as unknown as ConversationChatEntry
  vi.mocked(entry.controller.clearError).mockImplementation(() => {
    entry.status = 'ready'
  })
  return entry
}

function createReadyEntry(
  sendMessage: (message?: unknown, options?: unknown) => Promise<void> = vi.fn(
    async () => undefined
  )
): ConversationChatEntry {
  const entry = createEntry(sendMessage)
  entry.status = 'ready'
  return entry
}

function createSteerAck(clientUserMessageId: string): FollowUpSteerPendingAck {
  return {
    delivery: 'pending-ack',
    clientUserMessageId,
    targetTurnId: 'turn-server'
  }
}

function deferred<T>(value: T): {
  promise: Promise<T>
  resolve: () => void
} {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: () => resolvePromise(value)
  }
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
