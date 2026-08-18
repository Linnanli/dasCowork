import type { SidebarConversation } from '../../../shared/codexIpcApi'
import type { ConversationChatEntry, ConversationChatRegistry } from './ConversationChatRegistry'

export type ConversationRuntimeIndicator = {
  active: boolean
  attention: boolean
  running: boolean
  unread: boolean
}

type ConversationRuntimeIndicatorRegistry = Pick<
  ConversationChatRegistry,
  'getSnapshot' | 'resolve' | 'subscribe'
>

type CachedIndicator = {
  signature: string
  value: ConversationRuntimeIndicator
}

/**
 * Provides sidebar rows with stable, conversation-specific runtime state.
 *
 * The chat registry emits for every streamed text fragment. Returning the
 * exact same snapshot for rows whose visible state is unchanged lets
 * useSyncExternalStore skip their React re-render.
 */
export class ConversationRuntimeIndicatorStore {
  private readonly listeners = new Set<() => void>()
  private readonly snapshots = new Map<string, CachedIndicator>()
  private readonly unsubscribeRegistry: () => void
  private attentionThreadIds = new Set<string>()

  constructor(private readonly registry: ConversationRuntimeIndicatorRegistry) {
    this.unsubscribeRegistry = registry.subscribe(this.emit)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (conversation: SidebarConversation): ConversationRuntimeIndicator => {
    const registrySnapshot = this.registry.getSnapshot()
    const entry = this.resolveEntry(conversation)
    const active = entry === registrySnapshot.activeEntry
    const attention = Boolean(
      (conversation.threadId && this.attentionThreadIds.has(conversation.threadId)) ||
      this.attentionThreadIds.has(conversation.id)
    )
    const running = entry
      ? entry.status === 'submitted' || entry.status === 'streaming'
      : Boolean(conversation.running)
    const unread = entry ? entry.unread : Boolean(conversation.unread)
    const signature = indicatorSignature(active, attention, running, unread)
    const cached = this.snapshots.get(conversation.id)
    if (cached?.signature === signature) return cached.value

    const value = { active, attention, running, unread }
    this.snapshots.set(conversation.id, { signature, value })
    return value
  }

  setAttentionThreadIds(threadIds: ReadonlySet<string>): void {
    if (sameStringSet(this.attentionThreadIds, threadIds)) return
    this.attentionThreadIds = new Set(threadIds)
    this.emit()
  }

  destroy(): void {
    this.unsubscribeRegistry()
    this.listeners.clear()
    this.snapshots.clear()
  }

  private resolveEntry(conversation: SidebarConversation): ConversationChatEntry | undefined {
    return this.registry.resolve(conversation.threadId) ?? this.registry.resolve(conversation.id)
  }

  private emit = (): void => {
    for (const listener of this.listeners) listener()
  }
}

function indicatorSignature(
  active: boolean,
  attention: boolean,
  running: boolean,
  unread: boolean
): string {
  return `${Number(active)}${Number(attention)}${Number(running)}${Number(unread)}`
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  return [...left].every((value) => right.has(value))
}
