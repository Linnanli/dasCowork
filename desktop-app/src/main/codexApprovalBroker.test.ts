import { describe, expect, it, vi } from 'vitest'

import { CodexApprovalBroker } from './codexApprovalBroker'

describe('CodexApprovalBroker', () => {
  it('publishes and resolves approval requests', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const listener = vi.fn()
    broker.onRequest(listener)

    const pending = broker.request({ kind: 'command', params: { command: 'pwd' } })
    const request = listener.mock.calls[0][0]

    expect(request.kind).toBe('command')
    expect(request.params).toEqual({ command: 'pwd' })

    broker.respond(request.id, { action: 'approve' })
    await expect(pending).resolves.toEqual({ action: 'approve' })
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

  it('rejects pending approvals on shutdown', async () => {
    const broker = new CodexApprovalBroker({ timeoutMs: 30_000 })
    const pending = broker.request({ kind: 'file-change', params: { reason: 'edit' } })
    broker.rejectAll(new Error('stopping'))
    await expect(pending).rejects.toThrow('stopping')
  })

  it('fails closed when an approval times out', async () => {
    vi.useFakeTimers()
    const broker = new CodexApprovalBroker({ timeoutMs: 100 })
    const pending = broker.request({ kind: 'command', params: { command: 'pwd' } })

    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual({
      action: 'decline',
      reason: 'Approval timed out'
    })
    vi.useRealTimers()
  })
})
