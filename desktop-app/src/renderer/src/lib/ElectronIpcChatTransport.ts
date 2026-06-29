import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import type { DesktopCodexChatApi } from '../../../shared/codexIpcApi'

export type ElectronIpcChatTransportOptions = {
  chatBridge: DesktopCodexChatApi
  getSelectedModelId: () => string | undefined
}

export class ElectronIpcChatTransport implements ChatTransport<UIMessage> {
  private readonly chatBridge: DesktopCodexChatApi
  private readonly getSelectedModelId: () => string | undefined

  constructor(options: ElectronIpcChatTransportOptions) {
    this.chatBridge = options.chatBridge
    this.getSelectedModelId = options.getSelectedModelId
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    let streamId: string | undefined
    let settled = false

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const closeStream = (): void => {
          if (settled) return
          settled = true
          controller.close()
        }
        const errorStream = (error: string): void => {
          if (settled) return
          settled = true
          controller.error(new Error(error))
        }

        streamId = this.chatBridge.startChatStream(
          {
            chatId: options.chatId,
            trigger: options.trigger,
            messageId: options.messageId,
            messages: options.messages,
            modelId: this.getSelectedModelId(),
            metadata: options.metadata,
            body: options.body as Record<string, unknown> | undefined
          },
          {
            onChunk: (chunk) => {
              if (!settled) controller.enqueue(chunk)
            },
            onFinish: closeStream,
            onAbort: closeStream,
            onError: errorStream
          }
        )
        options.abortSignal?.addEventListener(
          'abort',
          () => {
            if (streamId) this.chatBridge.abortChatStream(streamId)
          },
          { once: true }
        )
      },
      cancel: () => {
        settled = true
        if (streamId) this.chatBridge.abortChatStream(streamId)
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
