import { describe, expect, it, vi } from 'vitest'

import {
  TERMINAL_REPLAY_TAIL_MAX_CHARACTERS,
  TERMINAL_WORKSPACE_API_VERSION,
  type TerminalWorkspaceAttachRequest,
  type TerminalWorkspaceCreateRequest
} from '../../shared/terminalWorkspaceApi'
import type { TerminalBackend, TerminalExit } from './TerminalBackend'
import { TerminalSessionManager } from './TerminalSessionManager'

class FakeTerminalBackend implements TerminalBackend {
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly dispose = vi.fn()
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: TerminalExit) => void>()
  private errorListeners = new Set<(error: Error) => void>()
  private connectionLostListeners = new Set<(error: Error) => void>()

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: (event: TerminalExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(event: TerminalExit): void {
    for (const listener of this.exitListeners) listener(event)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }

  onConnectionLost(listener: (error: Error) => void): () => void {
    this.connectionLostListeners.add(listener)
    return () => this.connectionLostListeners.delete(listener)
  }

  emitConnectionLost(error: Error): void {
    for (const listener of this.connectionLostListeners) listener(error)
  }
}

const owner = 42

function createManager(backends: FakeTerminalBackend[], spawn = vi.fn()): TerminalSessionManager {
  return new TerminalSessionManager({
    resolveExecutionTarget: vi.fn(async () => ({ hostId: 'local', cwd: '/repo' })),
    createBackend: (input) => {
      spawn(input)
      const backend = new FakeTerminalBackend()
      backends.push(backend)
      return backend
    },
    now: () => new Date('2026-08-08T00:00:00.000Z')
  })
}

function createRequest(
  sessionId = 'terminal-one',
  conversationId = 'conversation-one'
): TerminalWorkspaceCreateRequest {
  return {
    version: TERMINAL_WORKSPACE_API_VERSION,
    sessionId,
    workspaceId: conversationId,
    target: { conversationId, threadId: `${conversationId}-thread` },
    cols: 100,
    rows: 30
  } as const
}

function attachRequest(
  sessionId = 'terminal-one',
  conversationId = 'conversation-one'
): TerminalWorkspaceAttachRequest {
  return {
    version: TERMINAL_WORKSPACE_API_VERSION,
    sessionId,
    workspaceId: conversationId,
    target: { conversationId, threadId: `${conversationId}-thread` },
    viewId: `view-${sessionId}`
  } as const
}

describe('TerminalSessionManager', () => {
  it('uses ack-only write and resize responses while retaining a bounded replay tail', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest(), owner)
    const backend = backends[0]
    backend.emitData('x'.repeat(10 * 1024 * 1024))

    await expect(
      manager.write({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', data: 'echo ok\r' }, owner)
    ).resolves.toEqual({ accepted: true })
    await expect(
      manager.resize(
        { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', cols: 120, rows: 40 },
        owner
      )
    ).resolves.toEqual({ accepted: true })
    expect(manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner)).toMatchObject({
      truncated: true,
      output: 'x'.repeat(TERMINAL_REPLAY_TAIL_MAX_CHARACTERS)
    })
  })

  it('falls back to an existing task session and atomically rekeys it without another spawn', async () => {
    const backends: FakeTerminalBackend[] = []
    const spawn = vi.fn()
    const manager = createManager(backends, spawn)
    await manager.create(createRequest('terminal-one'), owner)

    const attached = await manager.attach(
      {
        ...attachRequest('missing-session'),
        viewId: 'view-one',
        allowConversationFallback: true,
        nextSessionId: 'terminal-restored'
      },
      owner
    )

    expect(attached.sessionId).toBe('terminal-restored')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(() => manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner)).toThrow(
      'unavailable'
    )
    expect(manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-restored' }, owner).session.sessionId).toBe(
      'terminal-restored'
    )
  })

  it('re-resolves cwd in main and restarts the backend when attach explicitly requests cwd sync', async () => {
    const backends: FakeTerminalBackend[] = []
    const resolveExecutionTarget = vi
      .fn()
      .mockResolvedValueOnce({ hostId: 'local', cwd: '/repo/initial' })
      .mockResolvedValueOnce({ hostId: 'local', cwd: '/repo/current' })
    const manager = new TerminalSessionManager({
      resolveExecutionTarget,
      createBackend: () => {
        const backend = new FakeTerminalBackend()
        backends.push(backend)
        return backend
      }
    })
    await manager.create(createRequest(), owner)

    const attached = await manager.attach(
      { ...attachRequest(), forceCwdSync: true },
      owner
    )

    expect(attached.cwd).toBe('/repo/current')
    expect(resolveExecutionTarget).toHaveBeenCalledTimes(2)
    expect(backends).toHaveLength(2)
    expect(backends[0].dispose).toHaveBeenCalledOnce()
  })

  it('recomputes the main-owned shell when cwd sync observes a target terminal command change', async () => {
    const spawn = vi.fn()
    const resolveExecutionTarget = vi
      .fn()
      .mockResolvedValueOnce({ hostId: 'remote-host', cwd: '/repo/initial' })
      .mockResolvedValueOnce({ hostId: 'remote-host', cwd: '/repo/current', terminalCommand: '/bin/fish' })
    const manager = new TerminalSessionManager({
      resolveExecutionTarget,
      createBackend: (input) => {
        spawn(input)
        return new FakeTerminalBackend()
      }
    })
    await manager.create(createRequest(), owner)

    await manager.attach({ ...attachRequest(), forceCwdSync: true }, owner)

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ shell: expect.objectContaining({ shell: '/bin/sh', kind: 'posix' }) })
    )
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ shell: expect.objectContaining({ shell: '/bin/fish', kind: 'posix' }) })
    )
  })

  it('uses a host terminal command before the app command and renderer shell preference', async () => {
    const spawn = vi.fn()
    const manager = new TerminalSessionManager({
      appTerminalCommand: '/bin/bash',
      resolveExecutionTarget: vi.fn(async () => ({
        hostId: 'remote-host',
        cwd: '/repo',
        terminalCommand: '/bin/fish'
      })),
      createBackend: (input) => {
        spawn(input)
        return new FakeTerminalBackend()
      }
    })

    await manager.create({ ...createRequest(), shellId: 'default' }, owner)

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ shell: expect.objectContaining({ shell: '/bin/fish' }) })
    )
  })

  it('uses a remote POSIX default instead of local platform shell settings', async () => {
    const spawn = vi.fn()
    const manager = new TerminalSessionManager({
      appTerminalCommand: 'powershell.exe',
      resolveExecutionTarget: vi.fn(async () => ({ hostId: 'remote-host', cwd: '/repo' })),
      createBackend: (input) => {
        spawn(input)
        return new FakeTerminalBackend()
      }
    })

    await manager.create(createRequest(), owner)

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        shell: expect.objectContaining({ shell: '/bin/sh', args: ['-l'], kind: 'posix' })
      })
    )
  })

  it('rejects explicit remote Windows shell commands instead of sending them to a POSIX host', async () => {
    const spawn = vi.fn()
    const manager = new TerminalSessionManager({
      appTerminalCommand: 'cmd.exe',
      resolveExecutionTarget: vi.fn(async () => ({
        hostId: 'remote-host',
        cwd: '/repo',
        terminalCommand: 'powershell.exe'
      })),
      createBackend: (input) => {
        spawn(input)
        return new FakeTerminalBackend()
      }
    })

    await expect(manager.create(createRequest(), owner)).rejects.toThrow(
      'Remote terminal requires POSIX shell.'
    )

    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['cmd', 'command.com', 'powershell', 'pwsh', 'wsl', 'custom.exe'])(
    'rejects remote non-POSIX shell command %s',
    async (terminalCommand) => {
      const spawn = vi.fn()
      const manager = new TerminalSessionManager({
        resolveExecutionTarget: vi.fn(async () => ({
          hostId: 'remote-host',
          cwd: '/repo',
          terminalCommand
        })),
        createBackend: (input) => {
          spawn(input)
          return new FakeTerminalBackend()
        }
      })

      await expect(manager.create(createRequest(), owner)).rejects.toThrow(
        'Remote terminal requires POSIX shell.'
      )
      expect(spawn).not.toHaveBeenCalled()
    }
  )

  it('still rejects an unknown renderer shell id when a main-owned override is configured', async () => {
    const spawn = vi.fn()
    const manager = new TerminalSessionManager({
      appTerminalCommand: '/bin/bash',
      resolveExecutionTarget: vi.fn(async () => ({ hostId: 'local', cwd: '/repo' })),
      createBackend: (input) => {
        spawn(input)
        return new FakeTerminalBackend()
      }
    })

    await expect(
      manager.create({ ...createRequest(), shellId: 'renderer-arbitrary-path' }, owner)
    ).rejects.toThrow('unavailable')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('detaches without killing but terminates an interactive session when its owner window closes', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest(), owner)
    await manager.attach({ ...attachRequest(), viewId: 'view-one' }, owner)

    expect(manager.detach({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', viewId: 'view-one' }, owner)).toEqual({
      accepted: true
    })
    expect(backends[0].dispose).not.toHaveBeenCalled()
    await manager.closeOwner(owner)
    expect(backends[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('never allows a different window to attach, write, or read a terminal', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest(), owner)

    await expect(manager.attach({ ...attachRequest(), viewId: 'other' }, owner + 1)).rejects.toThrow('another window')
    await expect(
      manager.write({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', data: 'id\r' }, owner + 1)
    ).rejects.toThrow('another window')
    expect(() => manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner + 1)).toThrow(
      'another window'
    )
  })

  it('only lets the owner bound to the running conversation read thread terminal output', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest(), owner)
    backends[0].emitData('owner-only')
    manager.bindThread('conversation-one', 'thread-one')

    expect(manager.readThreadTerminal('thread-one')).toEqual({ terminalAttached: false })
    manager.bindConversationOwner('conversation-one', owner + 1)
    expect(manager.readThreadTerminal('thread-one')).toEqual({ terminalAttached: false })
    manager.bindConversationOwner('conversation-one', owner)
    expect(manager.readThreadTerminal('thread-one')).toMatchObject({
      terminalAttached: true,
      sessionId: 'terminal-one',
      output: 'owner-only'
    })
  })

  it('keeps error and fast exit metadata observable through the exited tombstone', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest(), owner)
    backends[0].emitData('ready')
    backends[0].emitExit({ exitCode: 7, signal: null })
    await vi.waitFor(() =>
      expect(manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner).session).toMatchObject({
        status: 'exited',
        exitCode: 7
      })
    )
  })

  it('restarts one session serially for actions instead of writing action text into the interactive backend', async () => {
    const backends: FakeTerminalBackend[] = []
    const spawn = vi.fn()
    const manager = createManager(backends, spawn)
    await manager.create(createRequest(), owner)

    await Promise.all([
      manager.runAction(
        { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', command: 'first', title: 'First' },
        owner
      ),
      manager.runAction(
        { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', command: 'second', title: 'Second' },
        owner
      )
    ])

    expect(spawn).toHaveBeenCalledTimes(3)
    expect(spawn.mock.calls.map(([input]) => input.actionCommand)).toEqual([undefined, 'first', 'second'])
    expect(backends[0].write).not.toHaveBeenCalled()
    expect(backends[0].dispose).toHaveBeenCalledTimes(1)
    expect(backends[1].dispose).toHaveBeenCalledTimes(1)
    expect(
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner).session
    ).toMatchObject({ purpose: 'action', fixedTitle: 'Second' })
  })

  it('serializes a manual restart behind an in-flight action restart', async () => {
    const backends: FakeTerminalBackend[] = []
    const spawn = vi.fn()
    let resolveActionBackend!: () => void
    const manager = new TerminalSessionManager({
      resolveExecutionTarget: vi.fn(async () => ({ hostId: 'local', cwd: '/repo' })),
      createBackend: (input) => {
        spawn(input)
        const backend = new FakeTerminalBackend()
        backends.push(backend)
        if (input.actionCommand) {
          return new Promise<TerminalBackend>((resolve) => {
            resolveActionBackend = () => resolve(backend)
          })
        }
        return backend
      }
    })
    await manager.create(createRequest(), owner)

    const action = manager.runAction(
      {
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-one',
        command: 'first',
        title: 'First'
      },
      owner
    )
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    const restart = manager.restart(
      { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one', reason: 'manual' },
      owner
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(spawn).toHaveBeenCalledTimes(2)
    resolveActionBackend()
    await Promise.all([action, restart])

    expect(spawn.mock.calls.map(([input]) => input.actionCommand)).toEqual([
      undefined,
      'first',
      undefined
    ])
    expect(backends[0].dispose).toHaveBeenCalledOnce()
    expect(backends[1].dispose).toHaveBeenCalledOnce()
    expect(backends[2].dispose).not.toHaveBeenCalled()
  })

  it('serializes forced cwd sync behind an in-flight action restart', async () => {
    const backends: FakeTerminalBackend[] = []
    const spawn = vi.fn()
    let resolveActionBackend!: () => void
    const resolveExecutionTarget = vi
      .fn()
      .mockResolvedValueOnce({ hostId: 'local', cwd: '/repo/initial' })
      .mockResolvedValueOnce({ hostId: 'local', cwd: '/repo/current' })
    const manager = new TerminalSessionManager({
      resolveExecutionTarget,
      createBackend: (input) => {
        spawn(input)
        const backend = new FakeTerminalBackend()
        backends.push(backend)
        if (input.actionCommand) {
          return new Promise<TerminalBackend>((resolve) => {
            resolveActionBackend = () => resolve(backend)
          })
        }
        return backend
      }
    })
    await manager.create(createRequest(), owner)

    const action = manager.runAction(
      {
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-one',
        command: 'first',
        title: 'First'
      },
      owner
    )
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    const attach = manager.attach({ ...attachRequest(), forceCwdSync: true }, owner)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(resolveExecutionTarget).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(2)
    resolveActionBackend()
    const [, attached] = await Promise.all([action, attach])

    expect(attached.cwd).toBe('/repo/current')
    expect(spawn.mock.calls.map(([input]) => input.actionCommand)).toEqual([
      undefined,
      'first',
      undefined
    ])
    expect(backends[0].dispose).toHaveBeenCalledOnce()
    expect(backends[1].dispose).toHaveBeenCalledOnce()
    expect(backends[2].dispose).not.toHaveBeenCalled()
  })

  it('keeps the output tail but marks a remote transport failure as connection-lost', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = new TerminalSessionManager({
      resolveExecutionTarget: vi.fn(async () => ({ hostId: 'remote-host', cwd: '/remote/repo' })),
      createBackend: () => {
        const backend = new FakeTerminalBackend()
        backends.push(backend)
        return backend
      }
    })
    await manager.create(createRequest(), owner)
    backends[0].emitData('before disconnect')
    backends[0].emitConnectionLost(new Error('ssh disconnected'))

    expect(manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner)).toMatchObject({
      session: { status: 'connection-lost', backendKind: 'remote-process' },
      output: 'before disconnect'
    })
    await vi.waitFor(() => expect(backends[0].dispose).toHaveBeenCalledOnce())
  })

  it('restarts exited, errored, and connection-lost sessions with a new backend', async () => {
    const backends: FakeTerminalBackend[] = []
    const spawn = vi.fn()
    const manager = createManager(backends, spawn)

    await manager.create(createRequest('terminal-exited'), owner)
    backends[0].emitExit({ exitCode: 1, signal: null })
    await manager.restart(
      { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-exited', reason: 'retry' },
      owner
    )

    await manager.create(createRequest('terminal-error'), owner)
    backends[2].emitError(new Error('spawn failed later'))
    await vi.waitFor(() => expect(backends[2].dispose).toHaveBeenCalledOnce())
    await manager.restart(
      { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-error', reason: 'retry' },
      owner
    )

    await manager.create(createRequest('terminal-lost'), owner)
    backends[4].emitConnectionLost(new Error('transport lost'))
    await vi.waitFor(() => expect(backends[4].dispose).toHaveBeenCalledOnce())
    await manager.restart(
      { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-lost', reason: 'retry' },
      owner
    )

    expect(spawn).toHaveBeenCalledTimes(6)
    const restartedExited = manager.getSnapshot(
      { version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-exited' },
      owner
    ).session
    expect(restartedExited.status).toBe('running')
    expect(restartedExited).not.toHaveProperty('exitCode')
    expect(restartedExited).not.toHaveProperty('signal')
    expect(
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-error' }, owner).session.status
    ).toBe('running')
    expect(
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-lost' }, owner).session.status
    ).toBe('running')
  })

  it('can close connection-lost sessions and does not count them against active capacity', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    for (let index = 0; index < 20; index += 1) {
      const sessionId = `lost-${index}`
      await manager.create(createRequest(sessionId), owner)
      backends[index].emitConnectionLost(new Error('transport lost'))
    }

    await manager.create(createRequest('replacement'), owner)
    await manager.close({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'lost-0' }, owner)

    expect(backends).toHaveLength(21)
    expect(
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'lost-0' }, owner).session.status
    ).toBe('exited')
  })

  it('prunes connection-lost and error tombstones with the bounded terminal history', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    for (let index = 0; index < 25; index += 1) {
      const sessionId = `terminal-${index}`
      await manager.create(createRequest(sessionId), owner)
      if (index % 2 === 0) backends[index].emitConnectionLost(new Error('transport lost'))
      else backends[index].emitError(new Error('backend error'))
    }

    await vi.waitFor(() =>
      expect(manager.list({ version: TERMINAL_WORKSPACE_API_VERSION }, owner).sessions).toHaveLength(20)
    )
    expect(() =>
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-0' }, owner)
    ).toThrow('unavailable')
  })

  it('closes all task sessions when the archived thread id maps back to its conversation', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    await manager.create(createRequest('terminal-one', 'conversation-one'), owner)
    manager.bindThread('conversation-one', 'thread-one')

    await manager.closeForConversation('thread-one')

    expect(backends[0].dispose).toHaveBeenCalledOnce()
    expect(
      manager.getSnapshot({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId: 'terminal-one' }, owner).session.status
    ).toBe('exited')
  })

  it('bounds exited tombstones during 100 rapid create/close cycles', async () => {
    const backends: FakeTerminalBackend[] = []
    const manager = createManager(backends)
    for (let index = 0; index < 100; index += 1) {
      const sessionId = `terminal-${index}`
      await manager.create(createRequest(sessionId), owner)
      await manager.close({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId }, owner)
    }

    const listed = manager.list({ version: TERMINAL_WORKSPACE_API_VERSION }, owner)
    expect(listed.sessions).toHaveLength(20)
    expect(backends).toHaveLength(100)
    expect(backends.every((backend) => backend.dispose.mock.calls.length === 1)).toBe(true)
  })
})
