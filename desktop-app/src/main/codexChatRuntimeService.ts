import { app } from 'electron'
import { convertToModelMessages, streamText as aiStreamText, type UIMessageChunk } from 'ai'
import {
  codexCallOptions,
  type CodexProvider,
  type CommandApprovalHandler,
  type FileChangeApprovalHandler
} from '@janole/ai-sdk-provider-codex-asp'

import { CodexApprovalBroker, type CodexApprovalRequestInput } from './codexApprovalBroker'
import {
  resolveCodexAppServerLaunchOptions,
  type CodexAppServerLaunchOptions
} from './codexAppServerLaunch'
import { createCodexAspProvider } from './codexAspProvider'
import type { ModelCatalogService } from './modelCatalogService'
import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexChatRequest,
  CodexChatStreamEvent,
  CodexModel,
  CodexModelList,
  CodexStatus
} from '../shared/codexIpcApi'

export type CodexPortLike = {
  postMessage(message: CodexChatStreamEvent): void
  on(event: 'message', handler: (event: { data: unknown }) => void): void
  start(): void
  close(): void
}

type StreamTextLikeResult = {
  toUIMessageStream(options?: {
    originalMessages?: CodexChatRequest['messages']
    sendReasoning?: boolean
    sendSources?: boolean
  }): AsyncIterable<UIMessageChunk>
}

type StreamTextLike = (input: {
  request: CodexChatRequest
  modelId: string
  provider: CodexProvider
  abortSignal: AbortSignal
}) => Promise<StreamTextLikeResult> | StreamTextLikeResult

export type ModelCatalogLike = Pick<
  ModelCatalogService,
  'listModels' | 'setSelectedModel' | 'resolveClientModel'
>

export type CodexChatRuntimeServiceOptions = {
  cwd?: string
  defaultModel?: string
  launch?: CodexAppServerLaunchOptions
  modelCatalog?: ModelCatalogLike
  streamText?: StreamTextLike
}

export class CodexChatRuntimeService {
  private readonly approvalBroker = new CodexApprovalBroker()
  private readonly cwd: string
  private readonly provider: CodexProvider
  private readonly launch: CodexAppServerLaunchOptions
  private readonly modelCatalog: ModelCatalogLike | undefined
  private readonly streamText: StreamTextLike
  private selectedModelId: string | undefined
  private status: CodexStatus

  constructor(options: CodexChatRuntimeServiceOptions = {}) {
    this.cwd = options.cwd ?? app.getAppPath()
    this.launch =
      options.launch ??
      resolveCodexAppServerLaunchOptions({
        env: process.env,
        isPackaged: app.isPackaged,
        mainDir: __dirname,
        resourcesPath: process.resourcesPath
      })
    this.streamText = options.streamText ?? defaultStreamText
    this.modelCatalog = options.modelCatalog
    this.provider = createCodexAspProvider({
      launch: this.launch,
      cwd: this.cwd,
      defaultModel: options.defaultModel,
      onCommandApproval: this.handleCommandApproval,
      onFileChangeApproval: this.handleFileChangeApproval,
      onToolUserInput: this.handleToolUserInput,
      onElicitation: this.handleElicitation
    })
    this.status = {
      state: 'stopped',
      binary: this.launch.displayBinary
    }
  }

  getStatus(): CodexStatus {
    return { ...this.status }
  }

  onApprovalRequest(listener: (request: CodexApprovalRequest) => void): () => void {
    return this.approvalBroker.onRequest(listener)
  }

  requestApprovalForTest(input: CodexApprovalRequestInput): Promise<CodexApprovalResponse> {
    return this.approvalBroker.request(input)
  }

  respondApproval(requestId: string, response: CodexApprovalResponse): void {
    this.approvalBroker.respond(requestId, response)
  }

  async listModels(): Promise<CodexModelList> {
    if (this.modelCatalog) {
      try {
        const list = await this.modelCatalog.listModels()
        this.selectedModelId = list.selectedModelId
        return list
      } catch (error) {
        return { models: [], unavailableReason: errorMessage(error) }
      }
    }

    try {
      const models = await this.provider.listModels()
      const mapped = models.map<CodexModel>((model) => ({
        id: model.id,
        displayName: model.displayName || model.model || model.id,
        description: model.description || undefined,
        inputModalities: model.inputModalities ?? [],
        isDefault: Boolean(model.isDefault)
      }))
      const selectedModelId =
        this.selectedModelId ?? mapped.find((model) => model.isDefault)?.id ?? mapped[0]?.id
      this.selectedModelId = selectedModelId
      return { models: mapped, selectedModelId }
    } catch (error) {
      return { models: [], unavailableReason: errorMessage(error) }
    }
  }

  async setSelectedModel(modelId: string): Promise<{ selectedModelId: string }> {
    if (!modelId.trim()) throw new Error('modelId is required')
    if (this.modelCatalog) {
      const response = await this.modelCatalog.setSelectedModel(modelId)
      this.selectedModelId = response.selectedModelId
      return response
    }

    this.selectedModelId = modelId
    return { selectedModelId: modelId }
  }

  async startChatStream(request: CodexChatRequest, port: CodexPortLike): Promise<void> {
    const abortController = new AbortController()
    port.on('message', (event) => {
      if (isAbortMessage(event.data)) abortController.abort()
    })
    port.start()

    try {
      this.status = {
        state: 'starting',
        binary: this.launch.displayBinary
      }
      const modelId = request.modelId ?? this.selectedModelId
      if (!modelId) throw new Error('No Codex model selected')
      if (this.modelCatalog) await this.modelCatalog.resolveClientModel(modelId)
      const result = await this.streamText({
        request,
        modelId,
        provider: this.provider,
        abortSignal: abortController.signal
      })
      this.status = {
        state: 'ready',
        binary: this.launch.displayBinary,
        startedAt: new Date().toISOString()
      }
      for await (const chunk of result.toUIMessageStream({
        originalMessages: request.messages,
        sendReasoning: true,
        sendSources: true
      })) {
        port.postMessage({ type: 'chunk', chunk })
      }
      port.postMessage({ type: abortController.signal.aborted ? 'aborted' : 'finish' })
    } catch (error) {
      if (abortController.signal.aborted) {
        port.postMessage({ type: 'aborted' })
      } else {
        this.status = {
          state: 'failed',
          binary: this.launch.displayBinary,
          lastError: errorMessage(error)
        }
        port.postMessage({ type: 'error', error: errorMessage(error) })
      }
    } finally {
      port.close()
    }
  }

  async stop(): Promise<void> {
    this.status = { state: 'stopping', binary: this.launch.displayBinary }
    this.approvalBroker.rejectAll(new Error('Codex runtime is stopping'))
    await this.provider.shutdown()
    this.status = { state: 'stopped', binary: this.launch.displayBinary }
  }

  private readonly handleCommandApproval: CommandApprovalHandler = async (params) => {
    const response = await this.approvalBroker.request({ kind: 'command', params })
    if (response.action === 'approveForSession' || response.action === 'alwaysApprove') {
      return 'acceptForSession'
    }
    if (response.action === 'approve') return 'accept'
    if (response.action === 'decline') return 'decline'
    return 'cancel'
  }

  private readonly handleFileChangeApproval: FileChangeApprovalHandler = async (params) => {
    const response = await this.approvalBroker.request({ kind: 'file-change', params })
    if (response.action === 'approveForSession' || response.action === 'alwaysApprove') {
      return 'acceptForSession'
    }
    if (response.action === 'approve') return 'accept'
    if (response.action === 'decline') return 'decline'
    return 'cancel'
  }

  private readonly handleToolUserInput = async (
    params: unknown
  ): Promise<{ answers: Record<string, { answers: string[] }> }> => {
    const response = await this.approvalBroker.request({ kind: 'tool-user-input', params })
    return response.action === 'answer'
      ? { answers: toToolUserInputAnswers(response.answers) }
      : { answers: {} }
  }

  private readonly handleElicitation = async (
    params: unknown
  ): Promise<{
    action: 'accept' | 'decline'
    content: null
    _meta: { persist: 'always' } | { persist: 'session' } | { reason: string | null } | null
  }> => {
    const response = await this.approvalBroker.request({ kind: 'mcp-elicitation', params })
    if (response.action === 'alwaysApprove') {
      return { action: 'accept' as const, content: null, _meta: { persist: 'always' } }
    }
    if (response.action === 'approveForSession') {
      return { action: 'accept' as const, content: null, _meta: { persist: 'session' } }
    }
    if (response.action === 'approve') {
      return { action: 'accept' as const, content: null, _meta: null }
    }
    return {
      action: 'decline' as const,
      content: null,
      _meta: response.action === 'decline' ? { reason: response.reason ?? null } : null
    }
  }
}

async function defaultStreamText({
  request,
  modelId,
  provider,
  abortSignal
}: {
  request: CodexChatRequest
  modelId: string
  provider: CodexProvider
  abortSignal: AbortSignal
}): Promise<StreamTextLikeResult> {
  const modelMessages = await convertToModelMessages(request.messages)
  const system = typeof request.body?.system === 'string' ? request.body.system : undefined
  const cwd = typeof request.body?.cwd === 'string' ? request.body.cwd : undefined

  return aiStreamText({
    model: provider.chat(modelId),
    messages: modelMessages,
    system,
    abortSignal,
    providerOptions: {
      ...codexCallOptions({ model: modelId, summary: 'auto', cwd })
    }
  })
}

function toToolUserInputAnswers(
  answers: Record<string, string[]>
): Record<string, { answers: string[] }> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, questionAnswers]) => [
      questionId,
      { answers: questionAnswers }
    ])
  )
}

function isAbortMessage(value: unknown): value is { type: 'abort' } {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: unknown }).type === 'abort'
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
