import { describe, expect, it, vi } from 'vitest'

import { ElectronIpcChatTransport } from './ElectronIpcChatTransport'
import type { DesktopCodexChatApi } from '../../../shared/codexIpcApi'

describe('ElectronIpcChatTransport', () => {
  it('returns a stream that yields chunks from the desktop bridge', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    const stream = await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onChunk({ type: 'text-start', id: 'text-1' })
    callbacks?.onFinish()

    const reader = stream.getReader()
    const chunks: unknown[] = []
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    expect(chunks).toEqual([{ type: 'text-start', id: 'text-1' }])
    expect(bridge.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', modelId: 'gpt-test' }),
      expect.any(Object)
    )
  })

  it('aborts active stream through the desktop bridge', async () => {
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    const abortController = new AbortController()
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: abortController.signal
    })
    abortController.abort()

    expect(bridge.abortChatStream).toHaveBeenCalledWith('stream-1')
  })

  it('binds project selection and strips renderer execution hints from request body', async () => {
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getProjectSelection: () => ({ projectKind: 'path', path: '/repo' }),
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: {
        conversationId: 'conversation-1',
        threadId: 'thread-1',
        cwd: '/renderer/cwd',
        projectSelection: { projectKind: 'path', path: '/renderer/project' },
        runtimeWorkspaceRoots: ['/renderer/root']
      }
    })

    expect(bridge.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          projectSelection: { projectKind: 'path', path: '/repo' }
        }
      }),
      expect.any(Object)
    )
    const request = vi.mocked(bridge.startChatStream).mock.calls[0][0]
    expect(request.body).not.toHaveProperty('conversationId')
    expect(request.body).not.toHaveProperty('threadId')
  })

  it('binds active conversation identity from the trusted runtime context', async () => {
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getActiveConversation: () => ({ conversationId: 'conversation-1', threadId: 'thread-1' }),
      getProjectSelection: () => ({ projectKind: 'path', path: '/repo' }),
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: {
        conversationId: 'renderer-forged-conversation',
        threadId: 'renderer-forged-thread',
        cwd: '/renderer/cwd',
        runtimeWorkspaceRoots: ['/renderer/root']
      }
    })

    expect(bridge.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          conversationId: 'conversation-1',
          threadId: 'thread-1',
          projectSelection: { projectKind: 'path', path: '/repo' }
        }
      }),
      expect.any(Object)
    )
  })

  it('uses the opened conversation project context before ambient project selection', async () => {
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getActiveConversation: () => ({
        conversationId: 'conversation-1',
        threadId: 'thread-1',
        projectSelection: { projectKind: 'remote', projectId: 'remote-app', hostId: 'ssh-dev' }
      }),
      getProjectSelection: () => ({ projectKind: 'path', path: '/ambient-project' }),
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })

    expect(bridge.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          conversationId: 'conversation-1',
          threadId: 'thread-1',
          projectSelection: {
            projectKind: 'remote',
            projectId: 'remote-app',
            hostId: 'ssh-dev'
          }
        }
      }),
      expect.any(Object)
    )
  })

  it('ignores bridge chunks after the readable stream has finished', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onFinish()

    expect(() => callbacks?.onChunk({ type: 'text-start', id: 'late-text' })).not.toThrow()
  })

  it('ignores bridge finish events after the readable stream has errored', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onError('boom')

    expect(() => callbacks?.onFinish()).not.toThrow()
  })

  it('calls onStreamFinished with stream-scoped context when the stream finishes', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const onStreamFinished = vi.fn()
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getActiveConversation: () => ({ conversationId: 'conversation-1', threadId: 'thread-1' }),
      getProjectSelection: () => ({ projectKind: 'path', path: '/repo' }),
      getConversationRevision: () => 7,
      getSelectedModelId: () => 'gpt-test',
      onStreamFinished
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onFinish('thread-real')

    expect(onStreamFinished).toHaveBeenCalledWith({
      chatId: 'chat-1',
      threadId: 'thread-real',
      activeConversation: { conversationId: 'conversation-1', threadId: 'thread-1' },
      projectSelection: { projectKind: 'path', path: '/repo' },
      conversationRevision: 7
    })
  })

  it('does not call onStreamFinished for a late finish after an error', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const onStreamFinished = vi.fn()
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test',
      onStreamFinished
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onError('boom')
    callbacks?.onFinish('thread-real')

    expect(onStreamFinished).not.toHaveBeenCalled()
  })
})
