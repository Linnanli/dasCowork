import { describe, expect, it, vi } from 'vitest'

import { CodexApprovalBroker } from './codexApprovalBroker'

describe('CodexApprovalBroker', () => {
  it('publishes and resolves approval requests', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)

    const pending = broker.request({ kind: 'command', params: { command: 'pwd' } })
    const request = listener.mock.calls[0][0]

    expect(broker.getPendingRequestIds()).toEqual([request.id])
    expect(request.kind).toBe('command')
    expect(request.params).toEqual({
      command: 'pwd',
      networkPolicyScopes: [],
      availableIntents: ['approve', 'cancel']
    })

    broker.respond(request.id, { action: 'approve' })
    await expect(pending).resolves.toEqual({ action: 'approve' })
    expect(broker.getPendingRequestIds()).toEqual([])
  })

  it('returns an immutable snapshot of requests that are still pending', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const pending = broker.request({
      kind: 'command',
      params: { command: 'pwd' },
      context: { threadId: 'thread-pending', turnId: 'turn-pending' }
    })

    const [snapshot] = broker.listPendingApprovals()
    expect(snapshot).toMatchObject({
      kind: 'command',
      context: { threadId: 'thread-pending', turnId: 'turn-pending' }
    })
    ;(snapshot!.context as { threadId?: string }).threadId = 'mutated-locally'
    expect(broker.listPendingApprovals()[0]?.context?.threadId).toBe('thread-pending')

    broker.respond(snapshot!.id, { action: 'cancel' })
    await expect(pending).resolves.toEqual({ action: 'cancel' })
    expect(broker.listPendingApprovals()).toEqual([])
  })

  it('publishes approval context from request params', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)

    const pending = broker.request({
      kind: 'command',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        hostId: 'local',
        cwd: '/repo'
      }
    })
    const request = listener.mock.calls[0][0]

    expect(request.context).toEqual({
      threadId: 'thread_1',
      turnId: 'turn_1',
      hostId: 'local',
      cwd: '/repo',
      projectLabel: undefined
    })

    broker.respond(request.id, { action: 'approve' })
    await expect(pending).resolves.toEqual({ action: 'approve' })
  })

  it('throws for unknown response ids', () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    expect(() => broker.respond('missing', { action: 'decline' })).toThrow(
      'Unknown approval request: missing'
    )
  })

  it('only accepts command actions advertised by the app server', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'command',
      params: { availableDecisions: ['accept', 'decline', 'cancel'], command: 'npm test' }
    })
    const request = listener.mock.calls[0][0]

    expect(() => broker.respond(request.id, { action: 'approveForSession' })).toThrow(
      'Action approveForSession is not allowed for command'
    )
    broker.respond(request.id, { action: 'cancel' })
    await expect(pending).resolves.toEqual({ action: 'cancel' })

    const acceptOnly = broker.request({
      kind: 'command',
      params: { availableDecisions: ['accept'], command: 'npm test' }
    })
    const acceptOnlyRequest = listener.mock.calls[1][0]
    expect(() => broker.respond(acceptOnlyRequest.id, { action: 'decline' })).toThrow(
      'Action decline is not allowed for command'
    )
    expect(() => broker.respond(acceptOnlyRequest.id, { action: 'cancel' })).toThrow(
      'Action cancel is not allowed for command'
    )
    broker.respond(acceptOnlyRequest.id, { action: 'approve' })
    await expect(acceptOnly).resolves.toEqual({ action: 'approve' })
  })

  it('auto-cancels explicit empty or malformed command decision lists without publishing a card', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    broker.onRequest(listener)

    await expect(
      broker.request({
        kind: 'command',
        params: { availableDecisions: [], command: 'no-actions' }
      })
    ).resolves.toEqual({ action: 'cancel' })
    await expect(
      broker.request({
        kind: 'command',
        params: { availableDecisions: ['accept', { unknown: true }], command: 'malformed' }
      })
    ).resolves.toEqual({ action: 'cancel' })

    expect(listener).not.toHaveBeenCalled()
    expect(broker.getPendingCount()).toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('only accepts file session approval when the request includes a grant and visible changes', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)

    const withoutSessionGrant = broker.request({ kind: 'file-change', params: { reason: 'edit' } })
    const firstRequest = listener.mock.calls[0][0]
    expect(firstRequest.params.availableIntents).toEqual(['approve', 'decline', 'cancel'])
    expect(() => broker.respond(firstRequest.id, { action: 'approveForSession' })).toThrow(
      'Action approveForSession is not allowed for file-change'
    )
    broker.respond(firstRequest.id, { action: 'decline' })
    await expect(withoutSessionGrant).resolves.toEqual({ action: 'decline' })

    const withoutVisibleChanges = broker.request({
      kind: 'file-change',
      params: { grantRoot: '/repo/src', reason: 'edit', changes: [] }
    })
    const secondRequest = listener.mock.calls[1][0]
    expect(secondRequest.params.availableIntents).toEqual(['approve', 'decline', 'cancel'])
    expect(() => broker.respond(secondRequest.id, { action: 'approveForSession' })).toThrow(
      'Action approveForSession is not allowed for file-change'
    )
    broker.respond(secondRequest.id, { action: 'cancel' })
    await expect(withoutVisibleChanges).resolves.toEqual({ action: 'cancel' })

    const withSessionGrant = broker.request({
      kind: 'file-change',
      params: {
        grantRoot: '/repo/src',
        reason: 'edit',
        changes: [{ path: '/repo/src/example.ts', kind: { type: 'update', move_path: null } }]
      }
    })
    const thirdRequest = listener.mock.calls[2][0]
    expect(thirdRequest.params.availableIntents).toEqual([
      'approve',
      'decline',
      'cancel',
      'approveForSession'
    ])
    broker.respond(thirdRequest.id, { action: 'approveForSession' })
    await expect(withSessionGrant).resolves.toEqual({ action: 'approveForSession' })
  })

  it('requires a complete answer for every requested tool question', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'tool-user-input',
      params: {
        questions: [
          { id: 'target', header: 'Target', question: 'Where?', options: [] },
          { id: 'token', header: 'Token', question: 'Which token?', options: [] }
        ]
      }
    })
    const request = listener.mock.calls[0][0]

    expect(() =>
      broker.respond(request.id, { action: 'answer', answers: { target: ['local'] } })
    ).toThrow('Tool input answers must include a response for every requested question')
    broker.respond(request.id, { action: 'decline' })
    await expect(pending).resolves.toEqual({ action: 'decline' })
  })

  it('allows only validated submissions for typed MCP forms', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'mcp-elicitation',
      params: {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: { region: { type: 'string', enum: ['us-east-1', 'eu-west-1'] } },
          required: ['region']
        }
      }
    })
    const request = listener.mock.calls[0][0]

    expect(() => broker.respond(request.id, { action: 'approve' })).toThrow(
      'MCP form requests must be submitted with their form values'
    )
    expect(() =>
      broker.respond(request.id, { action: 'submitMcpForm', values: { region: 'invalid' } })
    ).toThrow('region has an invalid option')

    broker.respond(request.id, { action: 'submitMcpForm', values: { region: 'eu-west-1' } })
    await expect(pending).resolves.toEqual({
      action: 'submitMcpForm',
      values: { region: 'eu-west-1' }
    })
  })

  it('fails closed for unsupported MCP forms', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({ kind: 'mcp-elicitation', params: { mode: 'openai/form' } })
    const request = listener.mock.calls[0][0]

    expect(() => broker.respond(request.id, { action: 'approve' })).toThrow(
      'MCP form requests must be submitted with their form values'
    )
    broker.respond(request.id, { action: 'cancel' })
    await expect(pending).resolves.toEqual({ action: 'cancel' })
  })

  it('fails closed for invalid MCP URLs even when a renderer forges approval', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'mcp-elicitation',
      params: { elicitationId: 'request-1', mode: 'url', url: 'file:///private/token' }
    })
    const request = listener.mock.calls[0][0]

    expect(request.params).toMatchObject({ mode: 'url', url: '' })
    expect(() => broker.respond(request.id, { action: 'approve' })).toThrow(
      'Invalid MCP URL requests can only be declined'
    )
    broker.respond(request.id, { action: 'decline' })
    await expect(pending).resolves.toEqual({ action: 'decline' })
  })

  it('accepts approve, decline, or cancel for a valid MCP URL request', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'mcp-elicitation',
      params: { elicitationId: 'request-1', mode: 'url', url: 'https://example.com/sign-in' }
    })
    const request = listener.mock.calls[0][0]

    broker.respond(request.id, { action: 'cancel' })
    await expect(pending).resolves.toEqual({ action: 'cancel' })
  })

  it('rejects pending approvals on shutdown', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const pending = broker.request({ kind: 'file-change', params: { reason: 'edit' } })
    broker.rejectAll(new Error('stopping'))
    await expect(pending).rejects.toThrow('stopping')
  })

  it('rejects one pending approval and notifies the UI settlement listener', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const created = vi.fn()
    const settled = vi.fn()
    broker.onSettled(settled)
    const pending = broker.request({ kind: 'command', params: { command: 'pwd' } }, created)
    const requestId = created.mock.calls[0]?.[0]

    expect(broker.reject(requestId, new Error('turn stopped'))).toBe(true)
    expect(broker.reject(requestId, new Error('duplicate'))).toBe(false)
    await expect(pending).rejects.toThrow('turn stopped')
    expect(settled).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledWith(requestId)
  })

  it('fails closed when an approval times out', async () => {
    vi.useFakeTimers()
    const broker = new CodexApprovalBroker({ timeoutMs: 100 })
    const pending = broker.request({ kind: 'command', params: { command: 'pwd' } })

    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual({ action: 'cancel' })
    vi.useRealTimers()
  })

  it('auto-resolves tool input exactly once at the Main-owned deadline', async () => {
    vi.useFakeTimers()
    try {
      const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
      const listener = vi.fn()
      broker.onRequest(listener)
      const pending = broker.request({
        kind: 'tool-user-input',
        params: {
          startedAtMs: Date.now() - 1_000,
          autoResolutionMs: 3_000,
          questions: [{ id: 'target', header: 'Target', question: 'Where?' }]
        }
      })
      const request = listener.mock.calls[0][0]
      expect(request.params.deadlineAtMs).toBe((request.params.startedAtMs ?? 0) + 3_000)

      await vi.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toEqual({ action: 'answer', answers: {} })
      expect(broker.getPendingCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(broker.getPendingCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('snoozes auto-resolution once without resetting its deadline', async () => {
    vi.useFakeTimers()
    try {
      const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
      const listener = vi.fn()
      broker.onRequest(listener)
      const pending = broker.request({
        kind: 'tool-user-input',
        params: {
          autoResolutionMs: 3_000,
          questions: [{ id: 'target', header: 'Target', question: 'Where?' }]
        }
      })
      const request = listener.mock.calls[0][0]
      await vi.advanceTimersByTimeAsync(1_000)
      expect(broker.snoozeAutoResolution(request.id)).toBe(true)
      expect(broker.snoozeAutoResolution(request.id)).toBe(false)
      expect(broker.listPendingApprovals()[0]?.params).toMatchObject({
        autoResolutionSnoozed: true
      })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(broker.getPendingCount()).toBe(0)
      await expect(pending).resolves.toMatchObject({
        action: 'decline',
        reason: 'Approval timed out'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts only scope intent for a fully explained permission request', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)
    const pending = broker.request({
      kind: 'permission-request',
      params: { permissions: { network: { enabled: true }, fileSystem: null } }
    })
    const request = listener.mock.calls[0][0]
    expect(() => broker.respond(request.id, { action: 'approve' })).toThrow(
      'Action approve is not allowed for permission-request'
    )
    broker.respond(request.id, { action: 'approvePermissions', scope: 'session' })
    await expect(pending).resolves.toEqual({ action: 'approvePermissions', scope: 'session' })
  })
})
