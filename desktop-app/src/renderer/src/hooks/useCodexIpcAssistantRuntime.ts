import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'

import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexModelList,
  SidebarConversation,
  SidebarConversationActionPayload
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'
import type { ModelOption } from '../components/assistant-ui'
import {
  ConversationChatRegistry,
  type ConversationChatEntry,
  type ConversationScrollSnapshot
} from '../runtime/ConversationChatRegistry'
import type { ActiveConversationContext } from '../lib/ElectronIpcChatTransport'

export type ConversationRuntimeIndicator = {
  active: boolean
  attention: boolean
  running: boolean
  unread: boolean
}

export type CodexIpcAssistantRuntimeState = {
  activeEntry: ConversationChatEntry
  activeConversation: ActiveConversationContext | undefined
  activeServerRequests: readonly CodexApprovalRequest[]
  serverRequests: readonly CodexApprovalRequest[]
  models: readonly ModelOption[]
  selectedModelId: string | undefined
  modelSelectionError: string | undefined
  startNewConversation: () => void
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
  setSelectedModelId: (modelId: string) => Promise<void>
  setActiveDraft: (draft: string) => void
  setActiveScroll: (scroll: ConversationScrollSnapshot) => void
  syncConversationMetadata: (conversations: readonly SidebarConversation[]) => void
  getConversationIndicator: (conversation: SidebarConversation) => ConversationRuntimeIndicator
  getConversationTitle: (threadId: string | undefined) => string | undefined
  respondToServerRequest: (
    request: CodexApprovalRequest,
    response: CodexApprovalResponse
  ) => Promise<void>
  rejectServerRequest: (request: CodexApprovalRequest) => Promise<void>
}

export type CodexIpcAssistantRuntimeOptions = {
  projectSelection?: ProjectSelection
}

export function useCodexIpcAssistantRuntime(
  options: CodexIpcAssistantRuntimeOptions = {}
): CodexIpcAssistantRuntimeState {
  const [serverRequests, setServerRequests] = useState<CodexApprovalRequest[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelIdState] = useState<string | undefined>()

  const [registry] = useState(
    () =>
      new ConversationChatRegistry({
        chatBridge: window.desktopApp.chat,
        selectedModelId
      })
  )
  const registrySnapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot
  )
  const activeEntry = registrySnapshot.activeEntry
  const activeConversation =
    activeEntry.newConversation && !activeEntry.context.threadId ? undefined : activeEntry.context

  useLayoutEffect(() => {
    registry.updateActiveProjectSelection(options.projectSelection)
  }, [options.projectSelection, registry])

  useEffect(() => {
    let cancelled = false
    void window.desktopApp.codex.listModels().then((list) => {
      if (cancelled) return
      setModels(toModelOptions(list))
      setSelectedModelIdState(list.selectedModelId)
      registry.applyDefaultModel(list.selectedModelId)
    })
    const removeApproval = window.desktopApp.codex.onApprovalRequest((request) => {
      registry.markUnreadByThread(request.context?.threadId)
      setServerRequests((current) => {
        if (current.some((item) => item.id === request.id)) return current
        return [...current, request]
      })
    })

    return () => {
      cancelled = true
      removeApproval()
    }
  }, [registry])

  useEffect(() => {
    const destroyRegistry = (): void => registry.destroy()
    window.addEventListener('beforeunload', destroyRegistry)
    return () => window.removeEventListener('beforeunload', destroyRegistry)
  }, [registry])

  const openConversation = useCallback(
    async (input: SidebarConversationActionPayload) => {
      await registry.openConversation(input.conversationId, () =>
        window.desktopApp.conversations.openConversation(input)
      )
    },
    [registry]
  )

  const startNewConversation = useCallback(() => {
    registry.startNewConversation(options.projectSelection)
  }, [options.projectSelection, registry])

  const setSelectedModelId = useCallback(
    async (modelId: string) => {
      const targetEntry = activeEntry
      try {
        const response = await window.desktopApp.codex.setSelectedModel(modelId)
        setSelectedModelIdState(response.selectedModelId)
        registry.applyDefaultModel(response.selectedModelId)
        registry.setSelectedModel(targetEntry, response.selectedModelId)
      } catch (error) {
        registry.setModelSelectionError(targetEntry, errorMessage(error))
        throw error
      }
    },
    [activeEntry, registry]
  )

  const setActiveDraft = useCallback(
    (draft: string) => registry.setDraft(activeEntry, draft),
    [activeEntry, registry]
  )

  const setActiveScroll = useCallback(
    (scroll: ConversationScrollSnapshot) => registry.setScroll(activeEntry, scroll),
    [activeEntry, registry]
  )

  const syncConversationMetadata = useCallback(
    (conversations: readonly SidebarConversation[]) =>
      registry.applyConversationMetadata(conversations),
    [registry]
  )

  const getConversationIndicator = useCallback(
    (conversation: SidebarConversation): ConversationRuntimeIndicator => {
      void registrySnapshot.version
      const entry = registry.resolve(conversation.threadId) ?? registry.resolve(conversation.id)
      const requestThreadIds = new Set(
        serverRequests.flatMap((request) =>
          request.context?.threadId ? [request.context.threadId] : []
        )
      )
      const attention = Boolean(
        (conversation.threadId && requestThreadIds.has(conversation.threadId)) ||
        requestThreadIds.has(conversation.id)
      )
      return {
        active: entry === activeEntry,
        attention,
        running: entry
          ? entry.phase === 'submitted' || entry.phase === 'streaming'
          : Boolean(conversation.running),
        unread: entry ? entry.unread : Boolean(conversation.unread)
      }
    },
    [activeEntry, registry, registrySnapshot, serverRequests]
  )

  const getConversationTitle = useCallback(
    (threadId: string | undefined): string | undefined => {
      void registrySnapshot.version
      if (!threadId) return undefined
      return registry.resolve(threadId)?.context.title ?? undefined
    },
    [registry, registrySnapshot]
  )

  const respondToServerRequest = useCallback(
    async (request: CodexApprovalRequest, response: CodexApprovalResponse) => {
      await window.desktopApp.codex.respondApproval(request.id, response)
      setServerRequests((current) => current.filter((item) => item.id !== request.id))
    },
    []
  )

  const rejectServerRequest = useCallback(async (request: CodexApprovalRequest) => {
    await window.desktopApp.codex.respondApproval(request.id, {
      action: 'decline',
      reason: 'Rejected from desktop UI'
    })
    setServerRequests((current) => current.filter((item) => item.id !== request.id))
  }, [])

  const activeThreadId = activeEntry.context.threadId
  const activeServerRequests = activeThreadId
    ? serverRequests.filter((request) => request.context?.threadId === activeThreadId)
    : []

  return {
    activeEntry,
    activeConversation,
    activeServerRequests,
    serverRequests,
    models,
    selectedModelId: activeEntry.selectedModelId ?? selectedModelId,
    modelSelectionError: activeEntry.modelSelectionError,
    startNewConversation,
    openConversation,
    setSelectedModelId,
    setActiveDraft,
    setActiveScroll,
    syncConversationMetadata,
    getConversationIndicator,
    getConversationTitle,
    respondToServerRequest,
    rejectServerRequest
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toModelOptions(list: CodexModelList): ModelOption[] {
  if (list.unavailableReason) {
    return [{ id: '__unavailable__', name: list.unavailableReason, disabled: true }]
  }
  return list.models.map((model) => ({
    id: model.id,
    name: model.displayName,
    description: model.description,
    disabled: false
  }))
}
