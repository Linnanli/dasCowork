import { app } from 'electron'
import {
  convertToModelMessages,
  streamText as aiStreamText,
  type LanguageModel,
  type UIMessageChunk
} from 'ai'
import {
  CODEX_PROVIDER_ID,
  codexCallOptions,
  type CodexCallOptions,
  type CodexLanguageModelSettings,
  type CodexModelProviderInfo,
  type CodexProvider,
  type CommandApprovalHandler,
  type FileChangeApprovalHandler
} from '@janole/ai-sdk-provider-codex-asp'

import type { AdminBackendClientModel } from './adminBackendModelClient'
import { CodexApprovalBroker, type CodexApprovalRequestInput } from './codexApprovalBroker'
import {
  resolveCodexAppServerLaunchOptions,
  type CodexAppServerLaunchOptions
} from './codexAppServerLaunch'
import { createCodexAspProvider } from './codexAspProvider'
import type { ModelCatalogService } from './modelCatalogService'
import type { ProjectStoreLike, ProjectServiceLike } from './threads/startConversation'
import {
  persistProjectAssignmentForThread,
  startConversation,
  type ConversationExecutionTarget
} from './threads/startConversation'
import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexChatRequest,
  CodexChatStreamEvent,
  CodexModel,
  CodexModelList,
  CodexStatus
} from '../shared/codexIpcApi'
import type { ThreadProjectAssignment } from '../shared/projects/projectTypes'

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
    onError?: (error: unknown) => string
  }): AsyncIterable<UIMessageChunk>
}

type StreamTextLike = (input: {
  request: CodexChatRequest
  modelId: string
  provider: CodexProvider
  abortSignal: AbortSignal
  clientModel?: AdminBackendClientModel
  executionTarget?: ConversationExecutionTarget
  resumeThreadId?: string
  onThreadStarted?: CodexCallOptions['onThreadStarted']
}) => Promise<StreamTextLikeResult> | StreamTextLikeResult

type ActiveConversationRun = {
  conversationId: string
  threadId?: string
  turnId?: string
  abortController: AbortController
}

type PendingThreadBindingAcknowledgement = {
  threadId: string
  resolve: () => void
}

const threadBindingAcknowledgementTimeoutMs = 1_000

export type ModelCatalogLike = Pick<
  ModelCatalogService,
  'listModels' | 'setSelectedModel' | 'resolveClientModel'
>

export type CodexChatRuntimeServiceOptions = {
  cwd?: string
  defaultModel?: string
  launch?: CodexAppServerLaunchOptions
  modelCatalog?: ModelCatalogLike
  projectService?: ProjectServiceLike
  projectStore?: ProjectStoreLike
  streamText?: StreamTextLike
}

export type CodexChatRunResult = {
  threadId?: string
}

export type StartedConversationThread = {
  threadId: string
  originConversationId: string
  title?: string | null
  cwd?: string | null
  createdAt?: string
  updatedAt?: string
  projectAssignment?: ThreadProjectAssignment
}

export type StartChatStreamCallbacks = {
  onThreadIdAvailable?: (threadId: string, thread?: StartedConversationThread) => void
}

export class CodexChatRuntimeService {
  private readonly approvalBroker = new CodexApprovalBroker()
  private readonly cwd: string
  private readonly provider: CodexProvider
  private readonly launch: CodexAppServerLaunchOptions
  private readonly modelCatalog: ModelCatalogLike | undefined
  private readonly projectService: ProjectServiceLike | undefined
  private readonly projectStore: ProjectStoreLike | undefined
  private readonly streamText: StreamTextLike
  private readonly activeConversationRuns = new Map<string, ActiveConversationRun>()
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
    this.projectService = options.projectService
    this.projectStore = options.projectStore
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
        if (list.models.length > 0) {
          this.selectedModelId = list.selectedModelId
        }
        return list
      } catch (error) {
        return { models: [], unavailableReason: errorMessage(error) }
      }
    }

    return this.listProviderModels()
  }

  private async listProviderModels(unavailableReason?: string): Promise<CodexModelList> {
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
      return { models: [], unavailableReason: unavailableReason ?? errorMessage(error) }
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

  async startChatStream(
    request: CodexChatRequest,
    port: CodexPortLike,
    callbacks?: StartChatStreamCallbacks
  ): Promise<CodexChatRunResult> {
    let activeRun: ActiveConversationRun
    try {
      activeRun = this.registerActiveConversationRun(request)
    } catch (error) {
      port.start()
      port.postMessage({ type: 'error', error: errorMessage(error) })
      port.close()
      return { threadId: request.body?.threadId }
    }
    let pendingThreadBindingAcknowledgement: PendingThreadBindingAcknowledgement | undefined
    const waitForThreadBindingAcknowledgement = (threadId: string): Promise<void> =>
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (pendingThreadBindingAcknowledgement?.threadId === threadId) {
            pendingThreadBindingAcknowledgement = undefined
          }
          resolve()
        }, threadBindingAcknowledgementTimeoutMs)
        pendingThreadBindingAcknowledgement = {
          threadId,
          resolve: () => {
            clearTimeout(timeout)
            pendingThreadBindingAcknowledgement = undefined
            resolve()
          }
        }
      })
    port.on('message', (event) => {
      if (isAbortMessage(event.data)) {
        activeRun.abortController.abort()
        pendingThreadBindingAcknowledgement?.resolve()
        return
      }
      if (
        isThreadBoundAcknowledgement(event.data) &&
        event.data.threadId === pendingThreadBindingAcknowledgement?.threadId
      ) {
        pendingThreadBindingAcknowledgement.resolve()
      }
    })
    port.start()

    try {
      if (this.status.state === 'stopped') {
        this.status = {
          state: 'starting',
          binary: this.launch.displayBinary
        }
      }
      const modelId = request.modelId ?? this.selectedModelId
      if (!modelId) throw new Error('No Codex model selected')
      const clientModel = this.modelCatalog
        ? await this.modelCatalog.resolveClientModel(modelId)
        : undefined
      const streamModelId = clientModel?.model_id ?? modelId
      const conversation = await startConversation({
        request,
        projectService: this.projectService
      })
      const projectAssignmentKey = request.body?.conversationId ?? request.chatId
      let normalizedProjectAssignmentThreadId: string | undefined
      let projectAssignmentQueue = Promise.resolve()
      const enqueueProjectAssignmentOperation = (
        label: string,
        operation: () => Promise<void>
      ): Promise<void> => {
        const runOperation = async (): Promise<void> => {
          try {
            await operation()
          } catch (error) {
            console.error(`failed to ${label}`, error)
          }
        }
        projectAssignmentQueue = projectAssignmentQueue.then(runOperation, runOperation)
        return projectAssignmentQueue
      }
      const persistStartedProjectAssignment = (threadId: string): Promise<void> => {
        normalizedProjectAssignmentThreadId = threadId
        return enqueueProjectAssignmentOperation(`persist project assignment for ${threadId}`, () =>
          persistProjectAssignmentForThread({
            projectStore: this.projectStore,
            threadId,
            projectAssignment: conversation.projectAssignment
          })
        )
      }
      const persistOrNormalizeProjectAssignment = (threadId: string): void => {
        const fromId = normalizedProjectAssignmentThreadId ?? projectAssignmentKey
        normalizedProjectAssignmentThreadId = threadId
        enqueueProjectAssignmentOperation(
          `normalize project assignment for ${threadId}`,
          async () => {
            await normalizeProjectAssignmentThreadId({
              projectStore: this.projectStore,
              fromId,
              toId: threadId
            })
            await persistProjectAssignmentForThread({
              projectStore: this.projectStore,
              threadId,
              projectAssignment: conversation.projectAssignment
            })
          }
        )
      }
      const onThreadStarted = request.body?.threadId
        ? undefined
        : async (thread: { threadId: string; threadPath?: string }) => {
            const startedAt = new Date().toISOString()
            const startedThread: StartedConversationThread = {
              threadId: thread.threadId,
              originConversationId: activeRun.conversationId,
              title: conversationTitleFromRequest(request),
              cwd: conversation.executionTarget?.cwd ?? null,
              createdAt: startedAt,
              updatedAt: startedAt,
              projectAssignment: conversation.projectAssignment
            }
            const threadIdChanged = this.bindActiveConversationRunAlias(activeRun, thread.threadId)
            if (threadIdChanged) {
              const acknowledgement = waitForThreadBindingAcknowledgement(thread.threadId)
              port.postMessage({ type: 'thread-bound', threadId: thread.threadId })
              await acknowledgement
            }
            await persistStartedProjectAssignment(thread.threadId)
            try {
              callbacks?.onThreadIdAvailable?.(thread.threadId, startedThread)
            } catch (error) {
              console.error(`failed to publish started thread ${thread.threadId}`, error)
            }
          }
      const result = await this.streamText({
        request,
        modelId: streamModelId,
        provider: this.provider,
        abortSignal: activeRun.abortController.signal,
        clientModel,
        executionTarget: conversation.executionTarget,
        resumeThreadId: activeRun.threadId,
        onThreadStarted
      })
      if (this.status.state !== 'stopping') {
        this.status = {
          state: 'ready',
          binary: this.launch.displayBinary,
          startedAt: this.status.startedAt ?? new Date().toISOString()
        }
      }
      let streamFailed = false
      for await (const chunk of result.toUIMessageStream({
        originalMessages: request.messages,
        sendReasoning: true,
        sendSources: true,
        onError: errorMessage
      })) {
        if (chunk.type === 'error') {
          streamFailed = true
          port.postMessage({ type: 'error', error: chunk.errorText })
          break
        }
        const threadId = extractCodexThreadId(chunk)
        const turnId = extractCodexTurnId(chunk)
        let threadIdChanged = false
        if (threadId || turnId) {
          threadIdChanged = Boolean(
            threadId && this.bindActiveConversationRunAlias(activeRun, threadId)
          )
          activeRun.turnId = turnId ?? activeRun.turnId
        }
        if (threadId && normalizedProjectAssignmentThreadId !== threadId) {
          persistOrNormalizeProjectAssignment(threadId)
        }
        if (threadIdChanged) {
          const acknowledgement = waitForThreadBindingAcknowledgement(threadId!)
          port.postMessage({ type: 'thread-bound', threadId: threadId! })
          await acknowledgement
          try {
            callbacks?.onThreadIdAvailable?.(threadId!)
          } catch (error) {
            console.error(`failed to publish thread metadata ${threadId}`, error)
          }
        }
        port.postMessage({ type: 'chunk', chunk })
      }
      await projectAssignmentQueue
      if (activeRun.abortController.signal.aborted) {
        port.postMessage({ type: 'aborted' })
      } else if (!streamFailed) {
        port.postMessage({ type: 'finish', threadId: activeRun.threadId })
      }
    } catch (error) {
      this.restoreStatusAfterTurnFailure(activeRun)
      if (activeRun.abortController.signal.aborted) {
        port.postMessage({ type: 'aborted' })
      } else {
        port.postMessage({ type: 'error', error: errorMessage(error) })
      }
    } finally {
      this.clearActiveConversationRun(activeRun)
      port.close()
    }
    return { threadId: activeRun.threadId }
  }

  interruptConversation(conversationId: string): void {
    const run = this.activeConversationRuns.get(conversationId)
    if (!run) return
    run.abortController.abort()
  }

  isConversationRunning(conversationId: string): boolean {
    return this.activeConversationRuns.has(conversationId)
  }

  async stop(): Promise<void> {
    this.status = { state: 'stopping', binary: this.launch.displayBinary }
    this.approvalBroker.rejectAll(new Error('Codex runtime is stopping'))
    for (const run of new Set(this.activeConversationRuns.values())) {
      run.abortController.abort()
    }
    await this.provider.shutdown()
    this.status = { state: 'stopped', binary: this.launch.displayBinary }
  }

  private clearActiveConversationRun(run: ActiveConversationRun): void {
    for (const [key, value] of this.activeConversationRuns.entries()) {
      if (value === run) this.activeConversationRuns.delete(key)
    }
  }

  private registerActiveConversationRun(request: CodexChatRequest): ActiveConversationRun {
    const conversationId = request.body?.conversationId ?? request.body?.threadId ?? request.chatId
    const aliases = new Set(
      [request.chatId, request.body?.conversationId, request.body?.threadId].filter(
        (value): value is string => Boolean(value)
      )
    )
    const duplicateAlias = [...aliases].find((alias) => this.activeConversationRuns.has(alias))
    if (duplicateAlias) {
      throw new Error(`Conversation already has an active turn: ${duplicateAlias}`)
    }

    const run: ActiveConversationRun = {
      conversationId,
      threadId: request.body?.threadId,
      abortController: new AbortController()
    }
    for (const alias of aliases) this.activeConversationRuns.set(alias, run)
    return run
  }

  private bindActiveConversationRunAlias(run: ActiveConversationRun, alias: string): boolean {
    if (run.threadId && run.threadId !== alias) {
      throw new Error(`Active conversation thread changed from ${run.threadId} to ${alias}`)
    }
    const existingRun = this.activeConversationRuns.get(alias)
    if (existingRun && existingRun !== run) {
      throw new Error(`Conversation already has an active turn: ${alias}`)
    }
    if (existingRun === run) {
      if (run.threadId) return false
      run.threadId = alias
      return true
    }
    const changed = !run.threadId
    run.threadId = alias
    this.activeConversationRuns.set(alias, run)
    return changed
  }

  private restoreStatusAfterTurnFailure(run: ActiveConversationRun): void {
    if (this.status.state !== 'starting') return
    const hasOtherActiveRun = [...this.activeConversationRuns.values()].some(
      (activeRun) => activeRun !== run
    )
    if (!hasOtherActiveRun) {
      this.status = { state: 'stopped', binary: this.launch.displayBinary }
    }
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
  abortSignal,
  clientModel,
  executionTarget,
  resumeThreadId,
  onThreadStarted
}: {
  request: CodexChatRequest
  modelId: string
  provider: CodexProvider
  abortSignal: AbortSignal
  clientModel?: AdminBackendClientModel
  executionTarget?: ConversationExecutionTarget
  resumeThreadId?: string
  onThreadStarted?: CodexCallOptions['onThreadStarted']
}): Promise<StreamTextLikeResult> {
  const modelMessages = await convertToModelMessages(request.messages)
  const system = typeof request.body?.system === 'string' ? request.body.system : undefined
  const model = resolveLanguageModel({ provider, modelId, clientModel })
  const providerOptions = codexCallOptions(
    codexCallOptionsInput({
      modelId,
      executionTarget,
      resumeThreadId: resumeThreadId ?? request.body?.threadId,
      onThreadStarted
    })
  )

  return aiStreamText({
    model,
    messages: modelMessages,
    system,
    abortSignal,
    ...(providerOptions ? { providerOptions } : {})
  })
}

function codexCallOptionsInput({
  modelId,
  executionTarget,
  resumeThreadId,
  onThreadStarted
}: {
  modelId: string
  executionTarget?: ConversationExecutionTarget
  resumeThreadId?: string
  onThreadStarted?: CodexCallOptions['onThreadStarted']
}): CodexCallOptions {
  return {
    model: modelId,
    summary: 'auto' as const,
    ...(resumeThreadId ? { resumeThreadId } : {}),
    ...(onThreadStarted ? { onThreadStarted } : {}),
    ...(executionTarget?.cwd ? { cwd: executionTarget.cwd } : {}),
    ...(executionTarget?.runtimeWorkspaceRoots
      ? { runtimeWorkspaceRoots: executionTarget.runtimeWorkspaceRoots }
      : {})
  }
}

function conversationTitleFromRequest(request: CodexChatRequest): string | null {
  const latestUserMessage = request.messages.findLast((message) => message.role === 'user')
  if (!latestUserMessage) return null

  const title = latestUserMessage.parts
    .map((part) => {
      if (part.type !== 'text') return ''
      return typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()

  return title ? title : null
}

async function normalizeProjectAssignmentThreadId({
  projectStore,
  fromId,
  toId
}: {
  projectStore?: ProjectStoreLike
  fromId: string
  toId: string
}): Promise<void> {
  if (!projectStore || fromId === toId) return

  const state = await projectStore.getState()
  const assignment = state.threadProjectAssignments[fromId]
  if (!assignment) return

  const threadProjectAssignments = { ...state.threadProjectAssignments }
  delete threadProjectAssignments[fromId]
  threadProjectAssignments[toId] = threadProjectAssignments[toId] ?? assignment

  await projectStore.setState({
    ...state,
    threadProjectAssignments
  })
}

function extractCodexThreadId(chunk: UIMessageChunk): string | undefined {
  if (!isRecord(chunk)) return undefined
  const providerMetadata = chunk['providerMetadata']
  if (!isRecord(providerMetadata)) return undefined
  const codexMetadata = providerMetadata[CODEX_PROVIDER_ID]
  if (!isRecord(codexMetadata)) return undefined
  const threadId = codexMetadata.threadId
  return typeof threadId === 'string' && threadId.length > 0 ? threadId : undefined
}

function extractCodexTurnId(chunk: UIMessageChunk): string | undefined {
  if (!isRecord(chunk)) return undefined
  const providerMetadata = chunk['providerMetadata']
  if (!isRecord(providerMetadata)) return undefined
  const codexMetadata = providerMetadata[CODEX_PROVIDER_ID]
  if (!isRecord(codexMetadata)) return undefined
  const turnId = codexMetadata.turnId
  return typeof turnId === 'string' && turnId.length > 0 ? turnId : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveLanguageModel({
  provider,
  modelId,
  clientModel
}: {
  provider: CodexProvider
  modelId: string
  clientModel?: AdminBackendClientModel
}): LanguageModel {
  if (!clientModel) return provider.chat(modelId)

  const apiFormat = clientModel.api_format.trim().toLowerCase()
  if (apiFormat !== 'openai') {
    throw new Error(`Unsupported admin backend model api_format: ${clientModel.api_format}`)
  }
  if (!clientModel.api_base_url?.trim()) {
    throw new Error(`Admin backend model ${clientModel.model_id} is missing api_base_url`)
  }

  return provider.chat(modelId, createCodexCustomModelSettings(clientModel))
}

function createCodexCustomModelSettings(
  clientModel: AdminBackendClientModel
): CodexLanguageModelSettings {
  const providerId = clientModel.provider
  return {
    modelProvider: providerId,
    customModelProviders: {
      [providerId]: createCodexModelProviderInfo(clientModel)
    }
  }
}

function createCodexModelProviderInfo(
  clientModel: AdminBackendClientModel
): CodexModelProviderInfo {
  const providerInfo: CodexModelProviderInfo = {
    name: clientModel.provider,
    base_url: clientModel.api_base_url?.trim(),
    wire_api: 'responses',
    requires_openai_auth: false,
    supports_websockets: false,
    request_max_retries: 0,
    stream_max_retries: 0
  }

  const apiKey = clientModel.api_key?.trim()
  if (apiKey) providerInfo.experimental_bearer_token = apiKey

  return providerInfo
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

function isThreadBoundAcknowledgement(
  value: unknown
): value is { type: 'thread-bound-ack'; threadId: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'thread-bound-ack' &&
    typeof (value as { threadId?: unknown }).threadId === 'string'
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
