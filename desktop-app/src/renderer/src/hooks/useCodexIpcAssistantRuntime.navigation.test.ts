// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SidebarConversationOpenResult } from '../../../shared/codexIpcApi'
import {
  useCodexIpcAssistantRuntime,
  type CodexIpcAssistantRuntimeState
} from './useCodexIpcAssistantRuntime'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const chatMock = vi.hoisted(() => ({
  clearError: vi.fn(),
  setMessages: vi.fn(),
  status: 'ready' as 'ready' | 'streaming'
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => chatMock
}))

vi.mock('@assistant-ui/react-ai-sdk', () => ({
  useAISDKRuntime: () => ({})
}))

describe('useCodexIpcAssistantRuntime conversation navigation', () => {
  let container: HTMLDivElement
  let root: Root
  let runtimeState: CodexIpcAssistantRuntimeState | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    runtimeState = null
    chatMock.clearError.mockReset()
    chatMock.setMessages.mockReset()
    chatMock.status = 'ready'
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps the last requested conversation when open responses finish out of order', async () => {
    const firstOpen = deferred<SidebarConversationOpenResult>()
    const secondOpen = deferred<SidebarConversationOpenResult>()
    const openConversation = vi
      .fn()
      .mockReturnValueOnce(firstOpen.promise)
      .mockReturnValueOnce(secondOpen.promise)
    installDesktopApp(openConversation)
    await renderProbe()

    let firstRequest: Promise<void> | undefined
    let secondRequest: Promise<void> | undefined
    await act(async () => {
      firstRequest = runtimeState?.openConversation({ conversationId: 'first' })
      secondRequest = runtimeState?.openConversation({ conversationId: 'second' })
    })

    await act(async () => {
      secondOpen.resolve(openResult('second'))
      await secondRequest
    })
    await act(async () => {
      firstOpen.resolve(openResult('first'))
      await firstRequest
    })

    expect(chatMock.setMessages).toHaveBeenCalledTimes(1)
    expect(chatMock.setMessages).toHaveBeenCalledWith(openResult('second').messages)
    expect(runtimeState?.activeConversation?.conversationId).toBe('second')
  })

  it('does not reopen a pending conversation after starting a new one', async () => {
    const pendingOpen = deferred<SidebarConversationOpenResult>()
    installDesktopApp(vi.fn(() => pendingOpen.promise))
    await renderProbe()

    let openRequest: Promise<void> | undefined
    await act(async () => {
      openRequest = runtimeState?.openConversation({ conversationId: 'pending' })
      runtimeState?.startNewConversation()
    })
    await act(async () => {
      pendingOpen.resolve(openResult('pending'))
      await openRequest
    })

    expect(chatMock.setMessages).toHaveBeenCalledTimes(1)
    expect(chatMock.setMessages).toHaveBeenCalledWith([])
    expect(runtimeState?.activeConversation).toBeUndefined()
  })

  it('blocks conversation navigation while the current response is streaming', async () => {
    const openConversation = vi.fn(async () => openResult('other'))
    installDesktopApp(openConversation)
    chatMock.status = 'streaming'
    await renderProbe()

    await act(async () => {
      await runtimeState?.openConversation({ conversationId: 'other' })
      runtimeState?.startNewConversation()
    })

    expect(runtimeState?.conversationNavigationBlocked).toBe(true)
    expect(openConversation).not.toHaveBeenCalled()
    expect(chatMock.setMessages).not.toHaveBeenCalled()
  })

  it('discards a pending conversation open when a response starts streaming', async () => {
    const pendingOpen = deferred<SidebarConversationOpenResult>()
    installDesktopApp(vi.fn(() => pendingOpen.promise))
    await renderProbe()

    let openRequest: Promise<void> | undefined
    await act(async () => {
      openRequest = runtimeState?.openConversation({ conversationId: 'pending' })
    })

    chatMock.status = 'streaming'
    await renderProbe()

    await act(async () => {
      pendingOpen.resolve(openResult('pending'))
      await openRequest
    })

    expect(chatMock.setMessages).not.toHaveBeenCalled()
    expect(runtimeState?.activeConversation).toBeUndefined()
  })

  async function renderProbe(): Promise<void> {
    await act(async () => {
      root.render(createElement(Probe, { onState: (state) => (runtimeState = state) }))
    })
  }
})

function Probe({ onState }: { onState: (state: CodexIpcAssistantRuntimeState) => void }): null {
  const state = useCodexIpcAssistantRuntime()

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}

function installDesktopApp(
  openConversation: (input: { conversationId: string }) => Promise<SidebarConversationOpenResult>
): void {
  vi.stubGlobal('desktopApp', {
    codex: {
      listModels: vi.fn(async () => ({ models: [] })),
      onApprovalRequest: vi.fn(() => vi.fn())
    },
    chat: {},
    conversations: { openConversation }
  })
}

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
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value)
  }
}
