import type {
  CodexApprovalKind,
  CodexApprovalRequest,
  CodexApprovalResponse
} from '../shared/codexIpcApi'
import { ApprovalCoordinator } from './approvals/ApprovalCoordinator'

type PendingApproval = {
  request: CodexApprovalRequest
  resolve: (response: CodexApprovalResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type CodexApprovalRequestInput = {
  kind: CodexApprovalKind
  params: unknown
  context?: CodexApprovalRequest['context']
}

export class CodexApprovalBroker {
  private readonly timeoutMs: number
  private readonly pending = new Map<string, PendingApproval>()
  private readonly listeners = new Set<(request: CodexApprovalRequest) => void>()
  private readonly settledListeners = new Set<(requestId: string) => void>()
  private readonly coordinator = new ApprovalCoordinator({
    sendApproval: ({ id, response }) => this.resolvePending(id, response)
  })

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 300_000
  }

  onRequest(listener: (request: CodexApprovalRequest) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onSettled(listener: (requestId: string) => void): () => void {
    this.settledListeners.add(listener)
    return () => this.settledListeners.delete(listener)
  }

  getPendingCount(): number {
    return this.pending.size
  }

  getPendingRequestIds(): string[] {
    return [...this.pending.keys()]
  }

  listPendingApprovals(): CodexApprovalRequest[] {
    return [...this.pending.values()].map(({ request }) => structuredClone(request))
  }

  request(
    input: CodexApprovalRequestInput,
    onCreated?: (requestId: string) => void
  ): Promise<CodexApprovalResponse> {
    const request: CodexApprovalRequest = {
      id: crypto.randomUUID(),
      kind: input.kind,
      params: input.params,
      createdAt: new Date().toISOString(),
      ...(input.context ? { context: input.context } : {})
    }
    const registeredRequest = this.coordinator.registerApproval(request)

    const promise = new Promise<CodexApprovalResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        this.coordinator.forget(request.id)
        this.notifySettled(request.id)
        resolve({ action: 'decline', reason: 'Approval timed out' })
      }, this.timeoutMs)
      this.pending.set(request.id, { request: registeredRequest, resolve, reject, timeout })
    })

    onCreated?.(request.id)
    for (const listener of this.listeners) listener(registeredRequest)
    return promise
  }

  respond(requestId: string, response: CodexApprovalResponse): Promise<void> {
    if (!this.pending.has(requestId)) throw new Error(`Unknown approval request: ${requestId}`)
    return this.coordinator.respond(requestId, response)
  }

  private resolvePending(requestId: string, response: CodexApprovalResponse): void {
    const pending = this.pending.get(requestId)
    if (!pending) throw new Error(`Unknown approval request: ${requestId}`)
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    this.notifySettled(requestId)
    pending.resolve(response)
  }

  reject(requestId: string, error: Error): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    this.coordinator.forget(requestId)
    this.notifySettled(requestId)
    pending.reject(error)
    return true
  }

  rejectAll(error: Error): void {
    for (const id of this.pending.keys()) this.reject(id, error)
    this.coordinator.clear()
  }

  private notifySettled(requestId: string): void {
    for (const listener of this.settledListeners) listener(requestId)
  }
}
