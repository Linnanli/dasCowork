// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  TerminalWorkspaceEvent,
  TerminalWorkspaceSessionSnapshot
} from '../../../../../shared/terminalWorkspaceApi'
import {
  attachOrCreateTerminalSession,
  closeTerminalSession,
  detachTerminalSession,
  resetTerminalSessionStoreForTests,
  resizeTerminalSession,
  runTerminalAction,
  subscribeTerminalSession,
  terminalSessionIdFromTabId,
  writeTerminalInput
} from './terminalSessionStore'

afterEach(() => {
  resetTerminalSessionStoreForTests()
  vi.unstubAllGlobals()
})

describe('terminalSessionStore', () => {
  it('derives a stable session id from terminal tab ids', () => {
    expect(terminalSessionIdFromTabId('terminal:abc')).toBe('abc')
    expect(terminalSessionIdFromTabId('file:abc')).toBeUndefined()
  })

  it('queues writes until attach/create marks the session attached, then flushes in order', async () => {
    const write = vi.fn(async () => ({ accepted: true as const }))
    const resize = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        files: { prepareRoot: vi.fn(async () => ({ rootId: 'workspace-1', label: 'repo' })) },
        terminal: {
          attach: vi.fn(async () => sampleSession('one')),
          create: vi.fn(async () => sampleSession('one')),
          onEvent: vi.fn(() => () => undefined),
          write,
          resize
        }
      }
    })
    subscribeTerminalSession('one', vi.fn())

    await writeTerminalInput('one', 'a')
    await writeTerminalInput('one', 'b')
    await resizeTerminalSession('one', 132, 43)
    expect(write).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()

    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })

    const writeCalls = write.mock.calls as unknown as [{ data: string }][]
    expect(writeCalls.map(([input]) => input.data)).toEqual(['a', 'b'])
    expect(resize).toHaveBeenCalledWith(expect.objectContaining({ cols: 132, rows: 43 }))
  })

  it('creates a missing session, attaches the view, then flushes queued startup input', async () => {
    const write = vi.fn(async () => ({ accepted: true as const }))
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error('Terminal session is unavailable'))
      .mockResolvedValueOnce(sampleSession('one'))
    const create = vi.fn(async () => sampleSession('one', { status: 'starting' }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          attach,
          create,
          onEvent: vi.fn(() => () => undefined),
          write,
          resize: vi.fn(async () => ({ accepted: true as const })),
          runAction: vi.fn(async () => ({ accepted: true as const }))
        }
      }
    })

    await writeTerminalInput('one', 'queued')
    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })

    expect(attach).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(1)
    expect(attach.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        sessionId: 'one',
        viewId: 'terminal:one:view',
        allowConversationFallback: false
      })
    )
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: 'queued' }))
  })

  it('does not fallback or rekey when a new terminal tab attaches a missing id', async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error('Terminal session is unavailable'))
      .mockResolvedValueOnce(sampleSession('two'))
    const create = vi.fn(async () => sampleSession('two', { status: 'starting' }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          attach,
          create,
          onEvent: vi.fn(() => () => undefined),
          write: vi.fn(async () => ({ accepted: true as const })),
          resize: vi.fn(async () => ({ accepted: true as const })),
          runAction: vi.fn(async () => ({ accepted: true as const }))
        }
      }
    })

    await attachOrCreateTerminalSession({
      sessionId: 'two',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:two:view',
      cols: 100,
      rows: 30
    })

    expect(attach.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        sessionId: 'two',
        allowConversationFallback: false
      })
    )
    expect(attach.mock.calls[0]?.[0]).not.toHaveProperty('nextSessionId')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'two' }))
  })

  it('only creates after an unavailable-session attach failure, not an ownership failure', async () => {
    const create = vi.fn()
    vi.stubGlobal('desktopApp', {
      workspace: {
        files: { prepareRoot: vi.fn() },
        terminal: {
          attach: vi.fn(async () => {
            throw new Error('Terminal session belongs to another window')
          }),
          create,
          onEvent: vi.fn(() => () => undefined)
        }
      }
    })

    await expect(
      attachOrCreateTerminalSession({
        sessionId: 'one',
        workspaceId: 'workspace-1',
        target: { conversationId: 'conversation-1' },
        viewId: 'terminal:one:view',
        cols: 100,
        rows: 30
      })
    ).rejects.toThrow('another window')
    expect(create).not.toHaveBeenCalled()
  })

  it('queues actions until attach and sends them to the main session in FIFO order', async () => {
    const runAction = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        files: { prepareRoot: vi.fn() },
        terminal: {
          attach: vi.fn(async () => sampleSession('one')),
          create: vi.fn(async () => sampleSession('one')),
          onEvent: vi.fn(() => () => undefined),
          write: vi.fn(async () => ({ accepted: true as const })),
          resize: vi.fn(async () => ({ accepted: true as const })),
          runAction
        }
      }
    })
    subscribeTerminalSession('one', vi.fn())
    const first = runTerminalAction('one', 'first', 'First')
    const second = runTerminalAction('one', 'second', 'Second')

    expect(runAction).not.toHaveBeenCalled()
    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })
    await Promise.all([first, second])

    const actionCalls = runAction.mock.calls as unknown as [{ command: string; title?: string }][]
    expect(actionCalls.map(([input]) => input.command)).toEqual(['first', 'second'])
    expect(actionCalls.map(([input]) => input.title)).toEqual(['First', 'Second'])
  })

  it('does not flush pending input, resize, or actions on a starting status event', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    const write = vi.fn(async () => ({ accepted: true as const }))
    const resize = vi.fn(async () => ({ accepted: true as const }))
    const runAction = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          onEvent: vi.fn((callback) => {
            listener = callback
            return () => undefined
          }),
          write,
          resize,
          runAction
        }
      }
    })
    subscribeTerminalSession('one', vi.fn())
    await writeTerminalInput('one', 'queued')
    await resizeTerminalSession('one', 120, 40)
    const action = runTerminalAction('one', 'queued-action')
    let actionSettled = false
    action.then(
      () => {
        actionSettled = true
      },
      () => {
        actionSettled = true
      }
    )

    listener?.({
      version: 2,
      type: 'status',
      session: sampleSession('one', { status: 'starting' })
    })
    await Promise.resolve()

    expect(write).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
    expect(actionSettled).toBe(false)
  })

  it('rejects pending actions and clears queued input when startup fails', async () => {
    const write = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          attach: vi.fn().mockRejectedValue(new Error('Terminal session is unavailable')),
          create: vi.fn().mockRejectedValue(new Error('node-pty unavailable')),
          onEvent: vi.fn(() => () => undefined),
          write,
          resize: vi.fn(async () => ({ accepted: true as const })),
          runAction: vi.fn(async () => ({ accepted: true as const }))
        }
      }
    })
    await writeTerminalInput('one', 'queued')
    const action = runTerminalAction('one', 'queued-action')

    await expect(
      attachOrCreateTerminalSession({
        sessionId: 'one',
        workspaceId: 'workspace-1',
        target: { conversationId: 'conversation-1' },
        viewId: 'terminal:one:view',
        cols: 100,
        rows: 30
      })
    ).rejects.toThrow('node-pty unavailable')
    await expect(action).rejects.toThrow('node-pty unavailable')

    vi.mocked(window.desktopApp.workspace.terminal.attach).mockResolvedValue(sampleSession('one'))
    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('revokes attachment and rejects pending actions on terminal failure events', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    const write = vi.fn(async () => ({ accepted: true as const }))
    const runAction = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          attach: vi.fn(async () => sampleSession('one')),
          create: vi.fn(async () => sampleSession('one')),
          onEvent: vi.fn((callback) => {
            listener = callback
            return () => undefined
          }),
          write,
          resize: vi.fn(async () => ({ accepted: true as const })),
          runAction
        }
      }
    })
    subscribeTerminalSession('one', vi.fn())
    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })
    await writeTerminalInput('one', 'sent')
    expect(write).toHaveBeenCalledTimes(1)

    listener?.({
      version: 2,
      type: 'exit',
      session: sampleSession('one', { status: 'exited', exitCode: 1 })
    })
    await writeTerminalInput('one', 'queued-after-exit')
    const action = runTerminalAction('one', 'action-after-exit')
    listener?.({
      version: 2,
      type: 'error',
      session: sampleSession('one', { status: 'error' }),
      message: 'backend failed'
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(runAction).not.toHaveBeenCalled()
    await expect(action).rejects.toThrow('error')
  })

  it('keeps pending actions across detach while dropping queued input and resize', async () => {
    const write = vi.fn(async () => ({ accepted: true as const }))
    const resize = vi.fn(async () => ({ accepted: true as const }))
    const runAction = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          attach: vi.fn(async () => sampleSession('one')),
          create: vi.fn(async () => sampleSession('one')),
          detach: vi.fn(async () => ({ accepted: true as const })),
          onEvent: vi.fn(() => () => undefined),
          write,
          resize,
          runAction
        }
      }
    })
    await writeTerminalInput('one', 'queued-input')
    await resizeTerminalSession('one', 120, 40)
    const action = runTerminalAction('one', 'queued-action', 'Queued')

    await detachTerminalSession({ sessionId: 'one', viewId: 'terminal:one:view' })
    await attachOrCreateTerminalSession({
      sessionId: 'one',
      workspaceId: 'workspace-1',
      target: { conversationId: 'conversation-1' },
      viewId: 'terminal:one:view',
      cols: 100,
      rows: 30
    })
    await action

    expect(write).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
    expect(runAction).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'queued-action', title: 'Queued' })
    )
  })

  it('rejects pending actions when a session is explicitly closed', async () => {
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          close: vi.fn(async () => sampleSession('one', { status: 'exited' }))
        }
      }
    })
    const action = runTerminalAction('one', 'queued-action')

    await closeTerminalSession('one')

    await expect(action).rejects.toThrow('closed')
  })

  it('rejects pending actions when explicit close fails', async () => {
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          close: vi.fn().mockRejectedValue(new Error('close failed'))
        }
      }
    })
    const action = runTerminalAction('one', 'queued-action')

    await expect(closeTerminalSession('one')).rejects.toThrow('close failed')
    await expect(action).rejects.toThrow('close failed')
  })

  it('fans out terminal events to session-specific listeners only', () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          onEvent: vi.fn((callback) => {
            listener = callback
            return () => undefined
          })
        }
      }
    })
    const one = vi.fn()
    const two = vi.fn()
    subscribeTerminalSession('one', one)
    subscribeTerminalSession('two', two)

    listener?.({ version: 2, type: 'data', sessionId: 'one', data: 'x', sequence: 1 })

    expect(one).toHaveBeenCalledTimes(1)
    expect(two).not.toHaveBeenCalled()
  })
})

function sampleSession(
  sessionId: string,
  overrides: Partial<TerminalWorkspaceSessionSnapshot> = {}
): TerminalWorkspaceSessionSnapshot {
  return {
    sessionId,
    workspaceId: 'workspace-1',
    conversationId: 'conversation-1',
    hostId: 'local',
    backendKind: 'local-pty',
    purpose: 'interactive',
    cwd: '/repo',
    shell: '/bin/zsh',
    shellKind: 'posix',
    title: 'Terminal',
    cols: 100,
    rows: 30,
    status: 'running',
    truncated: false,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides
  }
}
