import { app } from 'electron'
import { fileURLToPath } from 'node:url'
import type {
  LanguageModelV3FilePart,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart
} from '@ai-sdk/provider'
import {
  convertToModelMessages,
  streamText as aiStreamText,
  type LanguageModel,
  type UIMessageChunk
} from 'ai'
import {
  CODEX_PROVIDER_ID,
  CodexSteerError,
  codexCallOptions,
  createCodexHistoryClient,
  type CodexCallOptions,
  type CodexAgentLifecycleEvent,
  type CodexLanguageModelSettings,
  type CodexModelProviderInfo,
  type CodexProvider,
  type CodexHistoryClient,
  type CodexSession,
  type CodexSteerErrorCode,
  type CodexSteerResult,
  type CodexTurnLifecycleEvent as ProviderTurnLifecycleEvent,
  type CommandApprovalHandler,
  type FileChangeApprovalHandler
} from '@janole/ai-sdk-provider-codex-asp'

import type { AdminBackendClientModel } from './adminBackendModelClient'
import { CodexApprovalBroker, type CodexApprovalRequestInput } from './codexApprovalBroker'
import {
  resolveCodexAppServerLaunchOptions,
  type CodexAppServerLaunchOptions
} from './codexAppServerLaunch'
import { createCodexAspProvider, type CodexAspSharedConnection } from './codexAspProvider'
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
  CodexChatTerminalEvent,
  CodexTurnLifecycleEvent,
  CodexModel,
  CodexModelList,
  CodexStatus
} from '../shared/codexIpcApi'
import type { ThreadProjectAssignment } from '../shared/projects/projectTypes'
import { selectUniqueLegacyCandidate } from '../shared/uniqueLegacyCandidate'
import { restoreLocalMediaFileUrlsForModel } from './conversations/localMediaUrls'
import { validateLocalAttachmentsInLatestUserMessage } from './composerContext/localAttachmentValidation'
import {
  ConversationFollowUpQueueService,
  type FollowUpClaim,
  type FollowUpClaimFailure
} from './followUps/ConversationFollowUpQueueService'

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
    messageMetadata?: (options: { part: unknown }) => unknown
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
  startFreshTerminalRetry?: boolean
  onThreadStarted?: CodexCallOptions['onThreadStarted']
  onAgentLifecycle?: CodexCallOptions['onAgentLifecycle']
  onTurnLifecycle?: CodexCallOptions['onTurnLifecycle']
  onSessionCreated?: CodexCallOptions['onSessionCreated']
  approvals?: CodexCallOptions['approvals']
  onProviderToolCall?: (toolName: string) => void
}) => Promise<StreamTextLikeResult> | StreamTextLikeResult

type ActiveConversationRun = {
  conversationId: string
  threadId?: string
  turnId?: string
  turnOutcome?: Extract<CodexTurnLifecycleEvent, { type: 'turn-completed' }>['outcome']
  canonicalOutcomeSource?: 'notification' | 'history-reconciliation'
  session?: CodexSession
  abortController: AbortController
  streamPortDetached: boolean
  terminalDelivered: boolean
  stopRequested: boolean
  stopRequestedAt?: number
  approvalDeclinePromise?: Promise<void>
  interruptPromise?: Promise<void>
  canonicalOutcomeTimer?: ReturnType<typeof setTimeout>
  canonicalResolutionError?: string
  canonicalFailureMessage?: string
  followUpClaim?: FollowUpClaim
  followUpCompareKey?: string
  followUpAccepted: boolean
  followUpSettlement?: Promise<void>
  pendingSteerClaims: Map<string, PendingSteerClaim>
  approvalRequestIds: Set<string>
  lastLifecycleSequence?: number
  lifecycleSettlement: Promise<void>
  streamSettled: Promise<void>
  resolveStreamSettled: () => void
  settlementBlockedEvent?: CodexChatStreamEvent
}

type PendingSteerClaim = {
  claim: FollowUpClaim
  targetTurnId: string
  compareKey?: string
  requestSettled: boolean
  terminalSettled: boolean
  terminalEvent?: CodexChatStreamEvent
  accepted: boolean
  settlement?: Promise<void>
  confirmationTimer?: ReturnType<typeof setTimeout>
}

type PendingThreadBindingAcknowledgement = {
  threadId: string
  resolve: () => void
}

const threadBindingAcknowledgementTimeoutMs = 1_000
const defaultSteerConfirmationTimeoutMs = 30_000
const defaultCanonicalOutcomeTimeoutMs = 10_000
const defaultShutdownTimeoutMs = 10_000
const unknownStopOutcomeError = '停止结果无法确认，请重新打开任务检查状态'
const canonicalFailureError = '模型响应未完成，请重试。'

export type ModelCatalogLike = Pick<
  ModelCatalogService,
  'listModels' | 'setSelectedModel' | 'resolveClientModel'
>

export type CodexChatRuntimeServiceOptions = {
  cwd?: string
  defaultModel?: string
  launch?: CodexAppServerLaunchOptions
  connection?: CodexAspSharedConnection
  modelCatalog?: ModelCatalogLike
  projectService?: ProjectServiceLike
  projectStore?: ProjectStoreLike
  streamText?: StreamTextLike
  onAgentLifecycle?: (event: CodexAgentLifecycleEvent) => void | Promise<void>
  followUpQueue?: ConversationFollowUpQueueService
  steerConfirmationTimeoutMs?: number
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>
  clearScheduledTimeout?: (timer: ReturnType<typeof setTimeout>) => void
  canonicalOutcomeTimeoutMs?: number
  shutdownTimeoutMs?: number
  readCanonicalTurnOutcome?: (
    threadId: string,
    turnId: string
  ) => Promise<'completed' | 'interrupted' | 'failed' | undefined>
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
  onThreadIdAvailable?: (
    threadId: string,
    thread?: StartedConversationThread
  ) => void | Promise<void>
  onTerminal?: (terminal: CodexChatTerminalEvent) => void
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
  private readonly onAgentLifecycle: CodexCallOptions['onAgentLifecycle']
  private readonly followUpQueue: ConversationFollowUpQueueService | undefined
  private readonly steerConfirmationTimeoutMs: number
  private readonly scheduleTimeout: (
    callback: () => void,
    timeoutMs: number
  ) => ReturnType<typeof setTimeout>
  private readonly clearScheduledTimeout: (timer: ReturnType<typeof setTimeout>) => void
  private readonly canonicalOutcomeTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly readCanonicalTurnOutcome: (
    threadId: string,
    turnId: string
  ) => Promise<'completed' | 'interrupted' | 'failed' | undefined>
  private readonly activeConversationRuns = new Map<string, ActiveConversationRun>()
  private acceptingStartAdmissions = true
  private pendingStartAdmissions = 0
  private startAdmissionDrain: Promise<void> = Promise.resolve()
  private resolveStartAdmissionDrain: (() => void) | undefined
  private stopPromise: Promise<void> | undefined
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
    this.onAgentLifecycle = options.onAgentLifecycle
    this.followUpQueue = options.followUpQueue
    this.steerConfirmationTimeoutMs = Math.max(
      0,
      options.steerConfirmationTimeoutMs ?? defaultSteerConfirmationTimeoutMs
    )
    this.scheduleTimeout = options.scheduleTimeout ?? setTimeout
    this.clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout
    this.canonicalOutcomeTimeoutMs = Math.max(
      0,
      options.canonicalOutcomeTimeoutMs ?? defaultCanonicalOutcomeTimeoutMs
    )
    this.shutdownTimeoutMs = Math.max(0, options.shutdownTimeoutMs ?? defaultShutdownTimeoutMs)
    this.modelCatalog = options.modelCatalog
    this.projectService = options.projectService
    this.projectStore = options.projectStore
    const historyClient = options.connection
      ? createCodexHistoryClient({
          clientInfo: {
            name: 'dascowork_desktop_terminal_reconciliation',
            title: 'dasCowork Desktop Terminal Reconciliation',
            version: '1.0.0'
          },
          experimentalApi: true,
          transportFactory: options.connection.transportFactory
        })
      : undefined
    this.readCanonicalTurnOutcome =
      options.readCanonicalTurnOutcome ??
      ((threadId, turnId) => readTurnOutcomeFromHistory(historyClient, threadId, turnId))
    this.provider = createCodexAspProvider({
      launch: this.launch,
      cwd: this.cwd,
      defaultModel: options.defaultModel,
      connection: options.connection,
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

  onApprovalSettled(listener: (requestId: string) => void): () => void {
    return this.approvalBroker.onSettled(listener)
  }

  respondApproval(requestId: string, response: CodexApprovalResponse): void {
    void this.approvalBroker.respond(requestId, response)
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
    const releaseAdmission = this.acquireStartAdmission()
    if (!releaseAdmission) {
      const terminalEvent: CodexChatTerminalEvent = {
        type: 'error',
        error: 'Codex runtime is stopping'
      }
      port.start()
      port.postMessage(terminalEvent)
      callbacks?.onTerminal?.(terminalEvent)
      port.close()
      return { threadId: request.body?.threadId }
    }

    let effectiveRequest = request
    let claimedFollowUp: FollowUpClaim | undefined
    try {
      await this.recoverBlockedConversationRun(request)
      const prepared = await this.prepareClaimedFollowUp(request)
      effectiveRequest = prepared.request
      claimedFollowUp = prepared.claim
    } catch (error) {
      const terminalEvent: CodexChatTerminalEvent = { type: 'error', error: errorMessage(error) }
      port.start()
      port.postMessage(terminalEvent)
      callbacks?.onTerminal?.(terminalEvent)
      port.close()
      releaseAdmission()
      return { threadId: request.body?.threadId }
    }

    let activeRun: ActiveConversationRun
    let terminalEvent: CodexChatTerminalEvent | undefined
    try {
      activeRun = this.registerActiveConversationRun(effectiveRequest, claimedFollowUp)
    } catch (error) {
      await this.failPreparedFollowUp(claimedFollowUp, error)
      const terminalEvent: CodexChatTerminalEvent = { type: 'error', error: errorMessage(error) }
      port.start()
      port.postMessage(terminalEvent)
      callbacks?.onTerminal?.(terminalEvent)
      port.close()
      releaseAdmission()
      return { threadId: request.body?.threadId }
    }
    releaseAdmission()
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
        void this.requestConversationInterrupt(activeRun)
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
      const modelId = effectiveRequest.modelId ?? this.selectedModelId
      if (!modelId) throw new Error('No Codex model selected')
      const clientModel = this.modelCatalog
        ? await this.modelCatalog.resolveClientModel(modelId)
        : undefined
      const streamModelId = clientModel?.model_id ?? modelId
      const localAttachmentCount = await validateLocalAttachmentsInLatestUserMessage(
        effectiveRequest.messages
      )
      const conversation = await startConversation({
        request: effectiveRequest,
        projectService: this.projectService
      })
      if (localAttachmentCount > 0 && conversation.projectAssignment?.projectKind === 'remote') {
        throw new Error('Local attachments are not available for remote execution')
      }
      const projectAssignmentKey = effectiveRequest.body?.conversationId ?? effectiveRequest.chatId
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
      const startsFreshTerminalRetry = shouldStartFreshTerminalRetry(effectiveRequest)
      const onThreadStarted = effectiveRequest.body?.threadId && !startsFreshTerminalRetry
        ? undefined
        : async (thread: { threadId: string; threadPath?: string }) => {
            const startedAt = new Date().toISOString()
            const startedThread: StartedConversationThread = {
              threadId: thread.threadId,
              originConversationId: activeRun.conversationId,
              title: conversationTitleFromRequest(effectiveRequest),
              cwd: conversation.executionTarget?.cwd ?? null,
              createdAt: startedAt,
              updatedAt: startedAt,
              projectAssignment: conversation.projectAssignment
            }
            const threadIdChanged = this.bindActiveConversationRunAlias(
              activeRun,
              thread.threadId,
              startsFreshTerminalRetry
            )
            if (startsFreshTerminalRetry) persistOrNormalizeProjectAssignment(thread.threadId)
            else await persistStartedProjectAssignment(thread.threadId)
            await callbacks?.onThreadIdAvailable?.(thread.threadId, startedThread)
            this.migrateActiveFollowUpClaims(activeRun, thread.threadId)
            if (threadIdChanged) {
              if (
                this.postStreamEvent(activeRun, port, {
                  type: 'thread-bound',
                  threadId: thread.threadId
                })
              ) {
                await waitForThreadBindingAcknowledgement(thread.threadId)
              }
            }
          }
      const modelInputRequest = {
        ...effectiveRequest,
        messages: restoreLocalMediaFileUrlsForModel(effectiveRequest.messages)
      }
      const onTurnLifecycle = (event: ProviderTurnLifecycleEvent): Promise<void> => {
        if (activeRun.terminalDelivered) return Promise.resolve()
        activeRun.lifecycleSettlement = activeRun.lifecycleSettlement
          .then(async () => {
            if (!this.acceptTurnLifecycle(activeRun, event)) return
            this.postStreamEvent(activeRun, port, {
              type: 'turn-lifecycle',
              // Failure details remain main-process-only until sanitized for the
              // terminal error; lifecycle notifications only carry state.
              event: turnLifecycleEventForRenderer(event)
            })
            await this.observeAcceptedTurnLifecycle(activeRun, event)
          })
          .catch((error) => {
            console.warn('failed to settle turn lifecycle event', error)
          })
        return activeRun.lifecycleSettlement
      }
      const result = await this.streamText({
        request: modelInputRequest,
        modelId: streamModelId,
        provider: this.provider,
        abortSignal: activeRun.abortController.signal,
        clientModel,
        executionTarget: conversation.executionTarget,
        resumeThreadId: startsFreshTerminalRetry ? undefined : activeRun.threadId,
        startFreshTerminalRetry: startsFreshTerminalRetry,
        onThreadStarted,
        onAgentLifecycle: this.onAgentLifecycle,
        onTurnLifecycle,
        approvals: this.createRunApprovalHandlers(activeRun),
        onSessionCreated: (session) => {
          if (activeRun.terminalDelivered) return
          activeRun.session = session
          activeRun.turnId = session.turnId ?? activeRun.turnId
          this.bindActiveConversationRunAlias(activeRun, session.threadId)
          if (activeRun.stopRequested) void this.requestConversationInterrupt(activeRun)
        }
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
        originalMessages: effectiveRequest.messages,
        sendReasoning: true,
        sendSources: true,
        messageMetadata: ({ part }) =>
          codexTurnDurationMessageMetadata(isRecord(part) ? part['providerMetadata'] : undefined),
        onError: errorMessage
      })) {
        if (chunk.type === 'error') {
          streamFailed = true
          terminalEvent = { type: 'error', error: chunk.errorText }
          break
        }
        const threadId = extractCodexThreadId(chunk)
        const turnId = extractCodexTurnId(chunk)
        let threadIdChanged = false
        if (threadId || turnId) {
          if (activeRun.threadId && threadId && activeRun.threadId !== threadId) {
            throw new Error(
              `Active conversation thread changed from ${activeRun.threadId} to ${threadId}`
            )
          }
          if (activeRun.turnId && turnId && activeRun.turnId !== turnId) {
            continue
          }
          threadIdChanged = Boolean(
            threadId && this.bindActiveConversationRunAlias(activeRun, threadId)
          )
          activeRun.turnId = turnId ?? activeRun.turnId
        }
        if (threadId && normalizedProjectAssignmentThreadId !== threadId) {
          persistOrNormalizeProjectAssignment(threadId)
        }
        if (threadIdChanged) {
          await callbacks?.onThreadIdAvailable?.(threadId!)
          if (
            this.postStreamEvent(activeRun, port, { type: 'thread-bound', threadId: threadId! })
          ) {
            await waitForThreadBindingAcknowledgement(threadId!)
          }
        }
        this.postStreamEvent(activeRun, port, { type: 'chunk', chunk })
      }
      await projectAssignmentQueue
      await activeRun.lifecycleSettlement
      terminalEvent = this.canonicalTerminalForRun(
        activeRun,
        streamFailed ? terminalEvent : undefined
      )
    } catch (error) {
      this.restoreStatusAfterTurnFailure(activeRun)
      await activeRun.lifecycleSettlement
      terminalEvent = this.canonicalTerminalForRun(activeRun, {
        type: 'error',
        error: errorMessage(error)
      })
    } finally {
      if (terminalEvent?.type !== 'finish') {
        this.rejectRunApprovals(activeRun, 'The task ended before approval was completed.')
      }
      await activeRun.lifecycleSettlement
      try {
        await this.settleRunFollowUps(activeRun, terminalEvent)
        this.clearActiveConversationRun(activeRun)
      } catch (error) {
        console.error('failed to durably settle follow-up state before terminal event', error)
        activeRun.settlementBlockedEvent = terminalEvent
        terminalEvent = {
          type: 'error',
          error:
            'The task ended, but follow-up state could not be saved. Retry this conversation to recover it.'
        }
      }
      try {
        if (terminalEvent && !activeRun.terminalDelivered) {
          activeRun.terminalDelivered = true
          this.postStreamEvent(activeRun, port, terminalEvent)
          callbacks?.onTerminal?.(terminalEvent)
        }
      } finally {
        try {
          port.close()
        } finally {
          activeRun.resolveStreamSettled()
        }
      }
    }
    return { threadId: activeRun.threadId }
  }

  private acquireStartAdmission(): (() => void) | undefined {
    if (!this.acceptingStartAdmissions) return undefined

    if (this.pendingStartAdmissions === 0) {
      this.startAdmissionDrain = new Promise((resolve) => {
        this.resolveStartAdmissionDrain = resolve
      })
    }
    this.pendingStartAdmissions += 1

    let released = false
    return () => {
      if (released) return
      released = true
      this.pendingStartAdmissions -= 1
      if (this.pendingStartAdmissions === 0) {
        this.resolveStartAdmissionDrain?.()
        this.resolveStartAdmissionDrain = undefined
      }
    }
  }

  private closeStartAdmissions(): Promise<void> {
    this.acceptingStartAdmissions = false
    return this.pendingStartAdmissions === 0 ? Promise.resolve() : this.startAdmissionDrain
  }

  interruptConversation(conversationId: string): void {
    const run = this.activeRunForConversation(conversationId)
    if (!run) return
    void this.requestConversationInterrupt(run)
  }

  /**
   * The MessagePort is only a data channel. Its unexpected loss must not turn
   * into a user cancellation. A reloaded renderer waits for this run to
   * settle, then reopens the canonical app-server history.
   */
  handleChatStreamPortClosed(conversationId: string): void {
    const run = this.activeRunForConversation(conversationId)
    if (!run || run.terminalDelivered) return
    this.detachStreamPort(run)
  }

  private detachStreamPort(run: ActiveConversationRun): void {
    if (run.streamPortDetached) return
    run.streamPortDetached = true
    void this.declineRunApprovals(run, 'The chat UI disconnected before approval was completed.')
  }

  private postStreamEvent(
    run: ActiveConversationRun,
    port: CodexPortLike,
    event: CodexChatStreamEvent
  ): boolean {
    if (run.streamPortDetached) return false
    try {
      port.postMessage(event)
      return true
    } catch (error) {
      this.detachStreamPort(run)
      console.warn('chat stream MessagePort detached before event delivery', error)
      return false
    }
  }

  private requestConversationInterrupt(run: ActiveConversationRun): Promise<void> {
    if (!run.stopRequested) {
      run.stopRequested = true
      run.stopRequestedAt = Date.now()
      run.approvalDeclinePromise = this.declineRunApprovals(
        run,
        'The task was stopped before approval was completed.'
      )
    }
    if (run.interruptPromise) return run.interruptPromise
    if (!run.session || !run.threadId || !run.turnId) return Promise.resolve()

    run.interruptPromise = (async () => {
      await run.approvalDeclinePromise
      try {
        await run.session?.interrupt()
      } catch (error) {
        console.warn('turn/interrupt did not settle cleanly; reconciling terminal outcome', error)
      } finally {
        this.scheduleCanonicalReconciliation(run)
      }
    })()
    return run.interruptPromise
  }

  private scheduleCanonicalReconciliation(run: ActiveConversationRun): void {
    if (
      run.turnOutcome ||
      run.terminalDelivered ||
      run.canonicalOutcomeTimer !== undefined ||
      !run.threadId ||
      !run.turnId
    ) {
      return
    }
    run.canonicalOutcomeTimer = this.scheduleTimeout(() => {
      run.canonicalOutcomeTimer = undefined
      void this.reconcileCanonicalOutcome(run)
    }, this.canonicalOutcomeTimeoutMs)
  }

  private async reconcileCanonicalOutcome(run: ActiveConversationRun): Promise<void> {
    if (run.turnOutcome || run.terminalDelivered || !run.threadId || !run.turnId) return

    let outcome: ActiveConversationRun['turnOutcome']
    try {
      outcome = await this.readCanonicalTurnOutcome(run.threadId, run.turnId)
    } catch (error) {
      console.warn('failed to reconcile stopped turn outcome', error)
    }

    if (outcome) {
      this.setCanonicalOutcome(run, outcome, 'history-reconciliation')
    } else if (!run.canonicalResolutionError) {
      run.canonicalResolutionError = unknownStopOutcomeError
    }

    // The UI/control-plane decision has been made from authoritative history
    // (or an explicit unknown error). Abort only now to release a provider
    // stream whose matching notification was lost.
    run.abortController.abort()
  }

  private setCanonicalOutcome(
    run: ActiveConversationRun,
    outcome: NonNullable<ActiveConversationRun['turnOutcome']>,
    source: NonNullable<ActiveConversationRun['canonicalOutcomeSource']>
  ): void {
    if (run.turnOutcome) return
    run.turnOutcome = outcome
    run.canonicalOutcomeSource = source
    if (run.canonicalOutcomeTimer !== undefined) {
      this.clearScheduledTimeout(run.canonicalOutcomeTimer)
      run.canonicalOutcomeTimer = undefined
    }
  }

  private canonicalTerminalForRun(
    run: ActiveConversationRun,
    fallback: CodexChatTerminalEvent | undefined
  ): CodexChatTerminalEvent {
    if (run.canonicalResolutionError) {
      return { type: 'error', error: run.canonicalResolutionError }
    }
    switch (run.turnOutcome) {
      case 'completed':
        return { type: 'finish', threadId: run.threadId }
      case 'interrupted':
        return { type: 'aborted' }
      case 'failed':
        // The app-server's canonical outcome decides that this is a failure,
        // while the provider stream may carry the safe, user-facing upstream
        // failure detail (for example a model quota response). Keep that
        // detail without allowing the local stream to classify the outcome.
        if (run.canonicalFailureMessage) {
          return { type: 'error', error: run.canonicalFailureMessage }
        }
        if (fallback?.type === 'error') return fallback
        return { type: 'error', error: canonicalFailureError }
      default:
        break
    }
    if (run.stopRequested) {
      return { type: 'error', error: unknownStopOutcomeError }
    }
    if (fallback?.type === 'error') return fallback
    return { type: 'error', error: canonicalFailureError }
  }

  async steerConversation(
    conversationId: string,
    message: CodexChatRequest['messages'][number],
    clientUserMessageId: string
  ): Promise<CodexSteerResult> {
    const run = this.activeRunForConversation(conversationId)
    if (!run?.session?.isActive()) {
      throw new CodexSteerError(
        'session_inactive',
        'Conversation does not have a steerable active turn'
      )
    }

    const prompt = userMessageToLanguageModelV3Prompt(
      restoreLocalMediaFileUrlsForModel([message])[0] ?? message
    )
    return run.session.steerPrompt(prompt, { clientUserMessageId })
  }

  async steerClaimedFollowUp(
    claim: FollowUpClaim,
    message: CodexChatRequest['messages'][number]
  ): Promise<CodexSteerResult> {
    const run = this.activeRunForConversation(claim.conversationKey)
    if (!run?.session?.isActive() || !run.turnId) {
      const error = new CodexSteerError(
        'session_inactive',
        'Conversation does not have a steerable active turn'
      )
      await this.followUpQueue?.failClaim(
        claim.conversationKey,
        claim.item.id,
        claim.leaseToken,
        steerFailureDisposition(error)
      )
      throw error
    }
    const existingPending = run.pendingSteerClaims.get(message.id)
    if (existingPending) {
      const error = new Error(`Follow-up steer is already pending acknowledgement: ${message.id}`)
      if (existingPending.claim.leaseToken !== claim.leaseToken) {
        await this.followUpQueue?.failClaim(
          claim.conversationKey,
          claim.item.id,
          claim.leaseToken,
          steerFailureDisposition(error)
        )
      }
      throw error
    }

    const pending: PendingSteerClaim = {
      claim,
      targetTurnId: run.turnId,
      requestSettled: false,
      terminalSettled: false,
      accepted: false
    }
    run.pendingSteerClaims.set(message.id, pending)

    try {
      pending.compareKey = steeringCompareKey(
        restoreLocalMediaFileUrlsForModel([message])[0] ?? message
      )
      const result = await this.steerConversation(claim.conversationKey, message, message.id)
      pending.targetTurnId = result.turnId
      pending.requestSettled = true
      if (pending.terminalSettled) {
        throw new CodexSteerError(
          'steer_result_unknown',
          'The task ended before the steer result could be confirmed'
        )
      }
      this.scheduleSteerConfirmation(run, pending)
      return result
    } catch (error) {
      pending.requestSettled = true
      await run.lifecycleSettlement
      if (pending.terminalSettled) {
        if (!pending.accepted) {
          await this.failPendingSteerClaim(
            run,
            pending,
            isCodexSteerError(error) && error.code === 'steer_result_unknown'
              ? terminalSteerFailureDisposition(pending.terminalEvent, true)
              : steerFailureDisposition(error)
          )
        } else {
          await pending.settlement
        }
        throw error
      }
      if (pending.accepted) return { turnId: pending.targetTurnId }
      if (isCodexSteerError(error) && error.code === 'steer_result_unknown') {
        return { turnId: pending.targetTurnId }
      }
      await this.failPendingSteerClaim(run, pending, steerFailureDisposition(error))
      throw error
    }
  }

  isConversationRunning(conversationId: string): boolean {
    return Boolean(this.activeRunForConversation(conversationId))
  }

  /**
   * Wait for the currently active turn for this conversation (or any of its
   * local/thread aliases) to reach a terminal state.  A renderer reconnecting
   * after a reload must read history only after this resolves; otherwise it
   * can permanently hydrate an incomplete in-flight transcript.
   */
  waitForConversationSettlement(conversationId: string): Promise<void> {
    return this.activeRunForConversation(conversationId)?.streamSettled ?? Promise.resolve()
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopInternal()
    return this.stopPromise
  }

  private async stopInternal(): Promise<void> {
    this.status = { state: 'stopping', binary: this.launch.displayBinary }
    await this.closeStartAdmissions()
    const activeRuns = [...new Set(this.activeConversationRuns.values())]
    await Promise.all(activeRuns.map((run) => this.settleRunForShutdown(run)))
    this.approvalBroker.rejectAll(new Error('Codex runtime is stopping'))
    await this.provider.shutdown()
    this.status = { state: 'stopped', binary: this.launch.displayBinary }
  }

  private async settleRunForShutdown(run: ActiveConversationRun): Promise<void> {
    const interrupt = this.requestConversationInterrupt(run)
    void interrupt.then(
      () => void this.reconcileCanonicalOutcome(run),
      () => undefined
    )

    if (await this.waitForRunSettlement(run)) return

    if (run.canonicalOutcomeTimer !== undefined) {
      this.clearScheduledTimeout(run.canonicalOutcomeTimer)
      run.canonicalOutcomeTimer = undefined
    }
    run.abortController.abort()
    this.rejectRunApprovals(run, 'Codex runtime shutdown timed out before approval was completed.')
    await this.forceReleaseFollowUpStateAfterShutdownTimeout(run)
    run.terminalDelivered = true
    this.clearActiveConversationRun(run)
    run.resolveStreamSettled()
  }

  /**
   * A local shutdown timeout cannot leave a delivery lease live.  We no longer
   * know whether an in-flight steer reached the server, so preserve it as a
   * paused recovery-uncertain item instead of retrying it or silently dropping
   * it.  This is deliberately separate from normal terminal settlement: the
   * latter can still wait for canonical lifecycle evidence.
   */
  private async forceReleaseFollowUpStateAfterShutdownTimeout(
    run: ActiveConversationRun
  ): Promise<void> {
    const terminalEvent: CodexChatStreamEvent = {
      type: 'error',
      error: 'Codex runtime shutdown timed out before delivery could be confirmed.'
    }

    try {
      const claim = run.followUpClaim
      if (claim && this.followUpQueue) {
        if (run.followUpAccepted) {
          await this.settleAcceptedFollowUp(run)
        } else {
          await this.followUpQueue.failClaim(
            claim.conversationKey,
            claim.item.id,
            claim.leaseToken,
            {
              status: 'paused-recovery-uncertain',
              kind: 'recovery-uncertain',
              userMessage: terminalEvent.error
            }
          )
        }
      }
      await Promise.all(
        [...run.pendingSteerClaims.values()].map(async (pending) => {
          pending.terminalSettled = true
          pending.terminalEvent = terminalEvent
          if (pending.accepted) {
            await this.settleAcceptedPendingSteerClaim(run, pending)
            return
          }
          await this.failPendingSteerClaim(run, pending, {
            status: 'paused-recovery-uncertain',
            kind: 'recovery-uncertain',
            userMessage: 'The application closed before the steer delivery could be confirmed.'
          })
        })
      )
    } catch (error) {
      // The durable store can be unavailable while Electron is exiting.  Clear
      // all local leases and timers anyway; the persisted item remains for the
      // queue store's normal recovery path rather than being sent again here.
      console.warn('failed to settle follow-up state before forced runtime shutdown', error)
    } finally {
      for (const pending of run.pendingSteerClaims.values()) {
        this.clearSteerConfirmation(pending)
      }
      run.pendingSteerClaims.clear()
      run.followUpClaim = undefined
      run.followUpSettlement = undefined
    }
  }

  private waitForRunSettlement(run: ActiveConversationRun): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const timer = this.scheduleTimeout(() => {
        if (settled) return
        settled = true
        resolve(false)
      }, this.shutdownTimeoutMs)
      void run.streamSettled.then(() => {
        if (settled) return
        settled = true
        this.clearScheduledTimeout(timer)
        resolve(true)
      })
    })
  }

  private clearActiveConversationRun(run: ActiveConversationRun): void {
    for (const [key, value] of this.activeConversationRuns.entries()) {
      if (value === run) this.activeConversationRuns.delete(key)
    }
  }

  /**
   * Renderer reloads address a conversation by the thread id returned from
   * history. The alias map is an index, while the run itself owns the
   * canonical identities; consult both before allowing history to hydrate.
   */
  private activeRunForConversation(conversationId: string): ActiveConversationRun | undefined {
    const indexed = this.activeConversationRuns.get(conversationId)
    if (indexed) return indexed

    return [...new Set(this.activeConversationRuns.values())].find(
      (run) => run.conversationId === conversationId || run.threadId === conversationId
    )
  }

  private async recoverBlockedConversationRun(request: CodexChatRequest): Promise<void> {
    const aliases = [request.chatId, request.body?.conversationId, request.body?.threadId].filter(
      (value): value is string => Boolean(value)
    )
    const blockedRuns = new Set(
      aliases
        .map((alias) => this.activeConversationRuns.get(alias))
        .filter((run): run is ActiveConversationRun => Boolean(run?.settlementBlockedEvent))
    )

    for (const run of blockedRuns) {
      const terminalEvent = run.settlementBlockedEvent
      if (!terminalEvent) continue
      try {
        await this.settleRunFollowUps(run, terminalEvent)
      } catch (error) {
        throw new Error(
          `Follow-up state for ${run.conversationId} is still recovering: ${errorMessage(error)}`
        )
      }
      run.settlementBlockedEvent = undefined
      this.clearActiveConversationRun(run)
    }
  }

  private registerActiveConversationRun(
    request: CodexChatRequest,
    followUpClaim?: FollowUpClaim
  ): ActiveConversationRun {
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

    let resolveStreamSettled!: () => void
    const streamSettled = new Promise<void>((resolve) => {
      resolveStreamSettled = resolve
    })
    const run: ActiveConversationRun = {
      conversationId,
      threadId: request.body?.threadId,
      abortController: new AbortController(),
      streamPortDetached: false,
      terminalDelivered: false,
      stopRequested: false,
      followUpClaim,
      followUpCompareKey: followUpClaim
        ? compareKeyForClaimedMessage(request, followUpClaim.item.id)
        : undefined,
      followUpAccepted: false,
      pendingSteerClaims: new Map(),
      approvalRequestIds: new Set(),
      lifecycleSettlement: Promise.resolve(),
      streamSettled,
      resolveStreamSettled
    }
    for (const alias of aliases) this.activeConversationRuns.set(alias, run)
    return run
  }

  private async prepareClaimedFollowUp(request: CodexChatRequest): Promise<{
    request: CodexChatRequest
    claim?: FollowUpClaim
  }> {
    const followUpRequest = request.body?.followUpRequest
    if (!followUpRequest) return { request }
    if (!this.followUpQueue) throw new Error('Follow-up queue is not available')

    const activeConversationKey =
      request.body?.threadId ?? request.body?.conversationId ?? request.chatId
    if (followUpRequest.conversationKey !== activeConversationKey) {
      throw new Error('Follow-up request does not belong to the active conversation')
    }

    const claim = await this.followUpQueue.claimHead(
      followUpRequest.conversationKey,
      'turn-start',
      followUpRequest.itemId,
      'runtime'
    )
    let message: Awaited<ReturnType<ConversationFollowUpQueueService['materializeClaimMessage']>>
    try {
      message = await this.followUpQueue.materializeClaimMessage(claim)
    } catch (error) {
      await this.followUpQueue
        .failClaim(claim.conversationKey, claim.item.id, claim.leaseToken, {
          kind: 'attachment-unavailable',
          userMessage: errorMessage(error)
        })
        .catch((settlementError) =>
          console.warn('failed to release invalid follow-up delivery lease', settlementError)
        )
      throw error
    }
    const userMessage: CodexChatRequest['messages'][number] = {
      id: message.id,
      role: 'user',
      parts: message.parts
    }
    const previousMessages = request.messages.filter((candidate) => candidate.id !== message.id)

    return {
      claim,
      request: {
        ...request,
        messageId: message.id,
        messages: [...previousMessages, userMessage],
        body: {
          ...request.body,
          followUpRequest
        }
      }
    }
  }

  private acceptClaimedFollowUp(run: ActiveConversationRun): void {
    const claim = run.followUpClaim
    if (!claim || run.followUpAccepted || !this.followUpQueue) return
    run.followUpAccepted = true
    void this.settleAcceptedFollowUp(run).catch(() => undefined)
  }

  private settleAcceptedFollowUp(run: ActiveConversationRun): Promise<void> {
    if (run.followUpSettlement) return run.followUpSettlement
    const claim = run.followUpClaim
    if (!claim || !this.followUpQueue) return Promise.resolve()

    const settlementTask = (async (): Promise<void> => {
      try {
        await this.followUpQueue?.commitClaim(
          claim.conversationKey,
          claim.item.id,
          claim.leaseToken
        )
      } catch (commitError) {
        console.warn('failed to commit accepted follow-up delivery', commitError)
        try {
          await this.followUpQueue?.failClaim(
            claim.conversationKey,
            claim.item.id,
            claim.leaseToken,
            {
              status: 'paused-recovery-uncertain',
              kind: 'recovery-uncertain',
              userMessage:
                'The follow-up was accepted, but its local queue record could not be finalized.'
            }
          )
        } catch (fallbackError) {
          throw new AggregateError(
            [commitError, fallbackError],
            'Accepted follow-up queue settlement failed'
          )
        }
      }
    })()
    const trackedSettlement = settlementTask.catch((error) => {
      if (run.followUpSettlement === trackedSettlement) {
        run.followUpSettlement = undefined
      }
      throw error
    })
    run.followUpSettlement = trackedSettlement
    void trackedSettlement.catch(() => undefined)
    return trackedSettlement
  }

  private acceptTurnLifecycle(
    run: ActiveConversationRun,
    event: ProviderTurnLifecycleEvent
  ): boolean {
    if (run.terminalDelivered) return false
    if (run.threadId && run.threadId !== event.threadId) return false

    if (event.type === 'turn-started') {
      if (run.turnId && run.turnId !== event.turnId) return false
      if (run.lastLifecycleSequence !== undefined && event.sequence <= run.lastLifecycleSequence) {
        return false
      }
      if (!run.threadId) this.bindActiveConversationRunAlias(run, event.threadId)
      run.turnId = event.turnId
      run.lastLifecycleSequence = event.sequence
      return true
    }

    if (!run.threadId || !run.turnId || run.turnId !== event.turnId) return false
    if (run.lastLifecycleSequence !== undefined && event.sequence <= run.lastLifecycleSequence) {
      return false
    }
    run.lastLifecycleSequence = event.sequence
    return true
  }

  private async observeAcceptedTurnLifecycle(
    run: ActiveConversationRun,
    event: ProviderTurnLifecycleEvent
  ): Promise<void> {
    if (event.type === 'turn-started') {
      if (run.stopRequested) void this.requestConversationInterrupt(run)
      return
    }

    if (
      event.type === 'item-completed' &&
      event.itemType === 'userMessage' &&
      (event.clientUserMessageId || event.compareKey)
    ) {
      const followUpIdentityMatches = event.clientUserMessageId
        ? run.followUpClaim?.item.id === event.clientUserMessageId
        : Boolean(event.compareKey && run.followUpCompareKey === event.compareKey)
      if (followUpIdentityMatches) {
        this.acceptClaimedFollowUp(run)
      }
      this.acceptPendingSteerClaim(run, event.clientUserMessageId, event.compareKey)
      return
    }

    if (event.type === 'turn-completed') {
      const providerFailureDetail = providerTurnFailureDetail(event)
      if (event.outcome === 'failed' && providerFailureDetail) {
        run.canonicalFailureMessage = sanitizeUserFacingError(providerFailureDetail)
      }
      this.setCanonicalOutcome(run, event.outcome, 'notification')
      await this.rejectUnacceptedSteerClaims(run, event.turnId, event.outcome)
    }
  }

  private acceptPendingSteerClaim(
    run: ActiveConversationRun,
    clientUserMessageId: string | undefined,
    compareKey: string | undefined
  ): void {
    let pending = clientUserMessageId ? run.pendingSteerClaims.get(clientUserMessageId) : undefined
    if (!clientUserMessageId && compareKey !== undefined) {
      const selection = selectUniqueLegacyCandidate(
        [...run.pendingSteerClaims.values()],
        (candidate) =>
          !candidate.accepted && !candidate.settlement && candidate.compareKey === compareKey
      )
      pending = selection.candidate
      if (selection.matchingCandidates.length > 1) {
        console.warn('ambiguous legacy steer acknowledgement ignored', {
          turnId: run.turnId,
          candidateCount: selection.matchingCandidates.length,
          messageIds: selection.matchingCandidates.map((candidate) => candidate.claim.item.id)
        })
      }
    }
    if (!pending || pending.accepted || pending.settlement || !this.followUpQueue) return
    pending.accepted = true
    this.clearSteerConfirmation(pending)
    void this.settleAcceptedPendingSteerClaim(run, pending).catch(() => undefined)
  }

  private scheduleSteerConfirmation(run: ActiveConversationRun, pending: PendingSteerClaim): void {
    if (pending.accepted || pending.settlement || pending.confirmationTimer !== undefined) return
    pending.confirmationTimer = this.scheduleTimeout(() => {
      pending.confirmationTimer = undefined
      run.lifecycleSettlement = run.lifecycleSettlement
        .then(async () => {
          if (pending.accepted || pending.settlement || !pending.requestSettled) return
          await this.failPendingSteerClaim(run, pending, {
            status: 'paused-recovery-uncertain',
            kind: 'recovery-uncertain',
            userMessage: 'The steer result was not confirmed and was not sent again.'
          })
        })
        .catch((error) => {
          console.warn('failed to settle unconfirmed steer delivery', error)
        })
    }, this.steerConfirmationTimeoutMs)
  }

  private clearSteerConfirmation(pending: PendingSteerClaim): void {
    if (pending.confirmationTimer === undefined) return
    this.clearScheduledTimeout(pending.confirmationTimer)
    pending.confirmationTimer = undefined
  }

  private settleAcceptedPendingSteerClaim(
    run: ActiveConversationRun,
    pending: PendingSteerClaim
  ): Promise<void> {
    if (pending.settlement) return pending.settlement
    if (!this.followUpQueue) return Promise.resolve()
    this.clearSteerConfirmation(pending)

    const settlementTask = (async (): Promise<void> => {
      try {
        await this.followUpQueue?.acknowledgeClaim?.(
          pending.claim.conversationKey,
          pending.claim.item.id,
          pending.claim.leaseToken
        )
        await this.followUpQueue?.commitClaim(
          pending.claim.conversationKey,
          pending.claim.item.id,
          pending.claim.leaseToken
        )
      } catch (commitError) {
        console.warn('failed to commit acknowledged steer delivery', commitError)
        try {
          await this.followUpQueue?.failClaim(
            pending.claim.conversationKey,
            pending.claim.item.id,
            pending.claim.leaseToken,
            {
              status: 'paused-recovery-uncertain',
              kind: 'recovery-uncertain',
              userMessage:
                'The steer was acknowledged, but its local queue record could not be finalized.'
            }
          )
        } catch (fallbackError) {
          throw new AggregateError(
            [commitError, fallbackError],
            'Acknowledged steer queue settlement failed'
          )
        }
      }
      run.pendingSteerClaims.delete(pending.claim.item.id)
    })()
    const trackedSettlement = settlementTask.catch((error) => {
      if (pending.settlement === trackedSettlement) {
        pending.settlement = undefined
      }
      throw error
    })
    pending.settlement = trackedSettlement
    void trackedSettlement.catch(() => undefined)
    return trackedSettlement
  }

  private async rejectUnacceptedSteerClaims(
    run: ActiveConversationRun,
    turnId: string,
    outcome: Extract<CodexTurnLifecycleEvent, { type: 'turn-completed' }>['outcome']
  ): Promise<void> {
    const pendingClaims = [...run.pendingSteerClaims.values()].filter(
      (pending) => pending.requestSettled && pending.targetTurnId === turnId && !pending.accepted
    )
    if (pendingClaims.length === 0 || !this.followUpQueue) return

    await Promise.all(
      pendingClaims.map((pending) =>
        this.failPendingSteerClaim(run, pending, {
          status: 'paused-recovery-uncertain',
          kind: 'recovery-uncertain',
          userMessage:
            outcome === 'interrupted'
              ? 'The task stopped before the steer result could be confirmed.'
              : 'The task ended before the steer result could be confirmed.'
        })
      )
    )
  }

  private async settlePendingSteerClaims(
    run: ActiveConversationRun,
    terminalEvent: CodexChatStreamEvent | undefined
  ): Promise<void> {
    const claims = [...run.pendingSteerClaims.values()]
    if (claims.length === 0) return

    await Promise.all(
      claims.map(async (pending) => {
        if (pending.accepted) {
          await this.settleAcceptedPendingSteerClaim(run, pending)
          return
        }
        if (!pending.requestSettled) {
          if (!pending.terminalSettled) {
            pending.terminalSettled = true
            pending.terminalEvent = terminalEvent
          }
          return
        }
        await this.failPendingSteerClaim(
          run,
          pending,
          terminalSteerFailureDisposition(terminalEvent, pending.terminalSettled)
        )
      })
    )
  }

  private async failPendingSteerClaim(
    run: ActiveConversationRun,
    pending: PendingSteerClaim,
    disposition: FollowUpClaimFailure
  ): Promise<void> {
    if (pending.accepted) {
      await this.settleAcceptedPendingSteerClaim(run, pending)
      return
    }
    if (pending.settlement) {
      await pending.settlement
      return
    }

    if (!this.followUpQueue) return
    this.clearSteerConfirmation(pending)
    pending.settlement = this.followUpQueue
      .failClaim(
        pending.claim.conversationKey,
        pending.claim.item.id,
        pending.claim.leaseToken,
        disposition
      )
      .then(() => {
        run.pendingSteerClaims.delete(pending.claim.item.id)
      })
      .catch((error) => {
        pending.settlement = undefined
        throw error
      })
    await pending.settlement
  }

  private async settleClaimedFollowUp(
    run: ActiveConversationRun,
    terminalEvent: CodexChatStreamEvent | undefined
  ): Promise<void> {
    const claim = run.followUpClaim
    if (!claim || !this.followUpQueue) return
    if (run.followUpAccepted) {
      await this.settleAcceptedFollowUp(run)
      return
    }

    let disposition: FollowUpClaimFailure = {
      status: 'paused-failed',
      kind: 'send-failed',
      userMessage: 'The queued follow-up could not be confirmed.'
    }
    if (terminalEvent?.type === 'aborted') {
      disposition = {
        status: 'paused-recovery-uncertain',
        kind: 'recovery-uncertain',
        userMessage: 'The task stopped before queued delivery acceptance could be confirmed.'
      }
    } else if (terminalEvent?.type === 'error') {
      disposition = {
        status: 'paused-failed',
        kind: 'send-failed',
        userMessage: terminalEvent.error
      }
    }
    await this.followUpQueue.failClaim(
      claim.conversationKey,
      claim.item.id,
      claim.leaseToken,
      disposition
    )
  }

  private async settleRunFollowUps(
    run: ActiveConversationRun,
    terminalEvent: CodexChatStreamEvent | undefined
  ): Promise<void> {
    const settlements = [
      this.settlePendingSteerClaims(run, terminalEvent),
      this.settleClaimedFollowUp(run, terminalEvent)
    ]
    if (run.stopRequested && run.turnOutcome === 'interrupted') {
      settlements.push(this.pauseFollowUpsAfterInterrupt(run))
    }

    const results = await Promise.allSettled(settlements)
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Follow-up queue settlement failed')
    }
  }

  private async failPreparedFollowUp(
    claim: FollowUpClaim | undefined,
    error: unknown
  ): Promise<void> {
    if (!claim || !this.followUpQueue) return
    await this.followUpQueue
      .failClaim(claim.conversationKey, claim.item.id, claim.leaseToken, {
        kind: 'send-failed',
        userMessage: errorMessage(error)
      })
      .catch((settlementError) =>
        console.warn('failed to release rejected follow-up delivery lease', settlementError)
      )
  }

  private async pauseFollowUpsAfterInterrupt(run: ActiveConversationRun): Promise<void> {
    if (!this.followUpQueue) return
    const conversationKey = run.followUpClaim?.conversationKey ?? run.threadId ?? run.conversationId
    await this.followUpQueue.interrupt(conversationKey)
  }

  private bindActiveConversationRunAlias(
    run: ActiveConversationRun,
    alias: string,
    allowThreadReplacement = false
  ): boolean {
    if (run.threadId && run.threadId !== alias && !allowThreadReplacement) {
      throw new Error(`Active conversation thread changed from ${run.threadId} to ${alias}`)
    }
    const existingRun = this.activeConversationRuns.get(alias)
    if (existingRun && existingRun !== run) {
      throw new Error(`Conversation already has an active turn: ${alias}`)
    }
    if (existingRun === run) {
      const changed = run.threadId !== alias
      run.threadId = alias
      return changed
    }
    const changed = run.threadId !== alias
    run.threadId = alias
    this.activeConversationRuns.set(alias, run)
    return changed
  }

  private migrateActiveFollowUpClaims(run: ActiveConversationRun, conversationKey: string): void {
    const migrateClaim = (claim: FollowUpClaim): FollowUpClaim => ({
      ...claim,
      conversationKey,
      item: {
        ...claim.item,
        conversationKey,
        message: {
          ...claim.item.message,
          trustedContext: {
            ...claim.item.message.trustedContext,
            threadId: conversationKey
          }
        }
      }
    })

    if (run.followUpClaim && run.followUpClaim.conversationKey !== conversationKey) {
      run.followUpClaim = migrateClaim(run.followUpClaim)
    }
    for (const pending of run.pendingSteerClaims.values()) {
      if (pending.claim.conversationKey !== conversationKey) {
        pending.claim = migrateClaim(pending.claim)
      }
    }
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

  private createRunApprovalHandlers(
    run: ActiveConversationRun
  ): NonNullable<CodexCallOptions['approvals']> {
    const request = (input: CodexApprovalRequestInput): Promise<CodexApprovalResponse> => {
      if (run.streamPortDetached) {
        return Promise.resolve({
          action: 'decline',
          reason: 'The chat UI disconnected before approval was completed.'
        })
      }
      return this.approvalBroker.request(input, (requestId) => {
        run.approvalRequestIds.add(requestId)
      })
    }

    return {
      onCommandApproval: async (params) => {
        const response = await request({ kind: 'command', params })
        if (response.action === 'approveForSession' || response.action === 'alwaysApprove') {
          return 'acceptForSession'
        }
        if (response.action === 'approve') return 'accept'
        if (response.action === 'decline') return 'decline'
        return 'cancel'
      },
      onFileChangeApproval: async (params) => {
        const response = await request({ kind: 'file-change', params })
        if (response.action === 'approveForSession' || response.action === 'alwaysApprove') {
          return 'acceptForSession'
        }
        if (response.action === 'approve') return 'accept'
        if (response.action === 'decline') return 'decline'
        return 'cancel'
      },
      onToolUserInput: async (params) => {
        const response = await request({ kind: 'tool-user-input', params })
        return response.action === 'answer'
          ? { answers: toToolUserInputAnswers(response.answers) }
          : { answers: {} }
      },
      onElicitation: async (params) => {
        const response = await request({ kind: 'mcp-elicitation', params })
        if (response.action === 'alwaysApprove') {
          return { action: 'accept' as const, content: null, _meta: { persist: 'always' as const } }
        }
        if (response.action === 'approveForSession') {
          return {
            action: 'accept' as const,
            content: null,
            _meta: { persist: 'session' as const }
          }
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
  }

  private rejectRunApprovals(run: ActiveConversationRun, reason: string): void {
    for (const requestId of run.approvalRequestIds) {
      this.approvalBroker.reject(requestId, new Error(reason))
    }
    run.approvalRequestIds.clear()
  }

  private async declineRunApprovals(run: ActiveConversationRun, reason: string): Promise<void> {
    const responses: Promise<void>[] = []
    for (const requestId of run.approvalRequestIds) {
      try {
        responses.push(this.approvalBroker.respond(requestId, { action: 'decline', reason }))
      } catch {
        // The approval may have settled concurrently; the matching server
        // request already has a response in that case.
      }
    }
    run.approvalRequestIds.clear()
    await Promise.allSettled(responses)
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

function codexTurnDurationMessageMetadata(
  providerMetadata: unknown
): { codexTurnDurationMs: number } | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined
  const codexMetadata = (providerMetadata as Record<string, unknown>)[CODEX_PROVIDER_ID]
  if (!codexMetadata || typeof codexMetadata !== 'object') return undefined
  const durationMs = (codexMetadata as Record<string, unknown>).turnDurationMs
  return typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? { codexTurnDurationMs: durationMs }
    : undefined
}

async function defaultStreamText({
  request,
  modelId,
  provider,
  abortSignal,
  clientModel,
  executionTarget,
  resumeThreadId,
  startFreshTerminalRetry,
  onThreadStarted,
  onAgentLifecycle,
  onTurnLifecycle,
  onSessionCreated,
  approvals,
  onProviderToolCall
}: {
  request: CodexChatRequest
  modelId: string
  provider: CodexProvider
  abortSignal: AbortSignal
  clientModel?: AdminBackendClientModel
  executionTarget?: ConversationExecutionTarget
  resumeThreadId?: string
  startFreshTerminalRetry?: boolean
  onThreadStarted?: CodexCallOptions['onThreadStarted']
  onAgentLifecycle?: CodexCallOptions['onAgentLifecycle']
  onTurnLifecycle?: CodexCallOptions['onTurnLifecycle']
  onSessionCreated?: CodexCallOptions['onSessionCreated']
  approvals?: CodexCallOptions['approvals']
  onProviderToolCall?: (toolName: string) => void
}): Promise<StreamTextLikeResult> {
  const modelMessages = await convertToModelMessages(request.messages)
  const system = typeof request.body?.system === 'string' ? request.body.system : undefined
  const model = resolveLanguageModel({ provider, modelId, clientModel })
  const providerOptions = codexCallOptions(
    codexCallOptionsInput({
      modelId,
      requestMessageId: request.messageId,
      executionTarget,
      resumeThreadId: startFreshTerminalRetry ? undefined : (resumeThreadId ?? request.body?.threadId),
      startFreshTerminalRetry,
      onThreadStarted,
      onAgentLifecycle,
      onTurnLifecycle,
      onSessionCreated,
      approvals
    })
  )

  return aiStreamText({
    model,
    messages: modelMessages,
    system,
    abortSignal,
    onChunk: ({ chunk }) => {
      if (
        (chunk.type === 'tool-call' || chunk.type === 'tool-input-start') &&
        typeof chunk.toolName === 'string' &&
        chunk.toolName.length > 0
      ) {
        onProviderToolCall?.(chunk.toolName)
      }
    },
    ...(providerOptions ? { providerOptions } : {})
  })
}

function codexCallOptionsInput({
  modelId,
  requestMessageId,
  executionTarget,
  resumeThreadId,
  startFreshTerminalRetry,
  onThreadStarted,
  onAgentLifecycle,
  onTurnLifecycle,
  onSessionCreated,
  approvals
}: {
  modelId: string
  requestMessageId?: string
  executionTarget?: ConversationExecutionTarget
  resumeThreadId?: string
  startFreshTerminalRetry?: boolean
  onThreadStarted?: CodexCallOptions['onThreadStarted']
  onAgentLifecycle?: CodexCallOptions['onAgentLifecycle']
  onTurnLifecycle?: CodexCallOptions['onTurnLifecycle']
  onSessionCreated?: CodexCallOptions['onSessionCreated']
  approvals?: CodexCallOptions['approvals']
}): CodexCallOptions {
  return {
    model: modelId,
    ...(requestMessageId ? { clientUserMessageId: requestMessageId } : {}),
    summary: 'auto' as const,
    ...(resumeThreadId ? { resumeThreadId } : {}),
    ...(startFreshTerminalRetry ? { startFreshTerminalRetry: true } : {}),
    ...(onThreadStarted ? { onThreadStarted } : {}),
    ...(onAgentLifecycle ? { onAgentLifecycle } : {}),
    ...(onTurnLifecycle ? { onTurnLifecycle } : {}),
    ...(onSessionCreated ? { onSessionCreated } : {}),
    ...(approvals ? { approvals } : {}),
    ...(executionTarget?.cwd ? { cwd: executionTarget.cwd } : {}),
    ...(executionTarget?.runtimeWorkspaceRoots
      ? { runtimeWorkspaceRoots: executionTarget.runtimeWorkspaceRoots }
      : {})
  }
}

function shouldStartFreshTerminalRetry(request: CodexChatRequest): boolean {
  return request.trigger === 'regenerate-message' && request.body?.retryTerminalTurn === true
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

function userMessageToLanguageModelV3Prompt(
  message: CodexChatRequest['messages'][number]
): LanguageModelV3Prompt {
  if (message.role !== 'user') throw new Error('Steer requires a user message')

  const content: Array<LanguageModelV3TextPart | LanguageModelV3FilePart> = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'file') {
      content.push({
        type: 'file',
        data: part.url,
        mediaType: part.mediaType,
        ...(part.filename ? { filename: part.filename } : {})
      })
    }
  }

  return [
    {
      role: 'user',
      content
    }
  ]
}

function steeringCompareKey(message: CodexChatRequest['messages'][number]): string {
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()
  const attachments = message.parts.flatMap<
    { type: 'image'; url: string } | { type: 'localImage'; path: string }
  >((part) => {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return []
    try {
      const url = new URL(part.url)
      if (url.protocol === 'file:') {
        return [{ type: 'localImage' as const, path: fileURLToPath(url) }]
      }
      return [{ type: 'image' as const, url: url.href }]
    } catch {
      return [{ type: 'image' as const, url: part.url }]
    }
  })
  return JSON.stringify({ text, attachments })
}

function compareKeyForClaimedMessage(
  request: CodexChatRequest,
  messageId: string
): string | undefined {
  const message = request.messages.find((candidate) => candidate.id === messageId)
  if (!message) return undefined
  const normalized = restoreLocalMediaFileUrlsForModel([message])[0] ?? message
  return steeringCompareKey(normalized)
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

function turnLifecycleEventForRenderer(event: ProviderTurnLifecycleEvent): CodexTurnLifecycleEvent {
  switch (event.type) {
    case 'turn-started':
      return event
    case 'item-started':
    case 'item-completed':
      return {
        type: event.type,
        sequence: event.sequence,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        itemType: event.itemType,
        ...(event.clientUserMessageId ? { clientUserMessageId: event.clientUserMessageId } : {}),
        ...(event.compareKey ? { compareKey: event.compareKey } : {})
      }
    case 'turn-completed':
      return {
        type: event.type,
        sequence: event.sequence,
        threadId: event.threadId,
        turnId: event.turnId,
        outcome: event.outcome
      }
  }
}

function providerTurnFailureDetail(event: ProviderTurnLifecycleEvent): string | undefined {
  if (event.type !== 'turn-completed') return undefined
  const detail = (event as { error?: unknown }).error
  return typeof detail === 'string' && detail.trim() ? detail : undefined
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('thread_reference_limit_exceeded')) {
    return '每条消息最多引用 3 个任务'
  }
  if (message.includes('thread_reference_read_failed')) {
    return '无法加载引用的任务'
  }
  return sanitizeUserFacingError(message)
}

function sanitizeUserFacingError(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return '模型响应未完成，请重试。'

  const redacted = trimmed
    .replace(/(\bauthorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/(\bapi[_-]?key\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{6,}\b/giu, 'sk-[REDACTED]')

  if (redacted.length <= 2_000) return redacted
  return `${redacted.slice(0, 1_999)}…`
}

function steerFailureDisposition(error: unknown): {
  status: 'queued' | 'paused-failed' | 'paused-recovery-uncertain'
  kind: 'steer-rejected' | 'turn-race' | 'attachment-unavailable' | 'recovery-uncertain'
  userMessage: string
} {
  const code = isCodexSteerError(error) ? error.code : undefined
  const userMessage = followUpErrorMessage(error)
  switch (code) {
    case 'expected_turn_mismatch':
    case 'session_inactive':
    case 'unsupported_active_turn_kind':
      return { status: 'queued', kind: 'turn-race', userMessage }
    case 'attachment_resolution_failed':
      return { status: 'paused-failed', kind: 'attachment-unavailable', userMessage }
    default:
      return { status: 'paused-failed', kind: 'steer-rejected', userMessage }
  }
}

function isCodexSteerError(error: unknown): error is { code: CodexSteerErrorCode } {
  return error instanceof CodexSteerError
}

function terminalSteerFailureDisposition(
  terminalEvent: CodexChatStreamEvent | undefined,
  resultUncertain: boolean
): FollowUpClaimFailure {
  if (resultUncertain) {
    return {
      status: 'paused-recovery-uncertain',
      kind: 'recovery-uncertain',
      userMessage: 'The task ended before the steer result could be confirmed.'
    }
  }
  if (terminalEvent?.type === 'aborted') {
    return {
      status: 'paused-recovery-uncertain',
      kind: 'recovery-uncertain',
      userMessage: 'The task stopped before the steer was acknowledged.'
    }
  }
  if (terminalEvent?.type === 'error') {
    return {
      status: 'paused-failed',
      kind: 'steer-rejected',
      userMessage: terminalEvent.error
    }
  }
  return {
    status: 'paused-failed',
    kind: 'steer-rejected',
    userMessage: 'The task ended before the steer was acknowledged.'
  }
}

async function readTurnOutcomeFromHistory(
  historyClient: CodexHistoryClient | undefined,
  threadId: string,
  turnId: string
): Promise<'completed' | 'interrupted' | 'failed' | undefined> {
  if (!historyClient) return undefined
  const thread = await historyClient.readThread(threadId, { includeTurns: true })
  const status = thread.turns.find((turn) => turn.id === turnId)?.status
  return status === 'completed' || status === 'interrupted' || status === 'failed'
    ? status
    : undefined
}

function followUpErrorMessage(error: unknown): string {
  const message = errorMessage(error).trim()
  if (!message) return 'The steer operation failed.'
  if (message.length <= 2_000) return message
  return `${message.slice(0, 1_999)}…`
}
