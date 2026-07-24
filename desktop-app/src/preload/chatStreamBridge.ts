import type {
  CodexChatRequest,
  CodexChatTerminalFallback,
  CodexChatStreamCallbacks,
  CodexChatStreamEvent,
  DesktopCodexChatApi
} from '../shared/codexIpcApi'

type ActiveChatStream = {
  request: CodexChatRequest
  port: MessagePort
  abortRequested: boolean
  portFaulted: boolean
  fallbackTimer: ReturnType<typeof setTimeout> | undefined
  fallbackTerminal: CodexChatTerminalFallback['terminal'] | undefined
}

export type ChatStreamBridgeDependencies = {
  createStreamId(): string
  createMessageChannel(): MessageChannel
  postStart(request: CodexChatRequest, streamId: string, port: MessagePort): void
  postDetached?(streamId: string, request: CodexChatRequest): void
  subscribeTerminal?(listener: (fallback: CodexChatTerminalFallback) => void): () => void
  scheduleTimeout?(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout>
  clearTimeout?(timer: ReturnType<typeof setTimeout>): void
}

const MESSAGE_PORT_TERMINAL_TIMEOUT_MS = 1_000

export type ChatStreamBridge = DesktopCodexChatApi & {
  detachActiveStreams(): void
}

export function createChatStreamBridge(
  dependencies: ChatStreamBridgeDependencies
): ChatStreamBridge {
  const activeStreams = new Map<string, ActiveChatStream>()
  const callbacksByStreamId = new Map<string, CodexChatStreamCallbacks>()
  const scheduleTimeout = dependencies.scheduleTimeout ?? setTimeout
  const clearTimer = dependencies.clearTimeout ?? clearTimeout

  const closeStream = (streamId: string): ActiveChatStream | undefined => {
    const stream = activeStreams.get(streamId)
    if (!stream) return undefined
    activeStreams.delete(streamId)
    if (stream.fallbackTimer !== undefined) clearTimer(stream.fallbackTimer)
    stream.port.onmessage = null
    stream.port.onmessageerror = null
    stream.port.close()
    return stream
  }

  const dispatchTerminal = (
    streamId: string,
    terminal: CodexChatTerminalFallback['terminal'],
    callbacks: CodexChatStreamCallbacks
  ): void => {
    const stream = closeStream(streamId)
    if (!stream) return
    callbacksByStreamId.delete(streamId)
    switch (terminal.type) {
      case 'finish':
        callbacks.onFinish(terminal.threadId)
        return
      case 'aborted':
        callbacks.onAbort()
        return
      case 'error':
        callbacks.onError(terminal.error)
    }
  }

  const unsubscribeTerminal = dependencies.subscribeTerminal?.((fallback) => {
    const stream = activeStreams.get(fallback.streamId)
    if (!stream) return
    const callbacks = callbacksByStreamId.get(fallback.streamId)
    if (!callbacks) return
    stream.fallbackTerminal = fallback.terminal
    if (stream.portFaulted) {
      dispatchTerminal(fallback.streamId, fallback.terminal, callbacks)
      return
    }
    if (stream.fallbackTimer !== undefined) return
    stream.fallbackTimer = scheduleTimeout(() => {
      dispatchTerminal(fallback.streamId, fallback.terminal, callbacks)
    }, MESSAGE_PORT_TERMINAL_TIMEOUT_MS)
  })
  // Keep the subscription alive for the preload process lifetime. This bridge
  // is created once, while per-stream callbacks are removed at terminal.
  void unsubscribeTerminal

  return {
    startChatStream: (request, callbacks) => {
      const streamId = dependencies.createStreamId()
      const channel = dependencies.createMessageChannel()
      activeStreams.set(streamId, {
        request,
        port: channel.port1,
        abortRequested: false,
        portFaulted: false,
        fallbackTimer: undefined,
        fallbackTerminal: undefined
      })
      callbacksByStreamId.set(streamId, callbacks)
      channel.port1.onmessage = (event: MessageEvent<CodexChatStreamEvent>) => {
        const message = event.data
        const activeStream = activeStreams.get(streamId)
        if (!activeStream) return
        if (message.type === 'thread-bound') {
          if (!activeStream.abortRequested) callbacks.onThreadBound(message.threadId)
          activeStream.port.postMessage({ type: 'thread-bound-ack', threadId: message.threadId })
        }
        if (message.type === 'turn-lifecycle') {
          callbacks.onTurnLifecycle?.(message.event)
        }
        if (message.type === 'chunk' && !activeStream.abortRequested) {
          callbacks.onChunk(message.chunk)
        }
        if (message.type === 'finish') {
          dispatchTerminal(streamId, message, callbacks)
        }
        if (message.type === 'aborted') {
          dispatchTerminal(streamId, message, callbacks)
        }
        if (message.type === 'error') {
          dispatchTerminal(streamId, message, callbacks)
        }
      }
      channel.port1.onmessageerror = () => {
        const activeStream = activeStreams.get(streamId)
        if (!activeStream || activeStream.portFaulted) return
        activeStream.portFaulted = true
        activeStream.port.close()
        if (activeStream.fallbackTerminal) {
          dispatchTerminal(streamId, activeStream.fallbackTerminal, callbacks)
        }
      }
      dependencies.postStart(request, streamId, channel.port2)
      return streamId
    },
    abortChatStream: (streamId) => {
      const stream = activeStreams.get(streamId)
      if (!stream || stream.abortRequested) return
      stream.abortRequested = true
      stream.port.postMessage({ type: 'abort' })
    },
    detachActiveStreams: () => {
      for (const [streamId, stream] of activeStreams) {
        dependencies.postDetached?.(streamId, stream.request)
        stream.port.close()
      }
      activeStreams.clear()
      callbacksByStreamId.clear()
    }
  }
}
