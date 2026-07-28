import type {
  CodexApprovalKind,
  CodexApprovalRequest,
  CodexApprovalResponse
} from '../shared/codexIpcApi'
import { createRendererSafeApprovalParams, validateMcpFormValues } from '../shared/codexApprovalApi'
import { ApprovalCoordinator, extractApprovalContext } from './approvals/ApprovalCoordinator'

type PendingApproval = {
  request: CodexApprovalRequest
  resolve: (response: CodexApprovalResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  autoResolutionTimeout?: NodeJS.Timeout
  settling: boolean
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
    const context = mergeApprovalContexts(extractApprovalContext(input.params), input.context)
    const safeParams = createRendererSafeApprovalParams(input.kind, input.params)
    if (
      input.kind === 'command' &&
      (safeParams as Extract<CodexApprovalRequest, { kind: 'command' }>['params']).availableIntents
        .length === 0
    ) {
      console.warn(
        'Command approval has no valid availableDecisions; returning cancel without rendering'
      )
      return Promise.resolve({ action: 'cancel' })
    }
    const request: CodexApprovalRequest = {
      id: crypto.randomUUID(),
      kind: input.kind,
      params:
        input.kind === 'tool-user-input'
          ? withToolAutoResolutionDeadline(safeParams, Date.now())
          : safeParams,
      createdAt: new Date().toISOString(),
      ...(context ? { context } : {})
    } as CodexApprovalRequest
    const registeredRequest = this.coordinator.registerApproval(request)

    const promise = new Promise<CodexApprovalResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.resolvePending(request.id, timeoutResponseFor(registeredRequest), true)
      }, this.timeoutMs)
      const pending: PendingApproval = {
        request: registeredRequest,
        resolve,
        reject,
        timeout,
        settling: false
      }
      if (registeredRequest.kind === 'tool-user-input' && registeredRequest.params.deadlineAtMs) {
        const remainingMs = Math.max(0, registeredRequest.params.deadlineAtMs - Date.now())
        pending.autoResolutionTimeout = setTimeout(() => {
          this.resolvePending(request.id, { action: 'answer', answers: {} }, true)
        }, remainingMs)
      }
      this.pending.set(request.id, pending)
    })

    onCreated?.(request.id)
    for (const listener of this.listeners) listener(registeredRequest)
    return promise
  }

  respond(requestId: string, response: CodexApprovalResponse): Promise<void> {
    const pending = this.pending.get(requestId)
    if (!pending) throw new Error(`Unknown approval request: ${requestId}`)
    if (pending.settling) throw new Error(`Approval request is already being settled: ${requestId}`)
    assertResponseAllowed(pending.request, response)
    pending.settling = true
    return this.coordinator.respond(requestId, response).catch((error) => {
      const current = this.pending.get(requestId)
      if (current) current.settling = false
      throw error
    })
  }

  snoozeAutoResolution(requestId: string): boolean {
    const pending = this.pending.get(requestId)
    if (!pending || pending.settling || pending.request.kind !== 'tool-user-input') return false
    if (!pending.autoResolutionTimeout || pending.request.params.autoResolutionSnoozed) return false
    clearTimeout(pending.autoResolutionTimeout)
    pending.autoResolutionTimeout = undefined
    pending.request = {
      ...pending.request,
      params: { ...pending.request.params, autoResolutionSnoozed: true }
    }
    return true
  }

  private resolvePending(
    requestId: string,
    response: CodexApprovalResponse,
    forgetCoordinator = false
  ): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    this.clearPendingTimers(pending)
    if (forgetCoordinator) this.coordinator.forget(requestId)
    this.notifySettled(requestId)
    pending.resolve(response)
  }

  reject(requestId: string, error: Error): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.pending.delete(requestId)
    this.clearPendingTimers(pending)
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

  private clearPendingTimers(pending: PendingApproval): void {
    clearTimeout(pending.timeout)
    if (pending.autoResolutionTimeout) clearTimeout(pending.autoResolutionTimeout)
  }
}

function withToolAutoResolutionDeadline(
  params: CodexApprovalRequest['params'],
  registeredAtMs: number
): Extract<CodexApprovalRequest, { kind: 'tool-user-input' }>['params'] {
  if (!('autoResolutionMs' in params)) {
    throw new Error('Expected tool-user-input approval parameters')
  }
  const autoResolutionMs = params.autoResolutionMs
  if (autoResolutionMs === null || autoResolutionMs < 0) return params
  return {
    ...params,
    deadlineAtMs: (params.startedAtMs ?? registeredAtMs) + autoResolutionMs,
    autoResolutionSnoozed: false
  }
}

function mergeApprovalContexts(
  derived: CodexApprovalRequest['context'],
  explicit: CodexApprovalRequest['context']
): CodexApprovalRequest['context'] {
  if (!derived && !explicit) return undefined
  return { ...derived, ...explicit }
}

function assertResponseAllowed(
  request: CodexApprovalRequest,
  response: CodexApprovalResponse
): void {
  const kind = request.kind
  const action = response.action
  if (kind === 'command') {
    if (!isCommandApprovalIntent(action) || !request.params.availableIntents.includes(action)) {
      throw new Error(`Action ${action} is not allowed for ${kind}`)
    }
    return
  }
  if (kind === 'file-change') {
    if (!isFileChangeApprovalIntent(action)) {
      throw new Error(`Action ${action} is not allowed for ${kind}`)
    }
    if (!request.params.availableIntents.includes(action)) {
      throw new Error(`Action ${action} is not allowed for ${kind}`)
    }
    return
  }
  if (kind === 'tool-user-input') {
    const allowed = ['answer', 'decline']
    if (!allowed.includes(action)) throw new Error(`Action ${action} is not allowed for ${kind}`)
    if (action === 'answer') {
      if (request.params.autoResolutionMs !== null && Object.keys(response.answers).length === 0) {
        return
      }
      const questionIds = new Set(request.params.questions.map((question) => question.id))
      if (
        Object.keys(response.answers).length !== request.params.questions.length ||
        Object.entries(response.answers).some(
          ([questionId, values]) => !questionIds.has(questionId) || values.length === 0
        )
      ) {
        throw new Error('Tool input answers must include a response for every requested question')
      }
    }
    return
  }
  if (kind === 'permission-request') {
    if (action === 'decline') return
    if (action !== 'approvePermissions' || !request.params.details.supported) {
      throw new Error(`Action ${action} is not allowed for ${kind}`)
    }
    if (!request.params.availableScopes.includes(response.scope)) {
      throw new Error(`Permission scope ${response.scope} is not allowed for ${kind}`)
    }
    return
  }
  if (
    action !== 'decline' &&
    action !== 'cancel' &&
    action !== 'submitMcpForm' &&
    action !== 'approve'
  ) {
    throw new Error(`Action ${action} is not allowed for ${kind}`)
  }
  if (request.params.mode === 'form' || request.params.mode === 'openai/form') {
    if (action !== 'submitMcpForm' && action !== 'decline' && action !== 'cancel') {
      throw new Error('MCP form requests must be submitted with their form values')
    }
    if (action !== 'submitMcpForm') return
    const validationError = validateMcpFormValues(request.params, response.values)
    if (validationError) throw new Error(validationError)
    return
  }
  if (request.params.mode === 'url') {
    if (!request.params.url && action !== 'decline' && action !== 'cancel') {
      throw new Error('Invalid MCP URL requests can only be declined or cancelled')
    }
    if (request.params.url && action !== 'approve' && action !== 'decline' && action !== 'cancel') {
      throw new Error('MCP URL requests can only be approved, declined, or cancelled')
    }
    return
  }
  if (action === 'submitMcpForm') {
    throw new Error('MCP form submission is not allowed for this request')
  }
}

function timeoutResponseFor(request: CodexApprovalRequest): CodexApprovalResponse {
  if (
    request.kind === 'command' ||
    request.kind === 'file-change' ||
    request.kind === 'mcp-elicitation'
  ) {
    return { action: 'cancel' }
  }
  return { action: 'decline', reason: 'Approval timed out' }
}

function isCommandApprovalIntent(
  action: CodexApprovalResponse['action']
): action is Extract<
  CodexApprovalResponse['action'],
  | 'approve'
  | 'approveForSession'
  | 'approveWithExecpolicyAmendment'
  | 'applyNetworkPolicyAmendment'
  | 'decline'
  | 'cancel'
> {
  return (
    action === 'approve' ||
    action === 'approveForSession' ||
    action === 'approveWithExecpolicyAmendment' ||
    action === 'applyNetworkPolicyAmendment' ||
    action === 'decline' ||
    action === 'cancel'
  )
}

function isFileChangeApprovalIntent(
  action: CodexApprovalResponse['action']
): action is Extract<
  CodexApprovalResponse['action'],
  'approve' | 'approveForSession' | 'decline' | 'cancel'
> {
  return (
    action === 'approve' ||
    action === 'approveForSession' ||
    action === 'decline' ||
    action === 'cancel'
  )
}
