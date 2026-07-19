import type {
  CodexChatRequest,
  CodexChatStreamEvent,
  DesktopCodexChatApi
} from '../shared/codexIpcApi'

type ActiveChatStream = {
  port: MessagePort
  abortRequested: boolean
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
        abortRequested: false
      })
      channel.port1.onmessage = (event: MessageEvent<CodexChatStreamEvent>) => {
        const message = event.data
        const activeStream = activeStreams.get(streamId)
        if (!activeStream) return
        if (message.type === 'thread-bound') {
          if (!activeStream.abortRequested) callbacks.onThreadBound(message.threadId)
          activeStream.port.postMessage({ type: 'thread-bound-ack', threadId: message.threadId })
        }
        if (message.type === 'chunk' && !activeStream.abortRequested) {
          callbacks.onChunk(message.chunk)
        }
        if (message.type === 'finish') {
          const stream = closeStream(streamId)
          if (!stream) return
          callbacks.onFinish(message.threadId)
        }
        if (message.type === 'aborted') {
          const stream = closeStream(streamId)
          if (!stream) return
          callbacks.onAbort()
        }
        if (message.type === 'error') {
          const stream = closeStream(streamId)
          if (!stream) return
          callbacks.onError(message.error)
        }
      }
      dependencies.postStart(request, channel.port2)
      return streamId
    },
    abortChatStream: (streamId) => {
      const stream = activeStreams.get(streamId)
      if (!stream || stream.abortRequested) return
      stream.abortRequested = true
      stream.port.postMessage({ type: 'abort' })
    }
  }
}
