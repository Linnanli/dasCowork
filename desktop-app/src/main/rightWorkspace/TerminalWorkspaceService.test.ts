import { describe, expect, it, vi } from 'vitest'

import { TERMINAL_WORKSPACE_API_VERSION } from '../../shared/terminalWorkspaceApi'
import { TerminalWorkspaceService, type TerminalProcessAdapter } from './TerminalWorkspaceService'

class FakeTerminalProcess implements TerminalProcessAdapter {
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly kill = vi.fn()
  private dataHandler: TerminalDataHandler | null = null
  private exitHandler: TerminalExitHandler | null = null

  onData(listener: TerminalDataHandler): void {
    this.dataHandler = listener
  }

  onExit(listener: TerminalExitHandler): void {
    this.exitHandler = listener
  }

  emitData(data: string): void {
    this.dataHandler?.(data)
  }

  emitExit(code: number | null, signal: string | null): void {
    this.exitHandler?.(code, signal)
  }
}

type TerminalDataHandler = (data: string) => void
type TerminalExitHandler = (exitCode: number | null, signal: string | null) => void

describe('TerminalWorkspaceService', () => {
  it('tracks lifecycle through an injected process adapter', () => {
    const process = new FakeTerminalProcess()
    const events: unknown[] = []
    const service = new TerminalWorkspaceService({
      createId: () => 'terminal-1',
      now: () => new Date('2026-08-01T00:00:00.000Z'),
      resolveStartOptions: vi.fn(() => ({ cwd: '/repo', shell: '/bin/zsh', args: ['-l'] })),
      spawnTerminal: vi.fn(() => process)
    })
    service.onEvent((event) => events.push(event))

    expect(
      service.create({
        version: TERMINAL_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        cols: 100,
        rows: 30
      })
    ).toMatchObject({
      sessionId: 'terminal-1',
      workspaceId: 'workspace-1',
      status: 'running',
      cwd: '/repo',
      shell: '/bin/zsh',
      cols: 100,
      rows: 30
    })

    service.write({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId: 'terminal-1',
      data: 'ls\r'
    })
    expect(process.write).toHaveBeenCalledWith('ls\r')

    expect(
      service.resize({
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-1',
        cols: 120,
        rows: 40
      })
    ).toMatchObject({ cols: 120, rows: 40 })
    expect(process.resize).toHaveBeenCalledWith(120, 40)

    process.emitData('output')
    process.emitExit(0, null)

    expect(service.list({ version: TERMINAL_WORKSPACE_API_VERSION })).toMatchObject({
      sessions: [{ sessionId: 'terminal-1', status: 'exited', exitCode: 0, scrollback: 'output' }]
    })
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'created',
      'updated',
      'data',
      'exited'
    ])
  })

  it('can reserve a session before a spawn adapter is wired', () => {
    const service = new TerminalWorkspaceService({
      createId: () => 'terminal-1',
      now: () => new Date('2026-08-01T00:00:00.000Z')
    })

    expect(
      service.create({
        version: TERMINAL_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1'
      })
    ).toMatchObject({ status: 'starting' })
  })
})
