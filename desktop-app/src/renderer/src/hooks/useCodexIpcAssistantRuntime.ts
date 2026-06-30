import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk'

import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexModelList
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'
import type { ModelOption } from '../components/assistant-ui'
import { ElectronIpcChatTransport } from '../lib/ElectronIpcChatTransport'

export type CodexIpcAssistantRuntimeState = {
  runtime: ReturnType<typeof useAISDKRuntime>
  serverRequests: readonly CodexApprovalRequest[]
  models: readonly ModelOption[]
  selectedModelId: string | undefined
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

export function useCodexIpcAssistantRuntime(
  options: CodexIpcAssistantRuntimeOptions = {}
): CodexIpcAssistantRuntimeState {
  const [serverRequests, setServerRequests] = useState<CodexApprovalRequest[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelIdState] = useState<string | undefined>()
  const { projectSelection } = options
  const projectSelectionRef = useRef(projectSelection)
  const selectedModelIdRef = useRef(selectedModelId)

  projectSelectionRef.current = projectSelection
  selectedModelIdRef.current = selectedModelId

  useEffect(() => {
    let cancelled = false
    void window.desktopCodex.listModels().then((list) => {
      if (cancelled) return
      setModels(toModelOptions(list))
      setSelectedModelIdState(list.selectedModelId)
    })
    const removeApproval = window.desktopCodex.onApprovalRequest((request) => {
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
        chatBridge: window.desktopCodexChat,
        getProjectSelection: () => projectSelectionRef.current,
        getSelectedModelId: () => selectedModelIdRef.current
      }),
    []
  )
  const chat = useChat({ transport })
  const runtime = useAISDKRuntime(chat)

  const setSelectedModelId = useCallback(async (modelId: string) => {
    const response = await window.desktopCodex.setSelectedModel(modelId)
    setSelectedModelIdState(response.selectedModelId)
  }, [])

  const respondToServerRequest = useCallback(
    async (request: CodexApprovalRequest, response: CodexApprovalResponse) => {
      await window.desktopCodex.respondApproval(request.id, response)
      setServerRequests((current) => current.filter((item) => item.id !== request.id))
    },
    []
  )

  const rejectServerRequest = useCallback(async (request: CodexApprovalRequest) => {
    await window.desktopCodex.respondApproval(request.id, {
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
