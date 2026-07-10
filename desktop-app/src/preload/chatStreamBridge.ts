import type {
  CodexChatRequest,
  CodexChatStreamEvent,
  DesktopCodexChatApi
} from '../shared/codexIpcApi'

type ActiveChatStream = {
  port: MessagePort
  onAbort: () => void
  abortNotified: boolean
}

export type ChatStreamBridgeDependencies = {
  createStreamId(): string
  createMessageChannel(): MessageChannel
  postStart(request: CodexChatRequest, port: MessagePort): void
}

export function createChatStreamBridge(
  dependencies: ChatStreamBridgeDependencies
): DesktopCodexChatApi {
  const activeStreams = new Map<string, ActiveChatStream>()

  const closeStream = (streamId: string): ActiveChatStream | undefined => {
    const stream = activeStreams.get(streamId)
    if (!stream) return undefined
    activeStreams.delete(streamId)
    stream.port.close()
    return stream
  }

  return {
    startChatStream: (request, callbacks) => {
      const streamId = dependencies.createStreamId()
      const channel = dependencies.createMessageChannel()
      activeStreams.set(streamId, {
        port: channel.port1,
        onAbort: callbacks.onAbort,
        abortNotified: false
      })
      channel.port1.onmessage = (event: MessageEvent<CodexChatStreamEvent>) => {
        const message = event.data
        const activeStream = activeStreams.get(streamId)
        if (!activeStream) return
        if (message.type === 'thread-bound' && !activeStream.abortNotified) {
          callbacks.onThreadBound(message.threadId)
          activeStream.port.postMessage({ type: 'thread-bound-ack', threadId: message.threadId })
        }
        if (message.type === 'chunk' && !activeStream.abortNotified) {
          callbacks.onChunk(message.chunk)
        }
        if (message.type === 'finish') {
          const stream = closeStream(streamId)
          if (!stream || stream.abortNotified) return
          callbacks.onFinish(message.threadId)
        }
        if (message.type === 'aborted') {
          const stream = closeStream(streamId)
          if (!stream || stream.abortNotified) return
          callbacks.onAbort()
        }
        if (message.type === 'error') {
          const stream = closeStream(streamId)
          if (!stream || stream.abortNotified) return
          callbacks.onError(message.error)
        }
      }
      dependencies.postStart(request, channel.port2)
      return streamId
    },
    abortChatStream: (streamId) => {
      const stream = activeStreams.get(streamId)
      if (!stream || stream.abortNotified) return
      stream.port.postMessage({ type: 'abort' })
      stream.abortNotified = true
      stream.onAbort()
      closeStream(streamId)
    }
  }
}
