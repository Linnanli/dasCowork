// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const xterm = vi.hoisted(() => {
  const instances: InstanceType<typeof MockTerminal>[] = []
  class MockTerminal {
    static instances = instances
    cols = 100
    rows = 30
    options: Record<string, unknown> = {}
    buffer = { active: { viewportY: 0, baseY: 0, getLine: vi.fn() } }
    writes: string[] = []
    reset = vi.fn()
    write = vi.fn((data: string, callback?: () => void) => {
      this.writes.push(data)
      callback?.()
    })
    scrollToBottom = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    refresh = vi.fn()
    loadAddon = vi.fn()
    dataHandler: ((data: string) => void) | undefined
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler
      return { dispose: vi.fn() }
    })
    onTitleChange = vi.fn(() => ({ dispose: vi.fn() }))
    attachCustomKeyEventHandler = vi.fn()
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }))
    getSelection = vi.fn(() => '')
    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }
  }
  return { MockTerminal, instances }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.MockTerminal }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

import { refitTerminalWorkspace, registerTerminalWorkspaceFitter } from './terminalWorkspaceMove'
import { TerminalWorkspace } from './TerminalWorkspace'
import { resetTerminalSessionStoreForTests } from './terminalSessionStore'
import type {
  TerminalWorkspaceEvent,
  TerminalWorkspaceSessionSnapshot
} from '../../../../../shared/terminalWorkspaceApi'

afterEach(() => vi.unstubAllGlobals())

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  xterm.instances.length = 0
  resetTerminalSessionStoreForTests()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TerminalWorkspace move lifecycle', () => {
  it('fits the live terminal on the next frame without creating a new session', async () => {
    const fit = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const unregister = registerTerminalWorkspaceFitter('terminal:one', fit)

    await refitTerminalWorkspace('terminal:one')

    expect(fit).toHaveBeenCalledTimes(1)
    unregister()
  })
})

describe('TerminalWorkspace session lifecycle', () => {
  it('subscribes before attach, falls back to create, and detaches on unmount', async () => {
    const calls: string[] = []
    const attach = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push('attach')
        throw new Error('Terminal session is unavailable')
      })
      .mockImplementationOnce(async () => {
        calls.push('attach')
        return sampleSession({ sessionId: 'one' })
      })
    const create = vi.fn(async () => {
      calls.push('create')
      return sampleSession({ sessionId: 'one' })
    })
    const detach = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', desktopAppMock({ attach, create, detach, calls }))

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1', threadId: 'thread-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })

    expect(calls[0]).toBe('subscribe')
    expect(calls).toEqual(['subscribe', 'attach', 'create', 'attach'])
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        sessionId: 'one',
        viewId: 'terminal:one:view',
        allowConversationFallback: false,
        forceCwdSync: true
      })
    )
    expect(attach.mock.calls[0]?.[0]).not.toHaveProperty('nextSessionId')
    expect(container.querySelector('button[aria-label="终端偏好"]')).not.toBeNull()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        sessionId: 'one',
        workspaceId: 'workspace-1',
        target: { conversationId: 'conversation-1', threadId: 'thread-1' }
      })
    )

    await act(async () => root.unmount())
    expect(detach).toHaveBeenCalledWith({
      version: 2,
      sessionId: 'one',
      viewId: 'terminal:one:view'
    })
  })

  it('applies init replay once and later writes only data increments', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    vi.stubGlobal(
      'desktopApp',
      desktopAppMock({
        attach: vi.fn(async () => sampleSession({ sessionId: 'one' })),
        onEvent: vi.fn((callback) => {
          listener = callback
          return () => undefined
        })
      })
    )

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })

    const terminal = xterm.instances[0]
    await act(async () => {
      listener?.({
        version: 2,
        type: 'init',
        session: sampleSession({ sessionId: 'one' }),
        output: 'hello',
        truncated: false
      })
      listener?.({
        version: 2,
        type: 'init',
        session: sampleSession({ sessionId: 'one' }),
        output: 'hello',
        truncated: false
      })
      listener?.({ version: 2, type: 'data', sessionId: 'one', data: '!', sequence: 1 })
    })

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(terminal.writes).toEqual(['hello', '!'])
  })

  it('does not force the viewport back to the bottom while the user is reading scrollback', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    vi.stubGlobal(
      'desktopApp',
      desktopAppMock({
        onEvent: vi.fn((callback) => {
          listener = callback
          return () => undefined
        })
      })
    )
    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })
    const terminal = xterm.instances[0]
    terminal.buffer.active.baseY = 5
    terminal.buffer.active.viewportY = 0

    await act(async () => {
      listener?.({ version: 2, type: 'data', sessionId: 'one', data: 'new output', sequence: 1 })
    })

    expect(terminal.scrollToBottom).not.toHaveBeenCalled()
  })

  it('shows a retryable error when automatic terminal startup fails before a session exists', async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error('Terminal session is unavailable'))
      .mockRejectedValueOnce(new Error('Terminal session is unavailable'))
      .mockResolvedValueOnce(sampleSession({ sessionId: 'one' }))
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('node-pty unavailable'))
      .mockResolvedValueOnce(sampleSession({ sessionId: 'one' }))
    vi.stubGlobal('desktopApp', {
      environment: { platform: 'darwin' },
      codex: { openExternalHttpUrl: vi.fn(async () => undefined) },
      workspace: {
        files: { prepareRoot: vi.fn().mockResolvedValue({ rootId: 'workspace-1', label: 'repo' }) },
        terminal: {
          attach,
          create,
          detach: vi.fn().mockResolvedValue({ accepted: true }),
          onEvent: vi.fn(() => () => undefined),
          resize: vi.fn().mockResolvedValue({ accepted: true }),
          write: vi.fn().mockResolvedValue({ accepted: true }),
          setTitle: vi.fn().mockResolvedValue({ accepted: true })
        }
      }
    })

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1', threadId: 'thread-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })

    expect(container.textContent).toContain('node-pty unavailable')
    expect(
      [...container.querySelectorAll('button')].some((button) =>
        button.textContent?.includes('重试')
      )
    ).toBe(true)

    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('重试')
    )
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(attach).toHaveBeenCalledTimes(3)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('restarts an exited terminal through the main-owned restart API', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    const restart = vi.fn(async () => sampleSession({ sessionId: 'one', status: 'running' }))
    vi.stubGlobal(
      'desktopApp',
      desktopAppMock({
        attach: vi.fn(async () => sampleSession({ sessionId: 'one' })),
        restart,
        onEvent: vi.fn((callback) => {
          listener = callback
          return () => undefined
        })
      })
    )

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1', threadId: 'thread-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })
    const surface = container.querySelector('[data-slot="terminal-workspace-surface"]')
    const terminal = xterm.instances[0]
    await act(async () => {
      listener?.({
        version: 2,
        type: 'exit',
        session: sampleSession({ sessionId: 'one', status: 'exited', exitCode: 0 })
      })
    })
    expect(container.querySelector('[data-slot="terminal-workspace-surface"]')).toBe(surface)
    expect(terminal.dispose).not.toHaveBeenCalled()

    const restartButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('重新启动')
    )
    await act(async () => {
      restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(restart).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        sessionId: 'one',
        workspaceId: 'workspace-1',
        target: { conversationId: 'conversation-1', threadId: 'thread-1' },
        viewId: 'terminal:one:view',
        reason: 'retry'
      })
    )
  })

  it('restarts a lost terminal connection through the main-owned restart API', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    const restart = vi.fn(async () => sampleSession({ sessionId: 'one', status: 'running' }))
    vi.stubGlobal(
      'desktopApp',
      desktopAppMock({
        attach: vi.fn(async () => sampleSession({ sessionId: 'one' })),
        restart,
        onEvent: vi.fn((callback) => {
          listener = callback
          return () => undefined
        })
      })
    )

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })
    const surface = container.querySelector('[data-slot="terminal-workspace-surface"]')
    await act(async () => {
      listener?.({
        version: 2,
        type: 'status',
        session: sampleSession({ sessionId: 'one', status: 'connection-lost' })
      })
    })
    expect(container.querySelector('[data-slot="terminal-workspace-surface"]')).toBe(surface)

    const restartButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('重新启动')
    )
    await act(async () => {
      restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(restart).toHaveBeenCalledWith(expect.objectContaining({ reason: 'retry' }))
  })

  it('ignores input while the terminal is waiting for restart', async () => {
    let listener: ((event: TerminalWorkspaceEvent) => void) | undefined
    const write = vi.fn(async () => ({ accepted: true as const }))
    const restart = vi.fn(async () => sampleSession({ sessionId: 'one', status: 'running' }))
    vi.stubGlobal(
      'desktopApp',
      desktopAppMock({
        attach: vi.fn(async () => sampleSession({ sessionId: 'one' })),
        restart,
        write,
        onEvent: vi.fn((callback) => {
          listener = callback
          return () => undefined
        })
      })
    )

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })
    const terminal = xterm.instances[0]
    await act(async () => {
      listener?.({
        version: 2,
        type: 'status',
        session: sampleSession({ sessionId: 'one', status: 'connection-lost' })
      })
    })

    terminal.dataHandler?.('typed while disconnected')
    const restartButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('重新启动')
    )
    await act(async () => {
      restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(write).not.toHaveBeenCalled()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('deduplicates repeated resize events in the renderer', async () => {
    const resize = vi.fn(async () => ({ accepted: true as const }))
    vi.stubGlobal('desktopApp', desktopAppMock({ resize }))

    await act(async () => {
      root.render(
        createElement(TerminalWorkspace, {
          tab: { id: 'terminal:one', type: 'terminal', title: 'Terminal' },
          workspaceId: 'workspace-1',
          target: { conversationId: 'conversation-1' },
          onTitleChange: vi.fn(),
          onOpenTerminal: vi.fn()
        })
      )
    })
    const handler = xterm.instances[0].loadAddon.mock.calls[0]

    await refitTerminalWorkspace('terminal:one')
    await refitTerminalWorkspace('terminal:one')

    expect(handler).toBeDefined()
    expect(resize).toHaveBeenCalledTimes(1)
  })
})

function desktopAppMock(
  overrides: {
    attach?: ReturnType<typeof vi.fn>
    create?: ReturnType<typeof vi.fn>
    detach?: ReturnType<typeof vi.fn>
    resize?: ReturnType<typeof vi.fn>
    restart?: ReturnType<typeof vi.fn>
    write?: ReturnType<typeof vi.fn>
    onEvent?: (callback: (event: TerminalWorkspaceEvent) => void) => () => void
    calls?: string[]
  } = {}
): Record<string, unknown> {
  const calls = overrides.calls
  return {
    environment: { platform: 'darwin' },
    codex: { openExternalHttpUrl: vi.fn(async () => undefined) },
    workspace: {
      files: {
        prepareRoot: vi.fn(async () => ({ rootId: 'workspace-1', label: 'repo' }))
      },
      terminal: {
        attach: overrides.attach ?? vi.fn(async () => sampleSession({ sessionId: 'one' })),
        create: overrides.create ?? vi.fn(async () => sampleSession({ sessionId: 'one' })),
        detach: overrides.detach ?? vi.fn(async () => ({ accepted: true as const })),
        onEvent:
          overrides.onEvent ??
          vi.fn((callback: (event: TerminalWorkspaceEvent) => void) => {
            calls?.push('subscribe')
            void callback
            return () => undefined
          }),
        resize: overrides.resize ?? vi.fn(async () => ({ accepted: true as const })),
        restart: overrides.restart,
        write: overrides.write ?? vi.fn(async () => ({ accepted: true as const })),
        setTitle: vi.fn(async () => ({ accepted: true as const }))
      }
    }
  }
}

function sampleSession(
  overrides: Partial<TerminalWorkspaceSessionSnapshot>
): TerminalWorkspaceSessionSnapshot {
  return {
    sessionId: 'one',
    workspaceId: 'workspace-1',
    conversationId: 'conversation-1',
    threadId: 'thread-1',
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
