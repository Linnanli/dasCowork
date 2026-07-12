import { Chat } from '@ai-sdk/react'
import type { ChatStatus, UIMessage } from 'ai'

import type {
  DesktopCodexChatApi,
  SidebarConversation,
  SidebarConversationOpenResult
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'
import {
  ElectronIpcChatTransport,
  type ActiveConversationContext
} from '../lib/ElectronIpcChatTransport'
import { ConversationDraftStore } from './ConversationDraftStore'

export type ConversationScrollSnapshot = {
  scrollTop: number
  followBottom: boolean
}

export type ConversationEntryPhase = 'loading' | ChatStatus

export type ConversationChatEntry = {
  readonly localId: string
  readonly newConversation: boolean
  readonly chat: Chat<UIMessage>
  readonly transport: ElectronIpcChatTransport
  context: ActiveConversationContext
  phase: ConversationEntryPhase
  error?: Error
  selectedModelId?: string
  modelSelectionError?: string
  unread: boolean
  draft: string
  scroll?: ConversationScrollSnapshot
  loaded: boolean
}

export type ConversationChatRegistrySnapshot = {
  activeEntry: ConversationChatEntry
  entries: readonly ConversationChatEntry[]
  version: number
}

export type ConversationChatRegistryOptions = {
  chatBridge: DesktopCodexChatApi
  selectedModelId?: string
  draftStore?: ConversationDraftStore
  createId?: () => string
}

type InternalConversationChatEntry = ConversationChatEntry & {
  acceptedCurrentSend: boolean
}

export class ConversationChatRegistry {
  private readonly chatBridge: DesktopCodexChatApi
  private readonly draftStore: ConversationDraftStore
  private readonly createId: () => string
  private readonly entriesByLocalId = new Map<string, InternalConversationChatEntry>()
  private readonly aliases = new Map<string, InternalConversationChatEntry>()
  private readonly conversationMetadata = new Map<string, SidebarConversation>()
  private readonly listeners = new Set<() => void>()
  private activeEntry: InternalConversationChatEntry
  private navigationEpoch = 0
  private version = 0
  private snapshot: ConversationChatRegistrySnapshot
  private destroyed = false
  private defaultSelectedModelId: string | undefined

  constructor(options: ConversationChatRegistryOptions) {
    this.chatBridge = options.chatBridge
    this.defaultSelectedModelId = options.selectedModelId
    this.draftStore = options.draftStore ?? new ConversationDraftStore()
    this.createId = options.createId ?? createLocalConversationId
    this.activeEntry = this.createEntry({
      localId: this.createId(),
      projectSelection: undefined,
      loaded: true,
      newConversation: true
    })
    this.snapshot = this.buildSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ConversationChatRegistrySnapshot => this.snapshot

  startNewConversation(projectSelection?: ProjectSelection): ConversationChatEntry {
    this.assertUsable()
    this.navigationEpoch += 1
    const entry = this.createEntry({
      localId: this.createId(),
      projectSelection,
      loaded: true,
      newConversation: true
    })
    this.activate(entry)
    return entry
  }

  async openConversation(
    conversationId: string,
    load: () => Promise<SidebarConversationOpenResult>
  ): Promise<ConversationChatEntry> {
    this.assertUsable()
    const navigationEpoch = ++this.navigationEpoch
    const knownEntry = this.resolveInternal(conversationId)
    if (knownEntry?.loaded || knownEntry?.phase === 'loading') {
      this.activate(knownEntry)
      return knownEntry
    }

    const metadata = this.conversationMetadata.get(conversationId)
    const metadataProjectSelection = projectSelectionFromAssignment(metadata?.projectAssignment)
    const entry =
      knownEntry ??
      this.createEntry({
        localId: conversationId,
        projectSelection: metadataProjectSelection,
        loaded: false,
        phase: 'loading',
        newConversation: false
      })
    if (metadata) {
      entry.context = {
        ...entry.context,
        conversationId: metadata.id,
        title: metadata.title,
        projectSelection: metadataProjectSelection ?? entry.context.projectSelection,
        cwd: metadata.cwd ?? entry.context.cwd
      }
    }
    entry.phase = 'loading'
    entry.error = undefined
    this.activate(entry)

    try {
      const result = await load()
      if (this.destroyed) return entry

      const canonicalEntry =
        this.resolveInternal(result.threadId) ?? this.resolveInternal(result.conversationId)
      if (canonicalEntry && canonicalEntry !== entry) {
        this.removeEntry(entry, canonicalEntry)
        if (this.navigationEpoch === navigationEpoch) this.activate(canonicalEntry)
        else this.emit()
        return canonicalEntry
      }

      this.bindAlias(entry, result.conversationId)
      const boundEntry = this.bindThread(entry, result.threadId) as InternalConversationChatEntry
      if (boundEntry !== entry) {
        this.removeEntry(entry, boundEntry)
        if (this.navigationEpoch === navigationEpoch) this.activate(boundEntry)
        else this.emit()
        return boundEntry
      }

      entry.context = {
        conversationId: result.conversationId,
        threadId: result.threadId,
        title: result.title,
        projectSelection: projectSelectionFromOpenResult(result),
        cwd: result.cwd
      }
      entry.chat.messages = result.messages
      entry.chat.clearError()
      entry.phase = 'ready'
      entry.error = undefined
      entry.loaded = true
      if (this.navigationEpoch === navigationEpoch) this.activate(entry)
      else this.emit()
      return entry
    } catch (error) {
      entry.phase = 'error'
      entry.error = toError(error)
      if (entry !== this.activeEntry) entry.unread = true
      this.emit()
      return entry
    }
  }

  bindThread(
    entryOrIdentity: ConversationChatEntry | string,
    threadId: string
  ): ConversationChatEntry {
    const entry = this.internalEntry(entryOrIdentity)
    if (entry.context.threadId && entry.context.threadId !== threadId) {
      entry.phase = 'error'
      entry.error = new Error(
        `Conversation ${entry.localId} is already bound to thread ${entry.context.threadId}`
      )
      this.emit()
      return entry
    }

    const existingEntry = this.resolveInternal(threadId)
    if (existingEntry && existingEntry !== entry) {
      if (isRunningPhase(entry.phase) && !isRunningPhase(existingEntry.phase)) {
        return this.mergePlaceholderIntoLiveEntry(entry, existingEntry, threadId)
      }
      return existingEntry
    }

    const previousDraftIdentity = entry.context.threadId ?? entry.localId
    this.bindAlias(entry, threadId)
    entry.context = { ...entry.context, threadId }
    entry.draft = this.draftStore.migrate(previousDraftIdentity, threadId)
    entry.loaded = true
    this.emit()
    return entry
  }

  applyConversationMetadata(conversations: readonly SidebarConversation[]): void {
    this.conversationMetadata.clear()
    let changed = false
    for (const conversation of conversations) {
      this.conversationMetadata.set(conversation.id, conversation)
      const threadIdentity = conversation.threadId ?? conversation.id
      const originEntry = this.resolveInternal(conversation.originConversationId)
      const existingThreadEntry = this.resolveInternal(threadIdentity)
      let entry = originEntry ?? existingThreadEntry
      if (!entry) continue
      if (originEntry && existingThreadEntry && originEntry !== existingThreadEntry) {
        entry = this.mergePlaceholderIntoLiveEntry(originEntry, existingThreadEntry, threadIdentity)
      } else if (originEntry && originEntry.context.threadId !== threadIdentity) {
        entry = this.bindThread(originEntry, threadIdentity) as InternalConversationChatEntry
      }
      const projectSelection = projectSelectionFromAssignment(conversation.projectAssignment)
      const context: ActiveConversationContext = {
        ...entry.context,
        conversationId: conversation.id,
        threadId: conversation.threadId ?? entry.context.threadId,
        title: conversation.title,
        projectSelection: projectSelection ?? entry.context.projectSelection,
        cwd: conversation.cwd ?? entry.context.cwd
      }
      if (sameConversationContext(entry.context, context)) continue
      entry.context = context
      changed = true
    }
    if (changed) this.emit()
  }

  resolve(identity: string | undefined): ConversationChatEntry | undefined {
    return this.resolveInternal(identity)
  }

  updateActiveProjectSelection(projectSelection: ProjectSelection | undefined): void {
    const entry = this.activeEntry
    if (entry.context.threadId || entry.chat.messages.length > 0 || entry.phase !== 'ready') return
    if (sameProjectSelection(entry.context.projectSelection, projectSelection)) return
    entry.context = { ...entry.context, projectSelection }
    this.emit()
  }

  setDraft(entryOrIdentity: ConversationChatEntry | string, draft: string): void {
    const entry = this.internalEntry(entryOrIdentity)
    if (entry.draft === draft) return
    entry.draft = draft
    this.draftStore.set(entry.context.threadId ?? entry.localId, draft)
    this.emit()
  }

  applyDefaultModel(modelId: string | undefined): void {
    this.defaultSelectedModelId = modelId
    let changed = false
    for (const entry of this.entriesByLocalId.values()) {
      if (entry.selectedModelId) continue
      entry.selectedModelId = modelId
      changed = true
    }
    if (changed) this.emit()
  }

  setSelectedModel(entryOrIdentity: ConversationChatEntry | string, modelId: string): void {
    const entry = this.internalEntry(entryOrIdentity)
    entry.selectedModelId = modelId
    entry.modelSelectionError = undefined
    this.emit()
  }

  setModelSelectionError(entryOrIdentity: ConversationChatEntry | string, error: string): void {
    const entry = this.internalEntry(entryOrIdentity)
    entry.modelSelectionError = error
    this.emit()
  }

  setScroll(
    entryOrIdentity: ConversationChatEntry | string,
    scroll: ConversationScrollSnapshot
  ): void {
    const entry = this.internalEntry(entryOrIdentity)
    entry.scroll = scroll
  }

  markRead(entryOrIdentity: ConversationChatEntry | string): void {
    const entry = this.internalEntry(entryOrIdentity)
    if (!entry.unread) return
    entry.unread = false
    this.emit()
  }

  markUnreadByThread(threadId: string | undefined): void {
    const entry = this.resolve(threadId) as InternalConversationChatEntry | undefined
    if (!entry || entry === this.activeEntry || entry.unread) return
    entry.unread = true
    this.emit()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const entry of this.entriesByLocalId.values()) {
      if (entry.phase === 'submitted' || entry.phase === 'streaming') void entry.chat.stop()
    }
    this.entriesByLocalId.clear()
    this.aliases.clear()
    this.conversationMetadata.clear()
    this.listeners.clear()
  }

  private createEntry(input: {
    localId: string
    projectSelection: ProjectSelection | undefined
    loaded: boolean
    phase?: ConversationEntryPhase
    newConversation: boolean
  }): InternalConversationChatEntry {
    const existing = this.entriesByLocalId.get(input.localId)
    if (existing) return existing

    const entry = {} as InternalConversationChatEntry
    const transport = new ElectronIpcChatTransport({
      chatBridge: this.chatBridge,
      getActiveConversation: () => entry.context,
      getProjectSelection: () => entry.context.projectSelection,
      getSelectedModelId: () => entry.selectedModelId ?? this.defaultSelectedModelId,
      onStreamStarted: () => {
        entry.acceptedCurrentSend = false
        this.clearDraft(entry)
        entry.phase = 'submitted'
        entry.error = undefined
        this.emit()
      },
      onThreadBound: ({ threadId }) => {
        const boundEntry = this.bindThread(entry, threadId)
        if (boundEntry !== entry) {
          entry.phase = 'error'
          entry.error = new Error(`Thread ${threadId} is already owned by another conversation`)
          this.emit()
        }
      },
      onStreamAccepted: () => this.markStreamAccepted(entry),
      onStreamFinished: ({ threadId }) => {
        if (threadId) this.bindThread(entry, threadId)
        this.markStreamAccepted(entry)
        entry.phase = 'ready'
        if (entry !== this.activeEntry) entry.unread = true
        this.emit()
      },
      onStreamAborted: () => {
        this.markStreamAccepted(entry)
        entry.phase = 'ready'
        if (entry !== this.activeEntry) entry.unread = true
        this.emit()
      },
      onStreamError: (message) => {
        entry.phase = 'error'
        entry.error = new Error(message)
        if (entry !== this.activeEntry) entry.unread = true
        this.emit()
      }
    })
    const context: ActiveConversationContext = {
      conversationId: input.localId,
      projectSelection: input.projectSelection
    }
    const stableDraftIdentity = context.threadId ?? input.localId
    const chat = new Chat<UIMessage>({ id: input.localId, transport })
    Object.assign(entry, {
      localId: input.localId,
      newConversation: input.newConversation,
      chat,
      transport,
      context,
      phase: input.phase ?? 'ready',
      selectedModelId: this.defaultSelectedModelId,
      unread: false,
      draft: this.draftStore.get(stableDraftIdentity),
      loaded: input.loaded,
      acceptedCurrentSend: false
    } satisfies InternalConversationChatEntry)
    this.entriesByLocalId.set(entry.localId, entry)
    this.aliases.set(entry.localId, entry)
    return entry
  }

  private markStreamAccepted(entry: InternalConversationChatEntry): void {
    if (!entry.acceptedCurrentSend) {
      entry.acceptedCurrentSend = true
      this.clearDraft(entry)
    }
    entry.phase = 'streaming'
    if (entry !== this.activeEntry) entry.unread = true
    this.emit()
  }

  private clearDraft(entry: InternalConversationChatEntry): void {
    if (!entry.draft) return
    entry.draft = ''
    this.draftStore.set(entry.context.threadId ?? entry.localId, '')
  }

  private activate(entry: InternalConversationChatEntry): void {
    this.activeEntry = entry
    entry.unread = false
    this.emit()
  }

  private bindAlias(entry: InternalConversationChatEntry, identity: string): void {
    const existing = this.aliases.get(identity)
    if (existing && existing !== entry) return
    this.aliases.set(identity, entry)
  }

  private mergePlaceholderIntoLiveEntry(
    liveEntry: InternalConversationChatEntry,
    placeholder: InternalConversationChatEntry,
    threadId: string
  ): InternalConversationChatEntry {
    const previousDraftIdentity = liveEntry.context.threadId ?? liveEntry.localId
    const placeholderWasActive = this.activeEntry === placeholder

    for (const [identity, entry] of this.aliases.entries()) {
      if (entry === placeholder) this.aliases.set(identity, liveEntry)
    }
    this.entriesByLocalId.delete(placeholder.localId)
    this.aliases.set(threadId, liveEntry)

    liveEntry.context = {
      ...liveEntry.context,
      conversationId: placeholder.context.conversationId,
      threadId,
      title: placeholder.context.title ?? liveEntry.context.title,
      projectSelection: placeholder.context.projectSelection ?? liveEntry.context.projectSelection,
      cwd: placeholder.context.cwd ?? liveEntry.context.cwd
    }
    liveEntry.draft = this.draftStore.migrate(previousDraftIdentity, threadId)
    liveEntry.scroll ??= placeholder.scroll
    liveEntry.loaded = true
    liveEntry.unread ||= placeholder.unread

    if (placeholderWasActive) {
      this.activeEntry = liveEntry
      liveEntry.unread = false
    }
    this.emit()
    return liveEntry
  }

  private removeEntry(
    entry: InternalConversationChatEntry,
    replacement?: InternalConversationChatEntry
  ): void {
    this.entriesByLocalId.delete(entry.localId)
    for (const [identity, value] of this.aliases.entries()) {
      if (value !== entry) continue
      if (replacement) this.aliases.set(identity, replacement)
      else this.aliases.delete(identity)
    }
  }

  private internalEntry(
    entryOrIdentity: ConversationChatEntry | string
  ): InternalConversationChatEntry {
    if (typeof entryOrIdentity !== 'string') {
      const entry = this.entriesByLocalId.get(entryOrIdentity.localId)
      if (entry === entryOrIdentity) return entry
      const canonicalEntry = this.aliases.get(entryOrIdentity.localId)
      if (canonicalEntry) return canonicalEntry
    } else {
      const entry = this.aliases.get(entryOrIdentity)
      if (entry) return entry
    }
    throw new Error('Conversation entry is not registered')
  }

  private resolveInternal(identity: string | undefined): InternalConversationChatEntry | undefined {
    if (!identity) return undefined
    return this.aliases.get(identity)
  }

  private assertUsable(): void {
    if (this.destroyed) throw new Error('Conversation chat registry is destroyed')
  }

  private emit(): void {
    if (this.destroyed) return
    this.version += 1
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  private buildSnapshot(): ConversationChatRegistrySnapshot {
    return {
      activeEntry: this.activeEntry,
      entries: [...this.entriesByLocalId.values()],
      version: this.version
    }
  }
}

function projectSelectionFromOpenResult(
  result: SidebarConversationOpenResult
): ProjectSelection | undefined {
  return projectSelectionFromAssignment(result.projectAssignment)
}

function projectSelectionFromAssignment(
  assignment: SidebarConversationOpenResult['projectAssignment']
): ProjectSelection | undefined {
  if (!assignment) return undefined
  if (assignment.projectKind === 'local') {
    return assignment.path
      ? { projectKind: 'path', path: assignment.path }
      : { projectKind: 'local', projectId: assignment.projectId }
  }
  if (assignment.projectKind === 'remote') {
    return {
      projectKind: 'remote',
      projectId: assignment.projectId,
      hostId: assignment.hostId
    }
  }
  return { projectKind: 'projectless' }
}

function sameConversationContext(
  left: ActiveConversationContext,
  right: ActiveConversationContext
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRunningPhase(phase: ConversationEntryPhase): boolean {
  return phase === 'submitted' || phase === 'streaming'
}

function sameProjectSelection(
  left: ProjectSelection | undefined,
  right: ProjectSelection | undefined
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function createLocalConversationId(): string {
  return `local-${crypto.randomUUID()}`
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
