// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ConversationChatEntry,
  ConversationChatRegistrySnapshot
} from '../runtime/ConversationChatRegistry'
import { ConversationRuntimeIndicatorStore } from '../runtime/ConversationRuntimeIndicatorStore'
import { ConversationRuntimeIndicatorProvider } from './ConversationRuntimeIndicatorProvider'
import type { SidebarConversationView } from './sidebarTypes'
import { useConversationRuntimeIndicator } from './useConversationRuntimeIndicator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ConversationRuntimeIndicatorProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not re-render unchanged rows for streamed text updates', async () => {
    const activeEntry = entry('active', 'streaming')
    const backgroundEntry = entry('background', 'ready')
    const registry = new FakeConversationRegistry(activeEntry, backgroundEntry)
    const store = new ConversationRuntimeIndicatorStore(registry)
    const renderCounts = new Map<string, number>()

    await act(async () => {
      root.render(
        <ConversationRuntimeIndicatorProvider store={store}>
          <IndicatorProbe
            conversation={{ id: 'active', threadId: 'active', title: 'Active' }}
            renderCounts={renderCounts}
          />
          <IndicatorProbe
            conversation={{ id: 'background', threadId: 'background', title: 'Background' }}
            renderCounts={renderCounts}
          />
        </ConversationRuntimeIndicatorProvider>
      )
    })

    expect(renderCounts).toEqual(
      new Map([
        ['active', 1],
        ['background', 1]
      ])
    )

    await act(async () => registry.emit())

    expect(renderCounts).toEqual(
      new Map([
        ['active', 1],
        ['background', 1]
      ])
    )

    backgroundEntry.unread = true
    await act(async () => registry.emit())

    expect(renderCounts).toEqual(
      new Map([
        ['active', 1],
        ['background', 2]
      ])
    )
    store.destroy()
  })
})

function IndicatorProbe({
  conversation,
  renderCounts
}: {
  conversation: SidebarConversationView
  renderCounts: Map<string, number>
}): React.JSX.Element {
  renderCounts.set(conversation.id, (renderCounts.get(conversation.id) ?? 0) + 1)
  const indicator = useConversationRuntimeIndicator(conversation)
  return <output data-conversation-id={conversation.id}>{JSON.stringify(indicator)}</output>
}

class FakeConversationRegistry {
  private readonly listeners = new Set<() => void>()
  private version = 0
  private readonly entries = new Map<string, ConversationChatEntry>()

  constructor(
    private readonly activeEntry: ConversationChatEntry,
    ...entries: ConversationChatEntry[]
  ) {
    this.entries.set(activeEntry.localId, activeEntry)
    for (const item of entries) this.entries.set(item.localId, item)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ConversationChatRegistrySnapshot => ({
    activeEntry: this.activeEntry,
    entries: [...this.entries.values()],
    version: this.version
  })

  resolve = (identity: string | undefined): ConversationChatEntry | undefined =>
    identity ? this.entries.get(identity) : undefined

  emit(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

function entry(localId: string, status: ConversationChatEntry['status']): ConversationChatEntry {
  return { localId, status, unread: false } as ConversationChatEntry
}
