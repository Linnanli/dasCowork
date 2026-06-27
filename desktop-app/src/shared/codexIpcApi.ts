import type { UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'

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

export type CodexChatRequest = {
  chatId: string
  trigger: 'submit-message' | 'regenerate-message'
  messageId?: string
  messages: UIMessage[]
  modelId?: string
  metadata?: unknown
  body?: Record<string, unknown>
}

export type CodexChatStreamEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'finish' }
  | { type: 'aborted' }
  | { type: 'error'; error: string }

export type CodexChatStreamCallbacks = {
  onChunk(chunk: UIMessageChunk): void
  onFinish(): void
  onAbort(): void
  onError(error: string): void
}

export type CodexApprovalKind =
  | 'command'
  | 'file-change'
  | 'tool-user-input'
  | 'mcp-elicitation'

export type CodexApprovalRequest = {
  id: string
  kind: CodexApprovalKind
  params: unknown
  createdAt: string
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
  messages: z.array(z.custom<UIMessage>((value) => Boolean(value && typeof value === 'object'))),
  modelId: z.string().optional(),
  metadata: z.unknown().optional(),
  body: z.record(z.string(), z.unknown()).optional()
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
  url: z.string().url()
})

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
