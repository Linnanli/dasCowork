import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import type { DesktopCodexChatApi } from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'

export type ActiveConversationContext = {
  conversationId: string
  threadId: string
  title?: string | null
  projectSelection?: ProjectSelection
  cwd?: string | null
}

export type ElectronIpcChatTransportOptions = {
  chatBridge: DesktopCodexChatApi
  getActiveConversation?: () => ActiveConversationContext | undefined
  getProjectSelection?: () => ProjectSelection | undefined
  getSelectedModelId: () => string | undefined
}

export class ElectronIpcChatTransport implements ChatTransport<UIMessage> {
  private readonly chatBridge: DesktopCodexChatApi
  private readonly getActiveConversation: () => ActiveConversationContext | undefined
  private readonly getProjectSelection: () => ProjectSelection | undefined
  private readonly getSelectedModelId: () => string | undefined

  constructor(options: ElectronIpcChatTransportOptions) {
    this.chatBridge = options.chatBridge
    this.getActiveConversation = options.getActiveConversation ?? (() => undefined)
    this.getProjectSelection = options.getProjectSelection ?? (() => undefined)
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
            body: this.createTrustedBody(options.body)
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

  private createTrustedBody(body: unknown): Record<string, unknown> | undefined {
    const trustedBody = stripRendererExecutionHints(body)
    const activeConversation = this.getActiveConversation()
    const projectSelection = activeConversation?.projectSelection ?? this.getProjectSelection()
    if (projectSelection) trustedBody.projectSelection = projectSelection
    if (activeConversation) {
      trustedBody.conversationId = activeConversation.conversationId
      trustedBody.threadId = activeConversation.threadId
    }
    return Object.keys(trustedBody).length > 0 ? trustedBody : undefined
  }
}

function stripRendererExecutionHints(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const {
    cwd: _cwd,
    runtimeWorkspaceRoots: _runtimeWorkspaceRoots,
    conversationId: _conversationId,
    threadId: _threadId,
    projectSelection: _projectSelection,
    ...trustedBody
  } = body as Record<string, unknown>
  void _cwd
  void _runtimeWorkspaceRoots
  void _conversationId
  void _threadId
  void _projectSelection
  return trustedBody
}
