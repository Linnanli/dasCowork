import type { UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'

export * from './composerContext'
export * from './composerContextSearch'
export * from './mcpServerStatus'
export * from './codexFollowUpApi'
export * from './codexApprovalApi'
export * from './localGitApi'

import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  ThreadProjectAssignment,
  WorkspaceRecoveryStatus,
  WorkspaceRootOption
} from './projects/projectTypes'
import {
  projectCreateBlankPayloadSchema,
  projectCreateLocalPayloadSchema,
  projectCreateRemotePayloadSchema,
  projectRenamePayloadSchema,
  projectSelectPayloadSchema,
  projectSelectionSchema
} from './projects/projectSchemas'
import { followUpTurnStartRequestSchema, type FollowUpTurnStartRequest } from './codexFollowUpApi'
import {
  codexApprovalResponseSchema,
  type CodexApprovalRequest,
  type CodexApprovalResponse
} from './codexApprovalApi'
import type { McpServerListRequest, McpServerListResult } from './mcpServerStatus'
import type {
  LocalBranchCheckoutResult,
  LocalBranchSearchResult,
  LocalBranchSummary,
  LocalCommitRequest,
  LocalCommitResult,
  GitResolveRepositoryTargetRequest,
  GitResolveRepositoryTargetResult,
  LocalGitCommitSummary,
  LocalGitBranchRequest,
  LocalGitBranchSearchRequest,
  LocalGitChangeEvent,
  LocalGitCheckoutBranchRequest,
  LocalGitCreateBranchRequest,
  LocalGitFileDiff,
  LocalGitGetReviewSnapshotRequest,
  LocalGitRefreshReviewFilesRequest,
  LocalGitListCommitsRequest,
  LocalGitGetSummaryRequest,
  LocalGitGetFileDiffRequest,
  LocalGitGetReviewApplyCommandRequest,
  LocalGitGetReviewDiffFileContentsRequest,
  LocalGitGetReviewFileContentRequest,
  LocalGitGetTurnDiffFileContentsRequest,
  LocalGitReviewApplyCommand,
  LocalGitReviewSearchResult,
  LocalGitReviewFileContent,
  LocalGitReviewDiffFileContents,
  LocalGitMutationResult,
  LocalGitMergeBase,
  LocalGitResolveMergeBaseRequest,
  LocalGitReviewMutationRequest,
  LocalGitReviewFilesRefresh,
  LocalGitReviewSnapshot,
  LocalGitSearchReviewRequest,
  LocalGitSummary,
  TurnPatchRequest
} from './localGitApi'

export type CodexRunState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'

export type CodexStatus = {
  state: CodexRunState
  binary: string
  startedAt?: string
  lastError?: string
}

export type CodexModel = {
  id: string
  displayName: string
  description?: string
  inputModalities: string[]
  isDefault: boolean
}

export type CodexModelList = {
  models: CodexModel[]
  selectedModelId?: string
  unavailableReason?: string
}

export type SidebarConversation = {
  id: string
  threadId?: string
  originConversationId?: string
  title: string | null
  projectAssignment?: ThreadProjectAssignment
  createdAt?: string
  updatedAt?: string
  archived?: boolean
  unread?: boolean
  running?: boolean
  cwd?: string | null
}

export type SidebarConversationListState = {
  conversations: SidebarConversation[]
  archivedConversationIds: string[]
  loaded: boolean
  error?: string
}

export type SidebarPreferences = {
  organizeMode: 'project' | 'recent-projects' | 'chronological'
  sortKey: 'updated_at' | 'created_at'
  collapsedSectionIds: string[]
  collapsedGroupIds: string[]
}

export type SidebarConversationActionPayload = {
  conversationId: string
}

export type SidebarConversationRenamePayload = SidebarConversationActionPayload & {
  title: string
}

export type SidebarConversationOpenResult = {
  conversationId: string
  threadId: string
  title: string | null
  messages: UIMessage[]
  historyRevision?: string | null
  projectAssignment?: ThreadProjectAssignment
  cwd?: string | null
}

export type CodexChatRequest = {
  chatId: string
  trigger: 'submit-message' | 'regenerate-message'
  messageId?: string
  messages: UIMessage[]
  modelId?: string
  metadata?: unknown
  body?: CodexChatRequestBody
}

export type CodexChatRequestBody = {
  system?: string
  projectSelection?: ProjectSelection
  conversationId?: string
  threadId?: string
  retryTerminalTurn?: boolean
  followUpRequest?: FollowUpTurnStartRequest
} & Record<string, unknown>

export const codexChatRequestBodySchema = z
  .object({
    system: z.string().optional(),
    projectSelection: projectSelectionSchema.optional(),
    conversationId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
    retryTerminalTurn: z.literal(true).optional(),
    followUpRequest: followUpTurnStartRequestSchema.optional()
  })
  .catchall(z.unknown()) satisfies z.ZodType<CodexChatRequestBody>

export type CodexTurnLifecycleEvent =
  | {
      type: 'turn-started'
      sequence: number
      threadId: string
      turnId: string
    }
  | {
      type: 'item-started' | 'item-completed'
      sequence: number
      threadId: string
      turnId: string
      itemId: string
      itemType: string
      clientUserMessageId?: string
      compareKey?: string
    }
  | {
      type: 'turn-completed'
      sequence: number
      threadId: string
      turnId: string
      outcome: 'completed' | 'interrupted' | 'failed'
    }

/**
 * Stable, renderer-safe reasons why an established recovery stream cannot be
 * resumed.  These codes are a control-plane contract; `message` is only for
 * display and must not be used to infer the recovery outcome.
 */
export type CodexChatStreamFailureCode =
  | 'run-unavailable'
  | 'run-mismatch'
  | 'journal-unavailable'
  | 'unknown-recovery'

export type CodexChatStreamFailure = {
  readonly code: CodexChatStreamFailureCode
  readonly message: string
}

export type CodexChatStreamError = string | CodexChatStreamFailure

const codexChatStreamFailureSchema = z.object({
  code: z.enum(['run-unavailable', 'run-mismatch', 'journal-unavailable', 'unknown-recovery']),
  message: z.string()
}) satisfies z.ZodType<CodexChatStreamFailure>

const codexChatStreamErrorSchema = z.union([
  z.string(),
  codexChatStreamFailureSchema
]) satisfies z.ZodType<CodexChatStreamError>

export type CodexChatStreamEvent =
  | { type: 'thread-bound'; threadId: string }
  | { type: 'turn-lifecycle'; event: CodexTurnLifecycleEvent }
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'resync-required'; reason: 'journal-overflow' }
  | { type: 'finish'; threadId?: string }
  | { type: 'aborted' }
  | { type: 'error'; error: CodexChatStreamError }

/**
 * The MessagePort wire format for a run event. `sequence` is monotonic within
 * one run so a renderer can discard replayed events and detect a lost range.
 */
export type CodexChatStreamEnvelope = {
  readonly runId: string
  readonly sequence: number
  readonly event: CodexChatStreamEvent
}

export type CodexChatPortMessage = CodexChatStreamEnvelope | CodexChatStreamEvent

export type CodexChatTerminalEvent = Extract<
  CodexChatStreamEvent,
  { type: 'finish' | 'aborted' | 'error' }
>

/** The outcome of attaching a replacement MessagePort to a known run. */
export type CodexChatAttachResult =
  | { readonly status: 'attached' }
  | { readonly status: 'run-unavailable' }
  | { readonly status: 'run-mismatch' }
  | { readonly status: 'journal-unavailable' }

export type CodexChatRunDescriptor = {
  readonly runId: string
  readonly conversationId: string
  readonly threadId?: string
  readonly lastSequence: number
}

/**
 * A renderer-safe baseline for rebuilding a local conversation before a
 * newly-created thread has durable history. Main owns this only for the
 * active/terminal replay window; the app-server history remains authoritative.
 */
export type CodexChatRecoverySnapshot = {
  readonly run: CodexChatRunDescriptor
  readonly baseMessages: readonly UIMessage[]
}

/**
 * A terminal signal sent over regular Electron IPC when the stream MessagePort
 * has already failed. Chunks intentionally remain MessagePort-only.
 */
export type CodexChatTerminalFallback = {
  streamId: string
  terminal: CodexChatTerminalEvent
}

export type CodexChatControlMessage =
  | { type: 'abort'; runId?: string }
  | { type: 'thread-bound-ack'; threadId: string }

export type CodexChatStreamCallbacks = {
  onThreadBound(threadId: string): void
  onTurnLifecycle?(event: CodexTurnLifecycleEvent): void
  onChunk(chunk: UIMessageChunk): void
  onFinish(threadId?: string): void
  onAbort(): void
  onError(error: CodexChatStreamError): void
}

export const codexChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread-bound'), threadId: z.string().min(1) }),
  z.object({
    type: z.literal('turn-lifecycle'),
    event: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('turn-started'),
        sequence: z.number().int().nonnegative(),
        threadId: z.string().min(1),
        turnId: z.string().min(1)
      }),
      z.object({
        type: z.enum(['item-started', 'item-completed']),
        sequence: z.number().int().nonnegative(),
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        itemId: z.string().min(1),
        itemType: z.string().min(1),
        clientUserMessageId: z.string().min(1).optional(),
        compareKey: z.string().min(1).optional()
      }),
      z.object({
        type: z.literal('turn-completed'),
        sequence: z.number().int().nonnegative(),
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        outcome: z.enum(['completed', 'interrupted', 'failed'])
      })
    ])
  }),
  z.object({ type: z.literal('chunk'), chunk: z.custom<UIMessageChunk>(isUiMessageChunk) }),
  z.object({ type: z.literal('resync-required'), reason: z.literal('journal-overflow') }),
  z.object({ type: z.literal('finish'), threadId: z.string().min(1).optional() }),
  z.object({ type: z.literal('aborted') }),
  z.object({ type: z.literal('error'), error: codexChatStreamErrorSchema })
]) satisfies z.ZodType<CodexChatStreamEvent>

export const codexChatStreamEnvelopeSchema = z.object({
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  event: codexChatStreamEventSchema
}) satisfies z.ZodType<CodexChatStreamEnvelope>

export const codexChatTerminalEventSchema = z.union([
  z.object({ type: z.literal('finish'), threadId: z.string().min(1).optional() }),
  z.object({ type: z.literal('aborted') }),
  z.object({ type: z.literal('error'), error: codexChatStreamErrorSchema })
]) satisfies z.ZodType<CodexChatTerminalEvent>

export const codexChatControlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('abort'), runId: z.string().min(1).optional() }),
  z.object({ type: z.literal('thread-bound-ack'), threadId: z.string().min(1) })
]) satisfies z.ZodType<CodexChatControlMessage>

export type CodexOpenLocalPathPayload = {
  path: string
  line?: number
  cwd?: string
}

export type LocalContextReference =
  | {
      kind: 'file' | 'folder'
      path: string
      label: string
      fileUrl: string
      capabilityToken?: string
    }
  | {
      kind: 'image'
      path: string
      label: string
      mediaType: string
      previewUrl: string
      capabilityToken?: string
    }

export type LocalContextPickerKind = 'filesAndFolders'

export type LocalContextPickerPayload = {
  kind: LocalContextPickerKind
}

export const codexChatRequestSchema = z.object({
  chatId: z.string().min(1),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  messageId: z.string().optional(),
  messages: z.array(z.custom<UIMessage>(isUiMessage)),
  modelId: z.string().min(1).optional(),
  metadata: z.unknown().optional(),
  body: codexChatRequestBodySchema.optional()
}) satisfies z.ZodType<CodexChatRequest>

export type CodexChatStartPayload = {
  streamId: string
  request: CodexChatRequest
}

export type CodexChatPortDetachedPayload = {
  streamId: string
  chatId: string
}

/** A renderer can attach to a still-running main-process turn after reload. */
export type CodexChatAttachPayload = {
  streamId: string
  conversationId: string
  runId?: string
  afterSequence?: number
}

export const codexChatStartPayloadSchema = z.object({
  streamId: z.string().min(1),
  request: codexChatRequestSchema
}) satisfies z.ZodType<CodexChatStartPayload>

export const codexChatPortDetachedPayloadSchema = z.object({
  streamId: z.string().min(1),
  chatId: z.string().min(1)
}) satisfies z.ZodType<CodexChatPortDetachedPayload>

export const codexChatAttachPayloadSchema = z.object({
  streamId: z.string().min(1),
  conversationId: z.string().min(1),
  runId: z.string().min(1).optional(),
  afterSequence: z.number().int().nonnegative().optional()
}) satisfies z.ZodType<CodexChatAttachPayload>

export const codexChatTerminalFallbackSchema = z.object({
  streamId: z.string().min(1),
  terminal: codexChatTerminalEventSchema
}) satisfies z.ZodType<CodexChatTerminalFallback>

export const codexRespondApprovalPayloadSchema = z.object({
  requestId: z.string().min(1),
  response: codexApprovalResponseSchema
})

export const codexSnoozeApprovalAutoResolutionPayloadSchema = z
  .object({ requestId: z.string().min(1) })
  .strict()

export const codexSetSelectedModelPayloadSchema = z.object({
  modelId: z.string().min(1)
})

export const codexOpenExternalHttpUrlPayloadSchema = z.object({
  url: z.string().url().refine(isExternalHttpUrl, 'external URL must be http(s)')
})

export const codexOpenLocalPathPayloadSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().min(1).optional(),
    cwd: z.string().min(1).optional()
  })
  .superRefine((value, context) => {
    if (isSafeLocalOpenPath(value.path)) {
      if (value.cwd !== undefined && !isSafeLocalOpenPath(value.cwd)) {
        context.addIssue({
          code: 'custom',
          path: ['cwd'],
          message: 'cwd must be an absolute local path'
        })
      }
      return
    }

    if (!isSafeLocalRelativePath(value.path)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path must be a local path'
      })
    }

    if (value.cwd === undefined || !isSafeLocalOpenPath(value.cwd)) {
      context.addIssue({
        code: 'custom',
        path: ['cwd'],
        message: 'relative paths require an absolute local cwd'
      })
    }
  }) satisfies z.ZodType<CodexOpenLocalPathPayload>

export const localContextPickerPayloadSchema = z.object({
  kind: z.literal('filesAndFolders')
}) satisfies z.ZodType<LocalContextPickerPayload>

const localContextPathSchema = z.object({
  path: z.string().min(1).refine(isSafeLocalOpenPath, 'path must be an absolute local path'),
  label: z.string().min(1)
})

const localContextFileSystemPathSchema = localContextPathSchema.extend({
  fileUrl: z.string().refine(isLocalFileUrl, 'file URL must use the file: scheme'),
  capabilityToken: z.string().min(1).optional()
})

export const localContextReferenceSchema = z.discriminatedUnion('kind', [
  localContextFileSystemPathSchema.extend({ kind: z.literal('file') }),
  localContextFileSystemPathSchema.extend({ kind: z.literal('folder') }),
  localContextPathSchema.extend({
    kind: z.literal('image'),
    mediaType: z.string().regex(/^image\//u, 'media type must be an image'),
    previewUrl: z
      .string()
      .regex(/^app:\/\/fs\/@fs\//u, 'preview URL must use the local media protocol'),
    capabilityToken: z.string().min(1).optional()
  })
]) satisfies z.ZodType<LocalContextReference>

export const localContextReferenceListSchema = z.array(localContextReferenceSchema)

export const sidebarConversationActionPayloadSchema = z.object({
  conversationId: z.string().min(1)
})

export const sidebarConversationRenamePayloadSchema = sidebarConversationActionPayloadSchema.extend(
  {
    title: z.string().trim().min(1).max(120)
  }
)

export const sidebarConversationOpenResultSchema = z.object({
  conversationId: z.string().min(1),
  threadId: z.string().min(1),
  title: z.string().nullable(),
  messages: z.array(z.custom<UIMessage>(isUiMessage)),
  historyRevision: z.string().nullable().optional(),
  projectAssignment: z.custom<ThreadProjectAssignment>().optional(),
  cwd: z.string().nullable().optional()
}) satisfies z.ZodType<SidebarConversationOpenResult>

export const sidebarPreferencesSchema = z.object({
  organizeMode: z.enum(['project', 'recent-projects', 'chronological']),
  sortKey: z.enum(['updated_at', 'created_at']),
  collapsedSectionIds: z.array(z.string()),
  collapsedGroupIds: z.array(z.string())
}) satisfies z.ZodType<SidebarPreferences>

export const sidebarPreferencesPatchSchema = sidebarPreferencesSchema.partial()

export type DesktopCodexApi = {
  getStatus(): Promise<CodexStatus>
  listModels(): Promise<CodexModelList>
  listMcpServers(input: McpServerListRequest): Promise<McpServerListResult>
  setSelectedModel(modelId: string): Promise<{ selectedModelId: string }>
  listPendingApprovals?(): Promise<CodexApprovalRequest[]>
  respondApproval(requestId: string, response: CodexApprovalResponse): Promise<void>
  snoozeApprovalAutoResolution?(requestId: string): Promise<boolean>
  openExternalHttpUrl(url: string): Promise<void>
  openLocalPath(input: CodexOpenLocalPathPayload): Promise<void>
  pickLocalContext(kind: LocalContextPickerKind): Promise<LocalContextReference[]>
  onStatusChange(callback: (status: CodexStatus) => void): () => void
  onApprovalRequest(callback: (request: CodexApprovalRequest) => void): () => void
  onApprovalSettled?(callback: (requestId: string) => void): () => void
}

export type DesktopCodexChatApi = {
  startChatStream(request: CodexChatRequest, callbacks: CodexChatStreamCallbacks): string
  getActiveRun?(conversationId: string): Promise<CodexChatRunDescriptor | null>
  getActiveRuns?(): Promise<CodexChatRunDescriptor[]>
  getActiveSnapshot?(conversationId: string): Promise<CodexChatRecoverySnapshot | null>
  attachChatStream?(
    conversationId: string,
    callbacks: CodexChatStreamCallbacks
  ): Promise<string | null>
  abortChatStream(streamId: string): void
}

export type DesktopConversationsApi = {
  getConversationList(): Promise<SidebarConversationListState>
  refreshConversationList(): Promise<SidebarConversationListState>
  openConversation(input: SidebarConversationActionPayload): Promise<SidebarConversationOpenResult>
  archiveConversation(
    input: SidebarConversationActionPayload
  ): Promise<SidebarConversationListState>
  unarchiveConversation(
    input: SidebarConversationActionPayload
  ): Promise<SidebarConversationListState>
  renameConversation(input: SidebarConversationRenamePayload): Promise<SidebarConversationListState>
  interruptConversation(input: SidebarConversationActionPayload): Promise<void>
  getPreferences(): Promise<SidebarPreferences>
  setPreferences(input: Partial<SidebarPreferences>): Promise<SidebarPreferences>
  onConversationListChange(callback: (state: SidebarConversationListState) => void): () => void
}

export type ProjectCreateLocalPayload = z.infer<typeof projectCreateLocalPayloadSchema>
export type ProjectCreateBlankPayload = z.infer<typeof projectCreateBlankPayloadSchema>
export type ProjectCreateRemotePayload = z.infer<typeof projectCreateRemotePayloadSchema>
export type ProjectRenamePayload = z.infer<typeof projectRenamePayloadSchema>

export type ProjectCreateBlankResult = {
  option: WorkspaceRootOption
  state: ProjectState
}

export type WorkspaceRecoveryPayload = {
  conversationId: string
  threadId?: string
}

export const workspaceRecoveryPayloadSchema = z.object({
  conversationId: z.string().min(1),
  threadId: z.string().min(1).optional()
}) satisfies z.ZodType<WorkspaceRecoveryPayload>

export type DesktopProjectsApi = {
  getState(): Promise<ProjectState>
  pickWorkspaceRoot(): Promise<WorkspaceRootOption | null>
  createBlankProject(input: ProjectCreateBlankPayload): Promise<ProjectCreateBlankResult>
  createLocalProject(input: ProjectCreateLocalPayload): Promise<LocalProject>
  createRemoteProject(input: ProjectCreateRemotePayload): Promise<RemoteProject>
  selectProject(input: ProjectSelection): Promise<ProjectState>
  removeProject(input: ProjectSelection): Promise<ProjectState>
  renameProject(input: ProjectRenamePayload): Promise<ProjectState>
  getWorkspaceRecovery(input: WorkspaceRecoveryPayload): Promise<WorkspaceRecoveryStatus>
  restoreWorkspace(input: WorkspaceRecoveryPayload): Promise<WorkspaceRecoveryStatus>
  onStateChange(callback: (state: ProjectState) => void): () => void
}

export type DesktopGitApi = {
  resolveRepositoryTarget(
    input: GitResolveRepositoryTargetRequest
  ): Promise<GitResolveRepositoryTargetResult>
  getSummary(input: LocalGitGetSummaryRequest): Promise<LocalGitSummary>
  listCommits(input: LocalGitListCommitsRequest): Promise<LocalGitCommitSummary[]>
  getReviewSnapshot(input: LocalGitGetReviewSnapshotRequest): Promise<LocalGitReviewSnapshot>
  refreshReviewFiles(input: LocalGitRefreshReviewFilesRequest): Promise<LocalGitReviewFilesRefresh>
  getFileDiff(input: LocalGitGetFileDiffRequest): Promise<LocalGitFileDiff>
  getReviewApplyCommand(
    input: LocalGitGetReviewApplyCommandRequest
  ): Promise<LocalGitReviewApplyCommand>
  getReviewDiffFileContents(
    input: LocalGitGetReviewDiffFileContentsRequest
  ): Promise<LocalGitReviewDiffFileContents>
  getTurnDiffFileContents(
    input: LocalGitGetTurnDiffFileContentsRequest
  ): Promise<LocalGitReviewDiffFileContents>
  getReviewFileContent(
    input: LocalGitGetReviewFileContentRequest
  ): Promise<LocalGitReviewFileContent>
  searchReview(input: LocalGitSearchReviewRequest): Promise<LocalGitReviewSearchResult>
  applyReviewAction(input: LocalGitReviewMutationRequest): Promise<LocalGitMutationResult>
  applyTurnPatch(input: TurnPatchRequest): Promise<LocalGitMutationResult>
  listBranches(input: LocalGitBranchRequest): Promise<LocalBranchSummary>
  searchBranches(input: LocalGitBranchSearchRequest): Promise<LocalBranchSearchResult[]>
  resolveMergeBase(input: LocalGitResolveMergeBaseRequest): Promise<LocalGitMergeBase>
  createBranch(input: LocalGitCreateBranchRequest): Promise<LocalBranchCheckoutResult>
  checkoutBranch(input: LocalGitCheckoutBranchRequest): Promise<LocalBranchCheckoutResult>
  commitChanges(input: LocalCommitRequest): Promise<LocalCommitResult>
  subscribe(callback: (event: LocalGitChangeEvent) => void): () => void
}

export {
  projectCreateBlankPayloadSchema,
  projectCreateLocalPayloadSchema,
  projectCreateRemotePayloadSchema,
  projectRenamePayloadSchema,
  projectSelectPayloadSchema
}

export function isExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isSafeLocalOpenPath(value: string): boolean {
  if (value.includes('\0')) return false
  if (value.startsWith('//') || value.startsWith('\\\\')) return false
  if (value.startsWith('/')) return true
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isLocalFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'file:'
  } catch {
    return false
  }
}

function isSafeLocalRelativePath(value: string): boolean {
  if (value.includes('\0')) return false
  if (value.startsWith('//') || value.startsWith('\\\\')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false
  return true
}

function isUiMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as { id?: unknown; role?: unknown; parts?: unknown }
  return (
    typeof message.id === 'string' &&
    message.id.length > 0 &&
    (message.role === 'system' || message.role === 'user' || message.role === 'assistant') &&
    Array.isArray(message.parts) &&
    message.parts.every(isUiMessagePart)
  )
}

function isUiMessagePart(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const part = value as { type?: unknown }
  return typeof part.type === 'string' && part.type.length > 0
}

function isUiMessageChunk(value: unknown): value is UIMessageChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const chunk = value as { type?: unknown }
  return typeof chunk.type === 'string' && chunk.type.length > 0
}
