import { describe, expect, it, vi } from 'vitest'

import type {
  CodexChatRequest,
  CodexChatStreamCallbacks,
  CodexChatStreamEvent
} from '../shared/codexIpcApi'
import { createChatStreamBridge } from './chatStreamBridge'

class FakeMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null
  peer: FakeMessagePort | undefined
  closed = false

  postMessage(message: unknown): void {
    this.peer?.onmessage?.({ data: message } as MessageEvent)
  }

  close(): void {
    this.closed = true
  }
}

function createFakeMessageChannel(): MessageChannel {
  const port1 = new FakeMessagePort()
  const port2 = new FakeMessagePort()
  port1.peer = port2
  port2.peer = port1
  return { port1, port2 } as unknown as MessageChannel
}

function createCallbacks(): CodexChatStreamCallbacks {
  return {
    onThreadBound: vi.fn(),
    onChunk: vi.fn(),
    onFinish: vi.fn(),
    onAbort: vi.fn(),
    onError: vi.fn()
  }
}

function createRequest(chatId: string): CodexChatRequest {
  return {
    chatId,
    trigger: 'submit-message',
    messages: []
  }
}

describe('createChatStreamBridge', () => {
  it('dispatches thread bindings and terminal events on their own message channels', () => {
    const startedPorts: MessagePort[] = []
    const controlMessages: unknown[] = []
    let nextId = 0
    const bridge = createChatStreamBridge({
      createStreamId: () => `stream-${++nextId}`,
      createMessageChannel: createFakeMessageChannel,
      postStart: (_request, port) => startedPorts.push(port)
    })
    const firstCallbacks = createCallbacks()
    const secondCallbacks = createCallbacks()

    bridge.startChatStream(createRequest('chat-1'), firstCallbacks)
    bridge.startChatStream(createRequest('chat-2'), secondCallbacks)
    ;(startedPorts[0] as unknown as FakeMessagePort).onmessage = (event) => {
      controlMessages.push(event.data)
    }
    startedPorts[0].postMessage({ type: 'thread-bound', threadId: 'thread-1' })
    startedPorts[0].postMessage({ type: 'finish', threadId: 'thread-1' })
    startedPorts[1].postMessage({
      type: 'chunk',
      chunk: { type: 'text-start', id: 'text-2' }
    } satisfies CodexChatStreamEvent)

    expect(firstCallbacks.onThreadBound).toHaveBeenCalledWith('thread-1')
    expect(controlMessages).toContainEqual({
      type: 'thread-bound-ack',
      threadId: 'thread-1'
    })
    expect(firstCallbacks.onFinish).toHaveBeenCalledWith('thread-1')
    expect(secondCallbacks.onThreadBound).not.toHaveBeenCalled()
    expect(secondCallbacks.onChunk).toHaveBeenCalledWith({ type: 'text-start', id: 'text-2' })
    expect((startedPorts[0] as unknown as FakeMessagePort).peer?.closed).toBe(true)
    expect((startedPorts[1] as unknown as FakeMessagePort).peer?.closed).toBe(false)
  })

  it('waits for the authoritative aborted event after requesting abort', () => {
    let startedPort: MessagePort | undefined
    const callbacks = createCallbacks()
    const bridge = createChatStreamBridge({
      createStreamId: () => 'stream-1',
      createMessageChannel: createFakeMessageChannel,
      postStart: (_request, port) => {
        startedPort = port
      }
    })
    let abortMessages = 0

    bridge.startChatStream(createRequest('chat-1'), callbacks)
    ;(startedPort as unknown as FakeMessagePort).onmessage = (event) => {
      if ((event.data as { type?: string }).type === 'abort') abortMessages += 1
    }
    bridge.abortChatStream('stream-1')
    bridge.abortChatStream('stream-1')

    expect(abortMessages).toBe(1)
    expect(callbacks.onAbort).not.toHaveBeenCalled()
    expect((startedPort as unknown as FakeMessagePort).peer?.closed).toBe(false)

    startedPort?.postMessage({ type: 'aborted' })

    expect(callbacks.onAbort).toHaveBeenCalledTimes(1)
    expect((startedPort as unknown as FakeMessagePort).peer?.closed).toBe(true)

    startedPort?.postMessage({ type: 'aborted' })

    expect(callbacks.onAbort).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      terminal: { type: 'finish', threadId: 'thread-1' } satisfies CodexChatStreamEvent,
      callback: 'onFinish' as const,
      expectedArgument: 'thread-1'
    },
    {
      terminal: { type: 'error', error: 'provider failed' } satisfies CodexChatStreamEvent,
      callback: 'onError' as const,
      expectedArgument: 'provider failed'
    }
  ])(
    'uses main $terminal.type as the terminal result when it races with abort',
    ({ terminal, callback, expectedArgument }) => {
      let startedPort: MessagePort | undefined
      const callbacks = createCallbacks()
      const bridge = createChatStreamBridge({
        createStreamId: () => 'stream-1',
        createMessageChannel: createFakeMessageChannel,
        postStart: (_request, port) => {
          startedPort = port
        }
      })

      bridge.startChatStream(createRequest('chat-1'), callbacks)
      bridge.abortChatStream('stream-1')

      expect(callbacks.onAbort).not.toHaveBeenCalled()
      startedPort?.postMessage(terminal)

      expect(callbacks[callback]).toHaveBeenCalledWith(expectedArgument)
      expect(callbacks.onAbort).not.toHaveBeenCalled()
      expect((startedPort as unknown as FakeMessagePort).peer?.closed).toBe(true)
    }
  )

  it('ignores non-terminal events while an abort request is pending', () => {
    let startedPort: MessagePort | undefined
    const controlMessages: unknown[] = []
    const callbacks = createCallbacks()
    const bridge = createChatStreamBridge({
      createStreamId: () => 'stream-1',
      createMessageChannel: createFakeMessageChannel,
      postStart: (_request, port) => {
        startedPort = port
      }
    })

    bridge.startChatStream(createRequest('chat-1'), callbacks)
    ;(startedPort as unknown as FakeMessagePort).onmessage = (event) => {
      controlMessages.push(event.data)
    }
    bridge.abortChatStream('stream-1')
    startedPort?.postMessage({ type: 'thread-bound', threadId: 'thread-1' })
    startedPort?.postMessage({
      type: 'chunk',
      chunk: { type: 'text-start', id: 'text-1' }
    } satisfies CodexChatStreamEvent)

    expect(callbacks.onThreadBound).not.toHaveBeenCalled()
    expect(controlMessages).toContainEqual({
      type: 'thread-bound-ack',
      threadId: 'thread-1'
    })
    expect(callbacks.onChunk).not.toHaveBeenCalled()
    expect((startedPort as unknown as FakeMessagePort).peer?.closed).toBe(false)
  })

  it('removes a finished stream before invoking its callback', () => {
    let startedPort: MessagePort | undefined
    const callbacks = createCallbacks()
    const bridge = createChatStreamBridge({
      createStreamId: () => 'stream-1',
      createMessageChannel: createFakeMessageChannel,
      postStart: (_request, port) => {
        startedPort = port
      }
    })
    vi.mocked(callbacks.onFinish).mockImplementation(() => bridge.abortChatStream('stream-1'))

    bridge.startChatStream(createRequest('chat-1'), callbacks)
    startedPort?.postMessage({ type: 'finish', threadId: 'thread-1' })

    expect(callbacks.onFinish).toHaveBeenCalledTimes(1)
    expect(callbacks.onAbort).not.toHaveBeenCalled()
  })

  it('keeps stopping streams open until main settles them, then releases them', () => {
    const startedPorts: MessagePort[] = []
    let nextId = 0
    const bridge = createChatStreamBridge({
      createStreamId: () => `stream-${++nextId}`,
      createMessageChannel: createFakeMessageChannel,
      postStart: (_request, port) => startedPorts.push(port)
    })
    const callbacks = Array.from({ length: 12 }, () => createCallbacks())

    callbacks.forEach((streamCallbacks, index) => {
      bridge.startChatStream(createRequest(`chat-${index}`), streamCallbacks)
      bridge.abortChatStream(`stream-${index + 1}`)
    })

    expect(
      startedPorts.every((port) => (port as unknown as FakeMessagePort).peer?.closed === false)
    ).toBe(true)
    callbacks.forEach((streamCallbacks) => {
      expect(streamCallbacks.onAbort).not.toHaveBeenCalled()
    })

    startedPorts.forEach((port) => port.postMessage({ type: 'aborted' }))
    expect(
      startedPorts.every((port) => (port as unknown as FakeMessagePort).peer?.closed === true)
    ).toBe(true)
    callbacks.forEach((streamCallbacks) => {
      expect(streamCallbacks.onAbort).toHaveBeenCalledTimes(1)
    })
  })
})
