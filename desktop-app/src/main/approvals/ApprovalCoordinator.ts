import type {
  CodexApprovalContext,
  CodexApprovalRequest,
  CodexApprovalResponse
} from '../../shared/codexIpcApi'

export type ApprovalDispatch = {
  id: string
  response: CodexApprovalResponse
  threadId?: string
  turnId?: string
  hostId?: string
  cwd?: string
}

export type ApprovalCoordinatorOptions = {
  activeProjectCwd?: string
  sendApproval: (approval: ApprovalDispatch) => void | Promise<void>
}

export class ApprovalCoordinator {
  private readonly contexts = new Map<string, CodexApprovalContext>()
  private readonly sendApproval: ApprovalCoordinatorOptions['sendApproval']

  constructor(options: ApprovalCoordinatorOptions) {
    void options.activeProjectCwd
    this.sendApproval = options.sendApproval
  }

  registerApproval(request: CodexApprovalRequest): CodexApprovalRequest {
    const context = extractApprovalContext(request.params)
    if (!context) return request
    this.contexts.set(request.id, context)
    return { ...request, context }
  }

  approve(requestId: string): Promise<void> {
    return this.respond(requestId, { action: 'approve' })
  }

  async respond(requestId: string, response: CodexApprovalResponse): Promise<void> {
    const context = this.contexts.get(requestId)
    this.contexts.delete(requestId)
    await this.sendApproval({
      id: requestId,
      response,
      ...(context?.threadId ? { threadId: context.threadId } : {}),
      ...(context?.turnId ? { turnId: context.turnId } : {}),
      ...(context?.hostId ? { hostId: context.hostId } : {}),
      ...(context?.cwd ? { cwd: context.cwd } : {})
    })
  }

  forget(requestId: string): void {
    this.contexts.delete(requestId)
  }

  clear(): void {
    this.contexts.clear()
  }
}

export function extractApprovalContext(params: unknown): CodexApprovalContext | undefined {
  const record = asRecord(params)
  if (!record) return undefined

  const context: CodexApprovalContext = {
    threadId: stringValue(record.threadId),
    turnId: stringValue(record.turnId),
    hostId: stringValue(record.hostId),
    cwd:
      stringValue(record.cwd) ??
      stringValue(record.grantRoot) ??
      stringValue(record.workingDirectory) ??
      stringValue(record.workspaceRoot),
    projectLabel: stringValue(record.projectLabel)
  }

  return Object.values(context).some(Boolean) ? context : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
