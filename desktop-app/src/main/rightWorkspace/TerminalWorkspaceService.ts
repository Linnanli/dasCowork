import {
  TERMINAL_WORKSPACE_API_VERSION,
  terminalWorkspaceCreateRequestSchema,
  terminalWorkspaceKillRequestSchema,
  terminalWorkspaceListRequestSchema,
  terminalWorkspaceListResultSchema,
  terminalWorkspaceResizeRequestSchema,
  terminalWorkspaceSessionSnapshotSchema,
  terminalWorkspaceWriteRequestSchema,
  type TerminalWorkspaceCreateRequest,
  type TerminalWorkspaceEvent,
  type TerminalWorkspaceKillRequest,
  type TerminalWorkspaceListRequest,
  type TerminalWorkspaceListResult,
  type TerminalWorkspaceResizeRequest,
  type TerminalWorkspaceSessionSnapshot,
  type TerminalWorkspaceWriteRequest
} from '../../shared/terminalWorkspaceApi'

type TerminalExitHandler = (exitCode: number | null, signal: string | null) => void
type TerminalDataHandler = (data: string) => void

export type TerminalProcessAdapter = {
  write(data: string): void
  resize?(cols: number, rows: number): void
  kill(): void
  onData(listener: TerminalDataHandler): void
  onExit(listener: TerminalExitHandler): void
}

export type SpawnTerminalAdapter = (input: {
  shell?: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  cols: number
  rows: number
}) => TerminalProcessAdapter

export type TerminalWorkspaceStartOptions = {
  shell?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export type TerminalWorkspaceServiceDependencies = {
  spawnTerminal?: SpawnTerminalAdapter
  resolveStartOptions?: (workspaceId: string) => TerminalWorkspaceStartOptions
  now?: () => Date
  createId?: () => string
}

type TerminalRecord = {
  sessionId: string
  workspaceId: string
  cwd?: string
  shell?: string
  cols: number
  rows: number
  status: 'starting' | 'running' | 'exited'
  exitCode?: number | null
  signal?: string | null
  scrollback: string
  createdAt: string
  updatedAt: string
  process?: TerminalProcessAdapter
}

export class TerminalWorkspaceService {
  private readonly sessions = new Map<string, TerminalRecord>()
  private readonly listeners = new Set<(event: TerminalWorkspaceEvent) => void>()
  private nextId = 1

  constructor(private readonly dependencies: TerminalWorkspaceServiceDependencies = {}) {}

  onEvent(listener: (event: TerminalWorkspaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  create(input: TerminalWorkspaceCreateRequest): TerminalWorkspaceSessionSnapshot {
    const request = terminalWorkspaceCreateRequestSchema.parse(input)
    const startOptions = this.dependencies.resolveStartOptions?.(request.workspaceId) ?? {}
    const sessionId = this.dependencies.createId?.() ?? `terminal-${this.nextId++}`
    const timestamp = this.nowIso()
    const record: TerminalRecord = {
      sessionId,
      workspaceId: request.workspaceId,
      cwd: startOptions.cwd,
      shell: startOptions.shell,
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      status: this.dependencies.spawnTerminal ? 'running' : 'starting',
      scrollback: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }

    if (this.dependencies.spawnTerminal) {
      record.process = this.dependencies.spawnTerminal({
        shell: startOptions.shell,
        args: startOptions.args ?? [],
        cwd: startOptions.cwd,
        env: startOptions.env,
        cols: record.cols,
        rows: record.rows
      })
      record.process.onData((data) => {
        record.scrollback = trimScrollback(`${record.scrollback}${data}`)
        this.emit({ version: TERMINAL_WORKSPACE_API_VERSION, type: 'data', sessionId, data })
      })
      record.process.onExit((exitCode, signal) => this.markExited(sessionId, exitCode, signal))
    }

    this.sessions.set(sessionId, record)
    const snapshot = this.snapshot(record)
    this.emit({ version: TERMINAL_WORKSPACE_API_VERSION, type: 'created', session: snapshot })
    return snapshot
  }

  write(input: TerminalWorkspaceWriteRequest): TerminalWorkspaceSessionSnapshot {
    const request = terminalWorkspaceWriteRequestSchema.parse(input)
    const record = this.getLiveSession(request.sessionId)
    record.process?.write(request.data)
    return this.snapshot(record)
  }

  resize(input: TerminalWorkspaceResizeRequest): TerminalWorkspaceSessionSnapshot {
    const request = terminalWorkspaceResizeRequestSchema.parse(input)
    const record = this.getLiveSession(request.sessionId)
    record.cols = request.cols
    record.rows = request.rows
    record.updatedAt = this.nowIso()
    record.process?.resize?.(request.cols, request.rows)
    const snapshot = this.snapshot(record)
    this.emit({ version: TERMINAL_WORKSPACE_API_VERSION, type: 'updated', session: snapshot })
    return snapshot
  }

  kill(input: TerminalWorkspaceKillRequest): TerminalWorkspaceSessionSnapshot {
    const request = terminalWorkspaceKillRequestSchema.parse(input)
    const record = this.getSession(request.sessionId)
    if (record.status !== 'exited') {
      record.process?.kill()
      this.markExited(record.sessionId, record.exitCode ?? null, record.signal ?? 'SIGTERM')
    }
    return this.snapshot(record)
  }

  list(input: TerminalWorkspaceListRequest): TerminalWorkspaceListResult {
    const request = terminalWorkspaceListRequestSchema.parse(input)
    const sessions = [...this.sessions.values()]
      .filter((session) => !request.workspaceId || session.workspaceId === request.workspaceId)
      .map((session) => this.snapshot(session))

    return terminalWorkspaceListResultSchema.parse({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessions
    })
  }

  disposeWorkspace(workspaceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId || session.status === 'exited') continue
      session.process?.kill()
      this.markExited(session.sessionId, session.exitCode ?? null, session.signal ?? 'SIGTERM')
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'exited') continue
      session.process?.kill()
      this.markExited(session.sessionId, session.exitCode ?? null, session.signal ?? 'SIGTERM')
    }
    this.listeners.clear()
  }

  private getLiveSession(sessionId: string): TerminalRecord {
    const record = this.getSession(sessionId)
    if (record.status === 'exited') throw new Error('Terminal session has already exited')
    return record
  }

  private getSession(sessionId: string): TerminalRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error(`Unknown terminal session: ${sessionId}`)
    return record
  }

  private markExited(sessionId: string, exitCode: number | null, signal: string | null): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.status === 'exited') return
    record.status = 'exited'
    record.exitCode = exitCode
    record.signal = signal
    record.updatedAt = this.nowIso()
    const snapshot = this.snapshot(record)
    this.emit({ version: TERMINAL_WORKSPACE_API_VERSION, type: 'exited', session: snapshot })
  }

  private snapshot(record: TerminalRecord): TerminalWorkspaceSessionSnapshot {
    return terminalWorkspaceSessionSnapshotSchema.parse({
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      status: record.status,
      cwd: record.cwd,
      shell: record.shell,
      cols: record.cols,
      rows: record.rows,
      exitCode: record.exitCode,
      signal: record.signal,
      scrollback: record.scrollback,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })
  }

  private emit(event: TerminalWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private nowIso(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString()
  }
}

const MAX_TERMINAL_SCROLLBACK = 2_000_000

function trimScrollback(value: string): string {
  return value.length <= MAX_TERMINAL_SCROLLBACK
    ? value
    : value.slice(value.length - MAX_TERMINAL_SCROLLBACK)
}
