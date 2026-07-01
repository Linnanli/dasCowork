import type { UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'

import { projectSelectionSchema } from './projects/projectSchemas'
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  ThreadProjectAssignment,
  WorkspaceFileSearchResult,
  WorkspaceRootOption
} from './projects/projectTypes'
import {
  projectCreateRemotePayloadSchema,
  projectCreateLocalPayloadSchema,
  projectRenamePayloadSchema,
  projectSelectPayloadSchema
} from './projects/projectSchemas'

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
} & Record<string, unknown>

export const codexChatRequestBodySchema = z
  .object({
    system: z.string().optional(),
    projectSelection: projectSelectionSchema.optional(),
    conversationId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional()
  })
  .catchall(z.unknown()) satisfies z.ZodType<CodexChatRequestBody>

export type CodexChatStreamEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'finish'; threadId?: string }
  | { type: 'aborted' }
  | { type: 'error'; error: string }

export type CodexChatStreamCallbacks = {
  onChunk(chunk: UIMessageChunk): void
  onFinish(threadId?: string): void
  onAbort(): void
  onError(error: string): void
}

export type CodexApprovalKind = 'command' | 'file-change' | 'tool-user-input' | 'mcp-elicitation'

export type CodexApprovalContext = {
  threadId?: string
  turnId?: string
  hostId?: string
  cwd?: string
  projectLabel?: string
}

export type CodexApprovalRequest = {
  id: string
  kind: CodexApprovalKind
  params: unknown
  createdAt: string
  context?: CodexApprovalContext
}

export type CodexApprovalResponse =
  | { action: 'approve' }
  | { action: 'approveForSession' }
  | { action: 'alwaysApprove' }
  | { action: 'decline'; reason?: string }
  | { action: 'answer'; answers: Record<string, string[]> }

export const codexChatRequestSchema = z.object({
  chatId: z.string().min(1),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  messageId: z.string().optional(),
  messages: z.array(z.custom<UIMessage>(isUiMessage)),
  modelId: z.string().min(1).optional(),
  metadata: z.unknown().optional(),
  body: codexChatRequestBodySchema.optional()
}) satisfies z.ZodType<CodexChatRequest>

export const codexApprovalResponseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('approveForSession') }),
  z.object({ action: z.literal('alwaysApprove') }),
  z.object({ action: z.literal('decline'), reason: z.string().optional() }),
  z.object({ action: z.literal('answer'), answers: z.record(z.string(), z.array(z.string())) })
]) satisfies z.ZodType<CodexApprovalResponse>

export const codexRespondApprovalPayloadSchema = z.object({
  requestId: z.string().min(1),
  response: codexApprovalResponseSchema
})

export const codexSetSelectedModelPayloadSchema = z.object({
  modelId: z.string().min(1)
})

export const codexOpenExternalHttpUrlPayloadSchema = z.object({
  url: z.string().url().refine(isExternalHttpUrl, 'external URL must be http(s)')
})

export const workspaceFileSearchPayloadSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional()
})

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

export type WorkspaceFileSearchPayload = z.infer<typeof workspaceFileSearchPayloadSchema>

export type WorkspaceFileSearchResponse = {
  results: WorkspaceFileSearchResult[]
}

export type DesktopCodexApi = {
  getStatus(): Promise<CodexStatus>
  listModels(): Promise<CodexModelList>
  setSelectedModel(modelId: string): Promise<{ selectedModelId: string }>
  respondApproval(requestId: string, response: CodexApprovalResponse): Promise<void>
  openExternalHttpUrl(url: string): Promise<void>
  onStatusChange(callback: (status: CodexStatus) => void): () => void
  onApprovalRequest(callback: (request: CodexApprovalRequest) => void): () => void
}

export type DesktopCodexChatApi = {
  startChatStream(request: CodexChatRequest, callbacks: CodexChatStreamCallbacks): string
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
export type ProjectCreateRemotePayload = z.infer<typeof projectCreateRemotePayloadSchema>
export type ProjectRenamePayload = z.infer<typeof projectRenamePayloadSchema>

export type DesktopProjectsApi = {
  getState(): Promise<ProjectState>
  pickWorkspaceRoot(): Promise<WorkspaceRootOption | null>
  createLocalProject(input: ProjectCreateLocalPayload): Promise<LocalProject>
  createRemoteProject(input: ProjectCreateRemotePayload): Promise<RemoteProject>
  selectProject(input: ProjectSelection): Promise<ProjectState>
  removeProject(input: ProjectSelection): Promise<ProjectState>
  renameProject(input: ProjectRenamePayload): Promise<ProjectState>
  createFuzzyFileSearchSession(
    input: WorkspaceFileSearchPayload
  ): Promise<WorkspaceFileSearchResponse>
  onStateChange(callback: (state: ProjectState) => void): () => void
}

export {
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
