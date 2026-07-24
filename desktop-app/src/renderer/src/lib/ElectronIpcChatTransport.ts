import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import type { CodexTurnLifecycleEvent, DesktopCodexChatApi } from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'

export type ActiveConversationContext = {
  conversationId: string
  threadId?: string
  title?: string | null
  projectSelection?: ProjectSelection
  cwd?: string | null
}

export type ElectronIpcChatTransportOptions = {
  chatBridge: DesktopCodexChatApi
  getActiveConversation?: () => ActiveConversationContext | undefined
  getProjectSelection?: () => ProjectSelection | undefined
  getConversationRevision?: () => number
  getSelectedModelId: () => string | undefined
  onStreamStarted?: () => void
  onThreadBound?: (context: StreamFinishedContext & { threadId: string }) => void
  onTurnLifecycle?: (event: CodexTurnLifecycleEvent) => void
  onStreamAccepted?: () => void
  onStreamAborted?: () => void
  onStreamError?: (error: string) => void
  onStreamFinished?: (context: StreamFinishedContext) => void
}

export type StreamFinishedContext = {
  chatId: string
  threadId: string | undefined
  activeConversation: ActiveConversationContext | undefined
  projectSelection: ProjectSelection | undefined
  conversationRevision: number
}

type TrustedRequestContext = {
  body: Record<string, unknown> | undefined
  activeConversation: ActiveConversationContext | undefined
  projectSelection: ProjectSelection | undefined
  conversationRevision: number
}

export class ElectronIpcChatTransport implements ChatTransport<UIMessage> {
  private readonly chatBridge: DesktopCodexChatApi
  private readonly getActiveConversation: () => ActiveConversationContext | undefined
  private readonly getProjectSelection: () => ProjectSelection | undefined
  private readonly getConversationRevision: () => number
  private readonly getSelectedModelId: () => string | undefined
  private readonly onStreamStarted: (() => void) | undefined
  private readonly onThreadBound:
    | ((context: StreamFinishedContext & { threadId: string }) => void)
    | undefined
  private readonly onTurnLifecycle: ((event: CodexTurnLifecycleEvent) => void) | undefined
  private readonly onStreamAccepted: (() => void) | undefined
  private readonly onStreamAborted: (() => void) | undefined
  private readonly onStreamError: ((error: string) => void) | undefined
  private readonly onStreamFinished: ((context: StreamFinishedContext) => void) | undefined

  constructor(options: ElectronIpcChatTransportOptions) {
    this.chatBridge = options.chatBridge
    this.getActiveConversation = options.getActiveConversation ?? (() => undefined)
    this.getProjectSelection = options.getProjectSelection ?? (() => undefined)
    this.getConversationRevision = options.getConversationRevision ?? (() => 0)
    this.getSelectedModelId = options.getSelectedModelId
    this.onStreamStarted = options.onStreamStarted
    this.onThreadBound = options.onThreadBound
    this.onTurnLifecycle = options.onTurnLifecycle
    this.onStreamAccepted = options.onStreamAccepted
    this.onStreamAborted = options.onStreamAborted
    this.onStreamError = options.onStreamError
    this.onStreamFinished = options.onStreamFinished
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    let streamId: string | undefined
    let settled = false
    let accepted = false
    let detachAbortListener = (): void => undefined

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const trustedContext = this.createTrustedContext(options.body)
        const abortSignal = options.abortSignal
        const streamContext = (threadId: string | undefined): StreamFinishedContext => ({
          chatId: options.chatId,
          threadId,
          activeConversation: trustedContext.activeConversation,
          projectSelection: trustedContext.projectSelection,
          conversationRevision: trustedContext.conversationRevision
        })
        const markAccepted = (): void => {
          if (accepted) return
          accepted = true
          this.onStreamAccepted?.()
        }
        const handleAbortSignal = (): void => {
          if (streamId) this.chatBridge.abortChatStream(streamId)
        }
        const removeAbortListener = (): void => {
          abortSignal?.removeEventListener('abort', handleAbortSignal)
        }
        detachAbortListener = removeAbortListener
        const closeStream = (): void => {
          if (settled) return
          settled = true
          removeAbortListener()
          controller.close()
        }
        const errorStream = (error: string): void => {
          if (settled) return
          settled = true
          removeAbortListener()
          this.onStreamError?.(error)
          controller.error(new Error(error))
        }

        this.onStreamStarted?.()
        streamId = this.chatBridge.startChatStream(
          {
            chatId: options.chatId,
            trigger: options.trigger,
            messageId: options.messageId,
            messages: options.messages,
            modelId: this.getSelectedModelId(),
            metadata: options.metadata,
            body: trustedContext.body
          },
          {
            onTurnLifecycle: (event) => {
              if (settled) return
              markAccepted()
              this.onTurnLifecycle?.(event)
            },
            onThreadBound: (threadId) => {
              if (settled) return
              markAccepted()
              this.onThreadBound?.({ ...streamContext(threadId), threadId })
            },
            onChunk: (chunk) => {
              if (settled) return
              markAccepted()
              controller.enqueue(chunk)
            },
            onFinish: (threadId) => {
              if (settled) return
              markAccepted()
              this.onStreamFinished?.(streamContext(threadId))
              closeStream()
            },
            onAbort: () => {
              if (settled) return
              markAccepted()
              this.onStreamAborted?.()
              closeStream()
            },
            onError: errorStream
          }
        )
        abortSignal?.addEventListener('abort', handleAbortSignal, { once: true })
        if (abortSignal?.aborted) handleAbortSignal()
      },
      cancel: () => {
        settled = true
        detachAbortListener()
        // A ReadableStream consumer can disappear during a renderer reload or
        // navigation. That only detaches this renderer subscription; it is
        // not a user request to interrupt the authoritative app-server turn.
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  private createTrustedContext(body: unknown): TrustedRequestContext {
    const trustedBody = stripRendererExecutionHints(body)
    const activeConversation = this.getActiveConversation()
    const projectSelection = activeConversation?.projectSelection ?? this.getProjectSelection()
    if (projectSelection) trustedBody.projectSelection = projectSelection
    if (activeConversation) {
      trustedBody.conversationId = activeConversation.conversationId
      if (activeConversation.threadId) trustedBody.threadId = activeConversation.threadId
    }
    return {
      body: Object.keys(trustedBody).length > 0 ? trustedBody : undefined,
      activeConversation,
      projectSelection,
      conversationRevision: this.getConversationRevision()
    }
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
