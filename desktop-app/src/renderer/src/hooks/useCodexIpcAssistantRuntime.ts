import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk'

import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexModelList,
  SidebarConversationActionPayload,
  SidebarConversationOpenResult
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'
import type { ModelOption } from '../components/assistant-ui'
import {
  ElectronIpcChatTransport,
  type ActiveConversationContext,
  type StreamFinishedContext
} from '../lib/ElectronIpcChatTransport'

export type CodexIpcAssistantRuntimeState = {
  runtime: ReturnType<typeof useAISDKRuntime>
  serverRequests: readonly CodexApprovalRequest[]
  models: readonly ModelOption[]
  selectedModelId: string | undefined
  activeConversation: ActiveConversationContext | undefined
  startNewConversation: () => void
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
  setSelectedModelId: (modelId: string) => Promise<void>
  respondToServerRequest: (
    request: CodexApprovalRequest,
    response: CodexApprovalResponse
  ) => Promise<void>
  rejectServerRequest: (request: CodexApprovalRequest) => Promise<void>
}

export type CodexIpcAssistantRuntimeOptions = {
  projectSelection?: ProjectSelection
}

export type ConversationRuntimeState = {
  activeConversation: ActiveConversationContext | undefined
  revision: number
}

class TransportStateHolder {
  private activeConversation: ActiveConversationContext | undefined
  private projectSelection: ProjectSelection | undefined
  private conversationRevision = 0
  private selectedModelId: string | undefined

  set(input: {
    activeConversation: ActiveConversationContext | undefined
    projectSelection: ProjectSelection | undefined
    conversationRevision: number
    selectedModelId: string | undefined
  }): void {
    this.activeConversation = input.activeConversation
    this.projectSelection = input.projectSelection
    this.conversationRevision = input.conversationRevision
    this.selectedModelId = input.selectedModelId
  }

  getActiveConversation(): ActiveConversationContext | undefined {
    return this.activeConversation
  }

  getProjectSelection(): ProjectSelection | undefined {
    return this.projectSelection
  }

  getConversationRevision(): number {
    return this.conversationRevision
  }

  getSelectedModelId(): string | undefined {
    return this.selectedModelId
  }
}

export function useCodexIpcAssistantRuntime(
  options: CodexIpcAssistantRuntimeOptions = {}
): CodexIpcAssistantRuntimeState {
  const [serverRequests, setServerRequests] = useState<CodexApprovalRequest[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelIdState] = useState<string | undefined>()
  const [conversationRuntime, setConversationRuntime] = useState<ConversationRuntimeState>({
    activeConversation: undefined,
    revision: 0
  })
  const activeConversation = conversationRuntime.activeConversation
  const { projectSelection } = options
  const latestTransportState = useMemo(() => new TransportStateHolder(), [])

  useEffect(() => {
    latestTransportState.set({
      activeConversation,
      projectSelection,
      conversationRevision: conversationRuntime.revision,
      selectedModelId
    })
  }, [
    activeConversation,
    conversationRuntime.revision,
    latestTransportState,
    projectSelection,
    selectedModelId
  ])

  useEffect(() => {
    let cancelled = false
    void window.desktopApp.codex.listModels().then((list) => {
      if (cancelled) return
      setModels(toModelOptions(list))
      setSelectedModelIdState(list.selectedModelId)
    })
    const removeApproval = window.desktopApp.codex.onApprovalRequest((request) => {
      setServerRequests((current) => [...current, request])
    })

    return () => {
      cancelled = true
      removeApproval()
    }
  }, [])

  const transport = useMemo(
    () =>
      new ElectronIpcChatTransport({
        chatBridge: window.desktopApp.chat,
        getActiveConversation: () => latestTransportState.getActiveConversation(),
        getProjectSelection: () => latestTransportState.getProjectSelection(),
        getConversationRevision: () => latestTransportState.getConversationRevision(),
        getSelectedModelId: () => latestTransportState.getSelectedModelId(),
        onStreamFinished: (context) =>
          setConversationRuntime((prev) => reduceStreamFinishedConversationState(prev, context))
      }),
    [latestTransportState]
  )
  const chat = useChat({ transport })
  const runtime = useAISDKRuntime(chat)

  const openConversation = useCallback(
    async (input: SidebarConversationActionPayload) => {
      const result = await window.desktopApp.conversations.openConversation(input)
      chat.setMessages(result.messages)
      setConversationRuntime((prev) => {
        return {
          activeConversation: {
            conversationId: result.conversationId,
            threadId: result.threadId,
            title: result.title,
            projectSelection: projectSelectionFromOpenResult(result),
            cwd: result.cwd
          },
          revision: prev.revision + 1
        }
      })
    },
    [chat]
  )

  const startNewConversation = useCallback(() => {
    chat.setMessages([])
    setConversationRuntime((prev) => ({
      activeConversation: undefined,
      revision: prev.revision + 1
    }))
  }, [chat])

  const setSelectedModelId = useCallback(async (modelId: string) => {
    const response = await window.desktopApp.codex.setSelectedModel(modelId)
    setSelectedModelIdState(response.selectedModelId)
  }, [])

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

  return {
    runtime,
    serverRequests,
    models,
    selectedModelId,
    activeConversation,
    startNewConversation,
    openConversation,
    setSelectedModelId,
    respondToServerRequest,
    rejectServerRequest
  }
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

function projectSelectionFromOpenResult(
  result: Pick<SidebarConversationOpenResult, 'projectAssignment'>
): ProjectSelection | undefined {
  const assignment = result.projectAssignment
  if (!assignment) return undefined

  if (assignment.projectKind === 'local') {
    if (assignment.path) {
      return { projectKind: 'path', path: assignment.path }
    }
    return { projectKind: 'local', projectId: assignment.projectId }
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

export function reduceStreamFinishedConversationState(
  state: ConversationRuntimeState,
  context: StreamFinishedContext
): ConversationRuntimeState {
  if (!context.threadId) return state
  if (state.revision !== context.conversationRevision) return state
  if (!sameActiveConversation(state.activeConversation, context.activeConversation)) return state

  const activeConversation = context.activeConversation
    ? {
        ...state.activeConversation!,
        threadId: context.threadId
      }
    : {
        conversationId: context.threadId,
        threadId: context.threadId,
        projectSelection: context.projectSelection
      }

  if (sameActiveConversation(state.activeConversation, activeConversation)) return state

  return {
    activeConversation,
    revision: state.revision + 1
  }
}

function sameActiveConversation(
  left: ActiveConversationContext | undefined,
  right: ActiveConversationContext | undefined
): boolean {
  if (!left || !right) return left === right
  return left.conversationId === right.conversationId && left.threadId === right.threadId
}
