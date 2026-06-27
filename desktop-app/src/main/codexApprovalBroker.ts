import type {
  CodexApprovalKind,
  CodexApprovalRequest,
  CodexApprovalResponse
} from '../shared/codexIpcApi'

type PendingApproval = {
  resolve: (response: CodexApprovalResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type CodexApprovalRequestInput = {
  kind: CodexApprovalKind
  params: unknown
}

export class CodexApprovalBroker {
  private readonly timeoutMs: number
  private readonly pending = new Map<string, PendingApproval>()
  private readonly listeners = new Set<(request: CodexApprovalRequest) => void>()

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 300_000
  }

  onRequest(listener: (request: CodexApprovalRequest) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  request(input: CodexApprovalRequestInput): Promise<CodexApprovalResponse> {
    const request: CodexApprovalRequest = {
      id: crypto.randomUUID(),
      kind: input.kind,
      params: input.params,
      createdAt: new Date().toISOString()
    }

    const promise = new Promise<CodexApprovalResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        resolve({ action: 'decline', reason: 'Approval timed out' })
      }, this.timeoutMs)
      this.pending.set(request.id, { resolve, reject, timeout })
    })

    for (const listener of this.listeners) listener(request)
    return promise
  }

  respond(requestId: string, response: CodexApprovalResponse): void {
    const pending = this.pending.get(requestId)
    if (!pending) throw new Error(`Unknown approval request: ${requestId}`)
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.resolve(response)
  }

  rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
  }
}
