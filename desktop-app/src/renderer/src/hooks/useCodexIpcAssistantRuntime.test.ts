// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexApprovalRequest, DesktopCodexChatApi } from '../../../shared/codexIpcApi'
import {
  useCodexIpcAssistantRuntime,
  type CodexIpcAssistantRuntimeState
} from './useCodexIpcAssistantRuntime'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('useCodexIpcAssistantRuntime approvals', () => {
  let container: HTMLDivElement
  let root: Root
  let state: CodexIpcAssistantRuntimeState | null
  let emitApproval: (request: CodexApprovalRequest) => void
  let pendingApprovalSnapshot: CodexApprovalRequest[]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    state = null
    emitApproval = () => undefined
    pendingApprovalSnapshot = []
    window.localStorage.clear()
    installDesktopApp()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('only treats approvals for the active thread as composer-blocking', async () => {
    await renderProbe()
    const entry = state!.activeEntry
    act(() => {
      entry.context = { ...entry.context, threadId: 'thread-active' }
      emitApproval(approval('request-a', 'thread-background'))
      emitApproval(approval('request-b', 'thread-active'))
    })

    expect(state?.serverRequests).toHaveLength(2)
    expect(state?.activeServerRequests.map((request) => request.id)).toEqual(['request-b'])
  })

  it('does not associate an approval without a thread with the current conversation', async () => {
    await renderProbe()
    act(() => emitApproval({ ...approval('request-a', 'thread-a'), context: undefined }))

    expect(state?.serverRequests).toHaveLength(1)
    expect(state?.activeServerRequests).toHaveLength(0)
  })

  it('hydrates pending approvals after subscribing without duplicating live requests', async () => {
    pendingApprovalSnapshot = [approval('request-snapshot', 'thread-a')]
    await renderProbe()
    await vi.waitFor(() =>
      expect(state?.serverRequests.map((request) => request.id)).toEqual(['request-snapshot'])
    )

    act(() => emitApproval(approval('request-snapshot', 'thread-a')))
    expect(state?.serverRequests.map((request) => request.id)).toEqual(['request-snapshot'])
  })

  it('updates the local tool request after Main confirms an auto-resolution snooze', async () => {
    await renderProbe()
    const request: CodexApprovalRequest = {
      id: 'tool-timer',
      kind: 'tool-user-input',
      createdAt: '2026-07-10T00:00:00.000Z',
      context: { threadId: 'thread-active' },
      params: {
        autoResolutionMs: 3_000,
        deadlineAtMs: Date.now() + 3_000,
        autoResolutionSnoozed: false,
        questions: []
      }
    }
    const entry = state!.activeEntry
    act(() => {
      entry.context = { ...entry.context, threadId: 'thread-active' }
      emitApproval(request)
    })

    await act(async () => state!.snoozeServerRequest(request))

    expect(window.desktopApp.codex.snoozeApprovalAutoResolution).toHaveBeenCalledWith('tool-timer')
    expect(state!.serverRequests).toMatchObject([
      { id: 'tool-timer', params: { autoResolutionSnoozed: true } }
    ])
  })

  it('updates the unbound conversation project snapshot synchronously', async () => {
    await renderProbe()
    const entry = state!.activeEntry

    state!.setActiveProjectSelection({ projectKind: 'projectless' })

    expect(entry.context.projectSelection).toEqual({ projectKind: 'projectless' })
  })

  async function renderProbe(): Promise<void> {
    await act(async () => {
      root.render(createElement(Probe, { onState: (nextState) => (state = nextState) }))
    })
  }

  function installDesktopApp(): void {
    const chatBridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    vi.stubGlobal('desktopApp', {
      codex: {
        listModels: vi.fn(async () => ({ models: [] })),
        setSelectedModel: vi.fn(async (modelId: string) => ({ selectedModelId: modelId })),
        listPendingApprovals: vi.fn(async () => pendingApprovalSnapshot),
        respondApproval: vi.fn(async () => undefined),
        snoozeApprovalAutoResolution: vi.fn(async () => true),
        onApprovalRequest: vi.fn((listener: (request: CodexApprovalRequest) => void) => {
          emitApproval = listener
          return vi.fn()
        })
      },
      chat: chatBridge,
      conversations: {
        openConversation: vi.fn()
      }
    })
  }
})

function Probe({ onState }: { onState: (state: CodexIpcAssistantRuntimeState) => void }): null {
  const runtime = useCodexIpcAssistantRuntime()
  useEffect(() => {
    onState(runtime)
  }, [onState, runtime])
  return null
}

function approval(id: string, threadId: string): CodexApprovalRequest {
  return {
    id,
    kind: 'command',
    params: { networkPolicyScopes: [], availableIntents: ['approve', 'decline'] },
    createdAt: '2026-07-10T00:00:00.000Z',
    context: { threadId }
  }
}
