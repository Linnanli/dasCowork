import { describe, expect, it, vi } from 'vitest'

import type {
  CodexChatStreamCallbacks,
  DesktopCodexChatApi,
  SidebarConversation,
  SidebarConversationOpenResult
} from '../../../shared/codexIpcApi'
import { ConversationDraftStore } from './ConversationDraftStore'
import { ConversationChatRegistry } from './ConversationChatRegistry'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function registryFixture(): {
  bridge: DesktopCodexChatApi
  callbacks: Map<string, CodexChatStreamCallbacks>
  registry: ConversationChatRegistry
} {
  const callbacks = new Map<string, CodexChatStreamCallbacks>()
  const bridge: DesktopCodexChatApi = {
    startChatStream: vi.fn((request, streamCallbacks) => {
      callbacks.set(request.chatId, streamCallbacks)
      return `stream-${request.chatId}`
    }),
    abortChatStream: vi.fn()
  }
  let sequence = 0
  const registry = new ConversationChatRegistry({
    chatBridge: bridge,
    selectedModelId: 'gpt-test',
    draftStore: new ConversationDraftStore(new MemoryStorage()),
    createId: () => `local-${sequence++}`
  })
  return { bridge, callbacks, registry }
}

describe('ConversationChatRegistry', () => {
  it('binds a real thread alias to the original Chat and transport', async () => {
    const { callbacks, registry } = registryFixture()
    const entry = registry.getSnapshot().activeEntry

    await entry.transport.sendMessages({
      chatId: entry.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks.get(entry.chat.id)?.onThreadBound('thread-real')

    expect(registry.resolve('thread-real')).toBe(entry)
    expect(registry.getSnapshot().entries).toHaveLength(1)
    expect(entry.chat.id).toBe('local-0')
  })

  it('reuses an alias without loading history or creating a second entry', async () => {
    const { registry } = registryFixture()
    const entry = registry.getSnapshot().activeEntry
    registry.bindThread(entry, 'thread-real')
    const load = vi.fn()

    await expect(registry.openConversation('thread-real', load)).resolves.toBe(entry)
    expect(load).not.toHaveBeenCalled()
    expect(registry.getSnapshot().entries).toHaveLength(1)
  })

  it('keeps the last navigation active when history loads out of order', async () => {
    const { registry } = registryFixture()
    const loads = {
      a: deferred<SidebarConversationOpenResult>(),
      b: deferred<SidebarConversationOpenResult>(),
      c: deferred<SidebarConversationOpenResult>()
    }

    const openA = registry.openConversation('a', () => loads.a.promise)
    const openB = registry.openConversation('b', () => loads.b.promise)
    const openC = registry.openConversation('c', () => loads.c.promise)
    loads.b.resolve(openResult('b'))
    loads.c.resolve(openResult('c'))
    loads.a.resolve(openResult('a'))
    await Promise.all([openA, openB, openC])

    expect(registry.getSnapshot().activeEntry.context.conversationId).toBe('c')
    expect(registry.resolve('thread-a')?.chat.messages[0]?.id).toBe('message-a')
    expect(registry.resolve('thread-b')?.chat.messages[0]?.id).toBe('message-b')
  })

  it('seeds a loading conversation with metadata already known by the sidebar', async () => {
    const { registry } = registryFixture()
    const pending = deferred<SidebarConversationOpenResult>()
    const conversation: SidebarConversation = {
      id: 'sidebar-id',
      threadId: 'thread-sidebar-id',
      title: 'Known conversation',
      projectAssignment: { projectKind: 'local', projectId: 'project-1', cwd: '/repo' },
      cwd: '/repo'
    }
    registry.applyConversationMetadata([conversation])

    const open = registry.openConversation('sidebar-id', () => pending.promise)
    const loadingEntry = registry.getSnapshot().activeEntry

    expect(loadingEntry).toMatchObject({ loaded: false, phase: 'loading' })
    expect(loadingEntry.context).toMatchObject({
      conversationId: 'sidebar-id',
      title: 'Known conversation',
      projectSelection: { projectKind: 'local', projectId: 'project-1' },
      cwd: '/repo'
    })

    pending.resolve(openResult('sidebar-id'))
    await open
  })

  it('does not let a pending history load overwrite a live thread-bound entry', async () => {
    const { callbacks, registry } = registryFixture()
    const liveEntry = registry.getSnapshot().activeEntry
    liveEntry.chat.messages = [
      { id: 'live-message', role: 'assistant', parts: [{ type: 'text', text: 'live' }] }
    ]
    await liveEntry.transport.sendMessages({
      chatId: liveEntry.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: liveEntry.chat.messages,
      abortSignal: undefined
    })

    const pending = deferred<SidebarConversationOpenResult>()
    const open = registry.openConversation('sidebar-id', () => pending.promise)
    const placeholder = registry.getSnapshot().activeEntry
    expect(placeholder.localId).toBe('sidebar-id')

    callbacks.get(liveEntry.chat.id)?.onThreadBound('thread-sidebar-id')

    pending.resolve(openResult('sidebar-id'))
    const openedEntry = await open

    expect(openedEntry).toBe(liveEntry)
    expect(liveEntry.chat.messages[0]?.id).toBe('live-message')
    expect(registry.getSnapshot().entries).not.toContainEqual(
      expect.objectContaining({ localId: 'sidebar-id' })
    )

    registry.setDraft(placeholder, 'late draft')
    registry.setSelectedModel(placeholder, 'late model')
    registry.setScroll(placeholder, { scrollTop: 64, followBottom: false })

    expect(liveEntry.draft).toBe('late draft')
    expect(liveEntry.selectedModelId).toBe('late model')
    expect(liveEntry.scroll).toEqual({ scrollTop: 64, followBottom: false })
  })

  it('merges a loaded sidebar placeholder into the live entry when thread binding arrives late', async () => {
    const { callbacks, registry } = registryFixture()
    const liveEntry = registry.getSnapshot().activeEntry
    liveEntry.chat.messages = [
      { id: 'live-message', role: 'user', parts: [{ type: 'text', text: 'live' }] }
    ]
    await liveEntry.transport.sendMessages({
      chatId: liveEntry.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: liveEntry.chat.messages,
      abortSignal: undefined
    })

    const placeholder = await registry.openConversation('sidebar-id', async () => ({
      ...openResult('sidebar-id'),
      title: 'Sidebar title',
      cwd: '/repo',
      projectAssignment: { projectKind: 'local', projectId: 'project-1', cwd: '/repo' }
    }))
    expect(placeholder).not.toBe(liveEntry)

    callbacks.get(liveEntry.chat.id)?.onThreadBound('thread-sidebar-id')

    expect(registry.resolve('thread-sidebar-id')).toBe(liveEntry)
    expect(registry.resolve('sidebar-id')).toBe(liveEntry)
    expect(registry.getSnapshot().activeEntry).toBe(liveEntry)
    expect(registry.getSnapshot().entries).toEqual([liveEntry])
    expect(liveEntry.chat.messages[0]?.id).toBe('live-message')
    expect(liveEntry.context).toMatchObject({
      conversationId: 'sidebar-id',
      threadId: 'thread-sidebar-id',
      title: 'Sidebar title',
      projectSelection: { projectKind: 'local', projectId: 'project-1' },
      cwd: '/repo'
    })

    registry.setDraft(placeholder, 'canonical draft')
    registry.setSelectedModel(placeholder, 'model-after-merge')
    registry.setScroll(placeholder, { scrollTop: 120, followBottom: false })

    expect(liveEntry.draft).toBe('canonical draft')
    expect(liveEntry.selectedModelId).toBe('model-after-merge')
    expect(liveEntry.scroll).toEqual({ scrollTop: 120, followBottom: false })
  })

  it('retries a failed history load instead of turning the selected thread into a new chat', async () => {
    const { registry } = registryFixture()

    const failedOpenResult = await registry.openConversation('retry-me', async () => {
      throw new Error('temporary load failure')
    })
    const failedEntry = registry.resolve('retry-me')
    expect(failedOpenResult).toBe(failedEntry)
    expect(failedEntry).toMatchObject({ loaded: false, phase: 'error' })

    const retriedEntry = await registry.openConversation('retry-me', async () =>
      openResult('retry-me')
    )

    expect(retriedEntry).toBe(failedEntry)
    expect(retriedEntry).toMatchObject({ loaded: true, phase: 'ready' })
    expect(retriedEntry.context.threadId).toBe('thread-retry-me')
  })

  it('applies sidebar metadata to a live bound entry without replacing its Chat', () => {
    const { registry } = registryFixture()
    const entry = registry.getSnapshot().activeEntry
    registry.bindThread(entry, 'thread-live')

    registry.applyConversationMetadata([
      {
        id: 'thread-live',
        threadId: 'thread-live',
        title: 'Live title',
        cwd: '/repo',
        projectAssignment: { projectKind: 'local', projectId: 'project-1', cwd: '/repo' }
      }
    ])

    expect(registry.resolve('thread-live')).toBe(entry)
    expect(registry.getSnapshot().entries).toEqual([entry])
    expect(entry.context).toMatchObject({
      title: 'Live title',
      cwd: '/repo',
      projectSelection: { projectKind: 'local', projectId: 'project-1' }
    })
  })

  it('binds a thread created after abort back to its origin entry', async () => {
    const { callbacks, registry } = registryFixture()
    const originEntry = registry.getSnapshot().activeEntry
    await originEntry.transport.sendMessages({
      chatId: originEntry.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks.get(originEntry.chat.id)?.onAbort()
    expect(originEntry.phase).toBe('ready')

    registry.applyConversationMetadata([
      {
        id: 'thread-after-abort',
        threadId: 'thread-after-abort',
        originConversationId: originEntry.localId,
        title: 'Created after abort'
      }
    ])

    expect(registry.resolve('thread-after-abort')).toBe(originEntry)
    expect(registry.getSnapshot().entries).toEqual([originEntry])
    expect(originEntry.context).toMatchObject({
      conversationId: 'thread-after-abort',
      threadId: 'thread-after-abort',
      title: 'Created after abort'
    })
    const load = vi.fn()
    await expect(registry.openConversation('thread-after-abort', load)).resolves.toBe(originEntry)
    expect(load).not.toHaveBeenCalled()
  })

  it('tracks submitted, background unread, and entry-scoped errors independently', async () => {
    const { callbacks, registry } = registryFixture()
    const entryA = registry.getSnapshot().activeEntry
    await entryA.transport.sendMessages({
      chatId: entryA.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    expect(entryA.phase).toBe('submitted')

    const entryB = registry.startNewConversation()
    callbacks.get(entryA.chat.id)?.onChunk({ type: 'text-start', id: 'text-a' })
    expect(entryA.phase).toBe('streaming')
    expect(entryA.unread).toBe(true)
    expect(entryB.unread).toBe(false)

    callbacks.get(entryA.chat.id)?.onError('A failed')
    expect(entryA.phase).toBe('error')
    expect(entryA.error?.message).toBe('A failed')
    expect(entryB.phase).toBe('ready')

    await registry.openConversation(entryA.localId, async () => openResult('unused'))
    expect(entryA.unread).toBe(false)
  })

  it('migrates and clears a draft only after the stream is accepted', async () => {
    const { callbacks, registry } = registryFixture()
    const entry = registry.getSnapshot().activeEntry
    registry.setDraft(entry, 'keep me')
    await entry.transport.sendMessages({
      chatId: entry.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })

    expect(entry.draft).toBe('keep me')
    callbacks.get(entry.chat.id)?.onThreadBound('thread-real')
    expect(entry.draft).toBe('')
  })

  it('keeps model selection scoped to each entry and snapshots it per send', async () => {
    const { bridge, registry } = registryFixture()
    const entryA = registry.getSnapshot().activeEntry
    registry.setSelectedModel(entryA, 'model-a')
    const entryB = registry.startNewConversation()
    registry.setSelectedModel(entryB, 'model-b')

    await entryA.transport.sendMessages({
      chatId: entryA.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    await entryB.transport.sendMessages({
      chatId: entryB.chat.id,
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })

    const requests = vi.mocked(bridge.startChatStream).mock.calls.map(([request]) => request)
    expect(requests.find((request) => request.chatId === entryA.chat.id)?.modelId).toBe('model-a')
    expect(requests.find((request) => request.chatId === entryB.chat.id)?.modelId).toBe('model-b')
  })

  it('stops each running Chat when the registry is destroyed', async () => {
    const { bridge, registry } = registryFixture()
    const entryA = registry.getSnapshot().activeEntry
    void entryA.chat.sendMessage({ text: 'A' })
    const entryB = registry.startNewConversation()
    void entryB.chat.sendMessage({ text: 'B' })
    await flushMicrotasks()

    registry.destroy()
    await flushMicrotasks()

    expect(bridge.abortChatStream).toHaveBeenCalledWith(`stream-${entryA.chat.id}`)
    expect(bridge.abortChatStream).toHaveBeenCalledWith(`stream-${entryB.chat.id}`)
  })
})

function openResult(conversationId: string): SidebarConversationOpenResult {
  return {
    conversationId,
    threadId: `thread-${conversationId}`,
    title: conversationId,
    messages: [
      {
        id: `message-${conversationId}`,
        role: 'user',
        parts: [{ type: 'text', text: conversationId }]
      }
    ]
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
