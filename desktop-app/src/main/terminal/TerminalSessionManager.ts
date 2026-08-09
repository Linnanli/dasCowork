import {
  TERMINAL_DATA_EVENT_MAX_CHARACTERS,
  TERMINAL_WORKSPACE_API_VERSION,
  terminalWorkspaceAttachRequestSchema,
  terminalWorkspaceCloseRequestSchema,
  terminalWorkspaceCreateRequestSchema,
  terminalWorkspaceDetachRequestSchema,
  terminalWorkspaceListResultSchema,
  terminalWorkspaceRestartRequestSchema,
  terminalWorkspaceRunActionRequestSchema,
  terminalWorkspaceSetTitleRequestSchema,
  terminalWorkspaceSnapshotRequestSchema,
  terminalWorkspaceSnapshotSchema,
  terminalWorkspaceWriteRequestSchema,
  terminalWorkspaceResizeRequestSchema,
  type TerminalWorkspaceAck,
  type TerminalWorkspaceAttachRequest,
  type TerminalWorkspaceCreateRequest,
  type TerminalWorkspaceEvent,
  type TerminalWorkspaceListRequest,
  type TerminalWorkspaceListResult,
  type TerminalWorkspaceRestartRequest,
  type TerminalWorkspaceSessionSnapshot,
  type TerminalWorkspaceSnapshot,
  type TerminalWorkspaceTarget
} from '../../shared/terminalWorkspaceApi'
import {
  configuredTerminalShell,
  resolveTerminalShell,
  type ResolvedTerminalShell
} from './terminalShellCatalog'
import { listTerminalShells } from './terminalShellCatalog'
import type { TerminalBackend, TerminalExit } from './TerminalBackend'
import { TerminalOutputBuffer } from './terminalOutputBuffer'

const MAX_SESSIONS_PER_CONVERSATION = 20
const MAX_SESSIONS_PER_OWNER = 50
const MAX_TOMBSTONES_PER_CONVERSATION = 20
const TOMBSTONE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const TERMINAL_TOMBSTONE_STATUSES = new Set<TerminalWorkspaceSessionSnapshot['status']>([
  'exited',
  'error',
  'connection-lost'
])
const REFRESHED_SHELL_IDS = new Set(['configured', 'remote-posix'])
const WINDOWS_SHELL_EXECUTABLES = new Set(['cmd', 'command.com', 'powershell', 'pwsh', 'wsl'])

export type TerminalExecutionTarget = {
  hostId: string
  cwd: string
  terminalCommand?: string
}

export type TerminalBackendCreateInput = {
  sessionId: string
  target: TerminalExecutionTarget
  shell: ResolvedTerminalShell
  cols: number
  rows: number
  actionCommand?: string
}

export type TerminalSessionManagerDependencies = {
  resolveExecutionTarget(target: TerminalWorkspaceTarget): Promise<TerminalExecutionTarget>
  createBackend(input: TerminalBackendCreateInput): Promise<TerminalBackend> | TerminalBackend
  appTerminalCommand?: string
  now?: () => Date
}

type SessionRecord = {
  sessionId: string
  workspaceId: string
  conversationId: string
  threadId?: string
  ownerWebContentsId: number
  hostId: string
  executionTarget: TerminalExecutionTarget
  backendKind: 'local-pty' | 'remote-process'
  purpose: 'interactive' | 'action'
  cwd: string
  shell: string
  shellKind: TerminalWorkspaceSessionSnapshot['shellKind']
  shellDefinition: ResolvedTerminalShell
  rawShellTitle?: string
  fixedTitle?: string
  title: string
  cols: number
  rows: number
  status: TerminalWorkspaceSessionSnapshot['status']
  attachedViewId?: string
  preserveOnOwnerDestroy: boolean
  output: TerminalOutputBuffer
  exitCode?: number | null
  signal?: string | null
  createdAt: string
  updatedAt: string
  exitedAt?: string
  backend?: TerminalBackend
  releaseBackendListeners?: () => void
  operationQueue: Promise<void>
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly conversationSessionIds = new Map<string, string[]>()
  private readonly activeSessionIds = new Map<string, string>()
  private readonly threadConversations = new Map<string, string>()
  private readonly conversationOwners = new Map<string, number>()
  private readonly listeners = new Set<(event: TerminalWorkspaceEvent) => void>()
  private eventSequence = 0

  constructor(private readonly dependencies: TerminalSessionManagerDependencies) {}

  onEvent(listener: (event: TerminalWorkspaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async create(
    input: TerminalWorkspaceCreateRequest,
    ownerWebContentsId: number
  ): Promise<TerminalWorkspaceSessionSnapshot> {
    const request = terminalWorkspaceCreateRequestSchema.parse(input)
    this.pruneTombstones()
    if (this.sessions.has(request.sessionId)) throw new Error('Terminal session already exists')
    this.assertCapacity(request.target.conversationId, ownerWebContentsId)
    const target = await this.dependencies.resolveExecutionTarget(request.target)
    const shell = requestShell(this.dependencies.appTerminalCommand, target, request.shellId)
    const now = this.nowIso()
    const record: SessionRecord = {
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      conversationId: request.target.conversationId,
      threadId: request.target.threadId,
      ownerWebContentsId,
      hostId: target.hostId,
      executionTarget: target,
      backendKind: target.hostId === 'local' ? 'local-pty' : 'remote-process',
      purpose: request.purpose ?? 'interactive',
      cwd: target.cwd,
      shell: shell.shell,
      shellKind: shell.kind,
      shellDefinition: shell,
      title: terminalTitle(undefined, undefined, target.cwd),
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      status: 'starting',
      preserveOnOwnerDestroy: false,
      output: new TerminalOutputBuffer(),
      createdAt: now,
      updatedAt: now,
      operationQueue: Promise.resolve()
    }
    this.sessions.set(record.sessionId, record)
    this.addConversationSession(record)
    if (record.threadId) this.threadConversations.set(record.threadId, record.conversationId)
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'status',
      session: this.snapshot(record)
    })

    await this.startBackend(record)
    return this.snapshot(record)
  }

  async attach(
    input: TerminalWorkspaceAttachRequest,
    ownerWebContentsId: number
  ): Promise<TerminalWorkspaceSessionSnapshot> {
    const request = terminalWorkspaceAttachRequestSchema.parse(input)
    let record = this.sessions.get(request.sessionId)
    if (!record && request.allowConversationFallback) {
      record = this.findConversationFallback(request.target.conversationId)
    }
    if (!record) throw new Error('Terminal session is unavailable')
    this.assertOwner(record, ownerWebContentsId)
    this.assertTarget(record, request.target)
    if (request.nextSessionId && request.nextSessionId !== record.sessionId) {
      record = this.rekey(record, request.nextSessionId)
    }
    if (request.forceCwdSync) {
      await this.enqueueOperation(record, () => this.syncCwdFromTarget(record, request.target))
    }
    record.workspaceId = request.workspaceId
    record.attachedViewId = request.viewId
    record.updatedAt = this.nowIso()
    this.activeSessionIds.set(record.conversationId, record.sessionId)
    const snapshot = this.snapshot(record)
    this.emit({ version: TERMINAL_WORKSPACE_API_VERSION, type: 'attached', session: snapshot })
    const output = record.output.snapshot()
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'init',
      session: this.snapshot(record),
      output: output.output,
      truncated: output.truncated
    })
    return snapshot
  }

  detach(input: unknown, ownerWebContentsId: number): TerminalWorkspaceAck {
    const request = terminalWorkspaceDetachRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    if (record.attachedViewId === request.viewId) {
      record.attachedViewId = undefined
      record.updatedAt = this.nowIso()
    }
    return { accepted: true }
  }

  async write(input: unknown, ownerWebContentsId: number): Promise<TerminalWorkspaceAck> {
    const request = terminalWorkspaceWriteRequestSchema.parse(input)
    const record = this.requireLiveSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    await record.backend?.write(request.data)
    return { accepted: true }
  }

  async resize(input: unknown, ownerWebContentsId: number): Promise<TerminalWorkspaceAck> {
    const request = terminalWorkspaceResizeRequestSchema.parse(input)
    const record = this.requireLiveSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    if (record.cols === request.cols && record.rows === request.rows) return { accepted: true }
    record.cols = request.cols
    record.rows = request.rows
    record.updatedAt = this.nowIso()
    await record.backend?.resize(request.cols, request.rows)
    return { accepted: true }
  }

  setTitle(input: unknown, ownerWebContentsId: number): TerminalWorkspaceAck {
    const request = terminalWorkspaceSetTitleRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    const sanitized = sanitizeTitle(request.rawShellTitle)
    if (!sanitized) return { accepted: true }
    record.rawShellTitle = sanitized
    record.title = terminalTitle(record.rawShellTitle, record.fixedTitle, record.cwd)
    record.updatedAt = this.nowIso()
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'title',
      session: this.snapshot(record)
    })
    return { accepted: true }
  }

  async runAction(input: unknown, ownerWebContentsId: number): Promise<TerminalWorkspaceAck> {
    const request = terminalWorkspaceRunActionRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    await this.enqueueOperation(record, async () => {
      record.fixedTitle = sanitizeTitle(request.title) || 'Action'
      record.title = terminalTitle(record.rawShellTitle, record.fixedTitle, record.cwd)
      record.purpose = 'action'
      record.updatedAt = this.nowIso()
      this.emit({
        version: TERMINAL_WORKSPACE_API_VERSION,
        type: 'title',
        session: this.snapshot(record)
      })
      await this.restartBackendForAction(record, request.command)
    })
    return { accepted: true }
  }

  async restart(
    input: TerminalWorkspaceRestartRequest,
    ownerWebContentsId: number
  ): Promise<TerminalWorkspaceSessionSnapshot> {
    const request = terminalWorkspaceRestartRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    if (request.target) this.assertTarget(record, request.target)
    return this.enqueueOperation(record, async () => {
      if (request.target) {
        const resolved = await this.dependencies.resolveExecutionTarget(request.target)
        if (resolved.hostId !== record.hostId)
          throw new Error('Terminal host cannot be changed while restarting')
        const shell = requestShell(
          this.dependencies.appTerminalCommand,
          resolved,
          shellIdForRefresh(record)
        )
        record.executionTarget = resolved
        record.cwd = resolved.cwd
        record.shell = shell.shell
        record.shellKind = shell.kind
        record.shellDefinition = shell
        record.title = terminalTitle(record.rawShellTitle, record.fixedTitle, record.cwd)
        if (request.target.threadId) record.threadId = request.target.threadId
      }
      if (request.workspaceId) record.workspaceId = request.workspaceId
      if (request.viewId) record.attachedViewId = request.viewId
      await this.restartBackend(record)
      return this.snapshot(record)
    })
  }

  async close(
    input: unknown,
    ownerWebContentsId: number
  ): Promise<TerminalWorkspaceSessionSnapshot> {
    const request = terminalWorkspaceCloseRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    await this.exit(record, {
      exitCode: record.exitCode ?? null,
      signal: record.signal ?? 'SIGTERM'
    })
    return this.snapshot(record)
  }

  list(
    input: TerminalWorkspaceListRequest,
    ownerWebContentsId: number
  ): TerminalWorkspaceListResult {
    const sessions = [...this.sessions.values()]
      .filter((record) => record.ownerWebContentsId === ownerWebContentsId)
      .filter((record) => !input.workspaceId || record.workspaceId === input.workspaceId)
      .filter((record) => !input.target || record.conversationId === input.target.conversationId)
      .map((record) => this.snapshot(record))
    return terminalWorkspaceListResultSchema.parse({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessions
    })
  }

  getSnapshot(input: unknown, ownerWebContentsId: number): TerminalWorkspaceSnapshot {
    const request = terminalWorkspaceSnapshotRequestSchema.parse(input)
    const record = this.requireSession(request.sessionId)
    this.assertOwner(record, ownerWebContentsId)
    const output = record.output.snapshot()
    return terminalWorkspaceSnapshotSchema.parse({
      session: this.snapshot(record),
      output: output.output,
      truncated: output.truncated
    })
  }

  readThreadTerminal(threadId: string): {
    terminalAttached: boolean
    sessionId?: string
    cwd?: string
    status?: string
    exitCode?: number | null
    output?: string
    truncated?: boolean
  } {
    const conversationId = this.threadConversations.get(threadId)
    if (!conversationId) return { terminalAttached: false }
    const ownerWebContentsId = this.conversationOwners.get(conversationId)
    if (ownerWebContentsId === undefined) return { terminalAttached: false }
    const record = this.selectActiveSession(conversationId)
    if (!record) return { terminalAttached: false }
    if (record.ownerWebContentsId !== ownerWebContentsId) return { terminalAttached: false }
    const output = record.output.snapshot()
    return {
      terminalAttached: true,
      sessionId: record.sessionId,
      cwd: record.cwd,
      status: record.status,
      exitCode: record.exitCode,
      output: output.output,
      truncated: output.truncated
    }
  }

  listShells(): ReturnType<typeof listTerminalShells> {
    return listTerminalShells()
  }

  ownerForSession(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.ownerWebContentsId
  }

  bindThread(conversationId: string, threadId: string): void {
    this.threadConversations.set(threadId, conversationId)
    for (const sessionId of this.conversationSessionIds.get(conversationId) ?? []) {
      const record = this.sessions.get(sessionId)
      if (record) record.threadId = threadId
    }
  }

  bindConversationOwner(conversationId: string, ownerWebContentsId: number): void {
    this.conversationOwners.set(conversationId, ownerWebContentsId)
  }

  async closeForConversation(conversationId: string): Promise<void> {
    const mappedConversationId = this.threadConversations.get(conversationId) ?? conversationId
    const ids = [...(this.conversationSessionIds.get(mappedConversationId) ?? [])]
    await Promise.all(
      ids.map((id) => this.exit(this.sessions.get(id), { exitCode: null, signal: 'SIGTERM' }))
    )
    this.conversationOwners.delete(mappedConversationId)
  }

  detachOwner(ownerWebContentsId: number): void {
    for (const record of this.sessions.values()) {
      if (record.ownerWebContentsId === ownerWebContentsId) record.attachedViewId = undefined
    }
  }

  async closeOwner(ownerWebContentsId: number): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter(
          (record) =>
            record.ownerWebContentsId === ownerWebContentsId && !record.preserveOnOwnerDestroy
        )
        .map((record) => this.exit(record, { exitCode: null, signal: 'SIGTERM' }))
    )
    for (const [conversationId, owner] of this.conversationOwners) {
      if (owner === ownerWebContentsId) this.conversationOwners.delete(conversationId)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((record) =>
        this.exit(record, { exitCode: null, signal: 'SIGTERM' })
      )
    )
    this.listeners.clear()
  }

  private listenToBackend(record: SessionRecord, backend: TerminalBackend): () => void {
    const disposeData = backend.onData((data) => {
      if (this.sessions.get(record.sessionId) !== record || record.status !== 'running') return
      record.output.append(data)
      record.updatedAt = this.nowIso()
      for (const chunk of splitData(data)) {
        this.emit({
          version: TERMINAL_WORKSPACE_API_VERSION,
          type: 'data',
          sessionId: record.sessionId,
          data: chunk,
          sequence: this.eventSequence++
        })
      }
    })
    const disposeExit = backend.onExit((event) => void this.exit(record, event))
    const disposeError = backend.onError((error) => {
      if (this.sessions.get(record.sessionId) !== record || record.status !== 'running') return
      const previousBackend = this.releaseBackend(record)
      record.status = 'error'
      record.exitedAt = this.nowIso()
      record.updatedAt = record.exitedAt
      void this.disposeBackend(previousBackend)
      this.emit({
        version: TERMINAL_WORKSPACE_API_VERSION,
        type: 'error',
        session: this.snapshot(record),
        message: messageForError(error)
      })
      this.pruneTombstones(record.conversationId)
    })
    const disposeConnectionLost = backend.onConnectionLost?.(
      (error) => void this.markConnectionLost(record, error)
    )
    return () => {
      disposeData()
      disposeExit()
      disposeError()
      disposeConnectionLost?.()
    }
  }

  private async exit(record: SessionRecord | undefined, event: TerminalExit): Promise<void> {
    if (!record || record.status === 'exited') return
    const backend = this.releaseBackend(record)
    record.status = 'exited'
    record.exitCode = event.exitCode
    record.signal = event.signal
    record.exitedAt = this.nowIso()
    record.updatedAt = record.exitedAt
    await this.disposeBackend(backend)
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'exit',
      session: this.snapshot(record)
    })
    this.pruneTombstones(record.conversationId)
  }

  private async markConnectionLost(record: SessionRecord, error: Error): Promise<void> {
    if (this.sessions.get(record.sessionId) !== record || record.status !== 'running') return
    const backend = this.releaseBackend(record)
    record.status = 'connection-lost'
    record.exitedAt = this.nowIso()
    record.updatedAt = record.exitedAt
    await this.disposeBackend(backend)
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'error',
      session: this.snapshot(record),
      message: messageForError(error)
    })
    this.pruneTombstones(record.conversationId)
  }

  private async restartBackendForAction(record: SessionRecord, command: string): Promise<void> {
    await this.prepareBackendRestart(record)
    await this.startBackend(record, command)
  }

  private enqueueOperation<T>(record: SessionRecord, operation: () => Promise<T>): Promise<T> {
    const result = record.operationQueue.then(operation)
    record.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async restartBackend(record: SessionRecord): Promise<void> {
    await this.prepareBackendRestart(record)
    await this.startBackend(record)
  }

  private async prepareBackendRestart(record: SessionRecord): Promise<void> {
    await this.disposeBackend(this.releaseBackend(record))
    record.status = 'starting'
    record.exitCode = undefined
    record.signal = undefined
    record.exitedAt = undefined
    record.updatedAt = this.nowIso()
    this.emit({
      version: TERMINAL_WORKSPACE_API_VERSION,
      type: 'status',
      session: this.snapshot(record)
    })
  }

  private releaseBackend(record: SessionRecord): TerminalBackend | undefined {
    const backend = record.backend
    record.backend = undefined
    record.releaseBackendListeners?.()
    record.releaseBackendListeners = undefined
    return backend
  }

  private async disposeBackend(backend: TerminalBackend | undefined): Promise<void> {
    try {
      await backend?.dispose()
    } catch {
      // Backend shutdown is best effort; the session state remains main-owned truth.
    }
  }

  private async startBackend(record: SessionRecord, actionCommand?: string): Promise<void> {
    try {
      const backend = await this.dependencies.createBackend({
        sessionId: record.sessionId,
        target: record.executionTarget,
        shell: record.shellDefinition,
        cols: record.cols,
        rows: record.rows,
        ...(actionCommand ? { actionCommand } : {})
      })
      if (this.sessions.get(record.sessionId) !== record || record.status === 'exited') {
        await backend.dispose()
        return
      }
      record.backend = backend
      record.status = 'running'
      record.updatedAt = this.nowIso()
      record.releaseBackendListeners = this.listenToBackend(record, backend)
      this.emit({
        version: TERMINAL_WORKSPACE_API_VERSION,
        type: 'status',
        session: this.snapshot(record)
      })
    } catch (error) {
      record.status = 'error'
      record.exitedAt = this.nowIso()
      record.updatedAt = record.exitedAt
      this.emit({
        version: TERMINAL_WORKSPACE_API_VERSION,
        type: 'error',
        session: this.snapshot(record),
        message: messageForError(error)
      })
    }
  }

  private rekey(record: SessionRecord, nextSessionId: string): SessionRecord {
    if (this.sessions.has(nextSessionId))
      throw new Error('Requested terminal session ID is already in use')
    this.sessions.delete(record.sessionId)
    const ids = this.conversationSessionIds.get(record.conversationId) ?? []
    this.conversationSessionIds.set(
      record.conversationId,
      ids.map((id) => (id === record.sessionId ? nextSessionId : id))
    )
    if (this.activeSessionIds.get(record.conversationId) === record.sessionId) {
      this.activeSessionIds.set(record.conversationId, nextSessionId)
    }
    record.sessionId = nextSessionId
    this.sessions.set(nextSessionId, record)
    return record
  }

  private async syncCwdFromTarget(
    record: SessionRecord,
    target: TerminalWorkspaceTarget
  ): Promise<void> {
    const resolved = await this.dependencies.resolveExecutionTarget(target)
    if (resolved.hostId !== record.hostId)
      throw new Error('Terminal host cannot be changed while attached')
    const shell = requestShell(
      this.dependencies.appTerminalCommand,
      resolved,
      shellIdForRefresh(record)
    )
    const shouldRestart =
      record.status === 'running' &&
      (resolved.cwd !== record.cwd ||
        resolved.terminalCommand !== record.executionTarget.terminalCommand ||
        hasShellDefinitionChanged(record, shell))
    record.executionTarget = resolved
    record.cwd = resolved.cwd
    record.shell = shell.shell
    record.shellKind = shell.kind
    record.shellDefinition = shell
    record.title = terminalTitle(record.rawShellTitle, record.fixedTitle, record.cwd)
    record.updatedAt = this.nowIso()
    if (shouldRestart) await this.restartBackend(record)
  }

  private findConversationFallback(conversationId: string): SessionRecord | undefined {
    const ids = this.conversationSessionIds.get(conversationId) ?? []
    return [...ids]
      .reverse()
      .map((id) => this.sessions.get(id))
      .find((record): record is SessionRecord => record !== undefined && record.status !== 'exited')
  }

  private selectActiveSession(conversationId: string): SessionRecord | undefined {
    const active = this.activeSessionIds.get(conversationId)
    if (active) {
      const record = this.sessions.get(active)
      if (record) return record
    }
    const records = (this.conversationSessionIds.get(conversationId) ?? [])
      .map((id) => this.sessions.get(id))
      .filter((record): record is SessionRecord => Boolean(record))
    return (
      records
        .filter((record) => record.purpose === 'interactive' && record.status === 'running')
        .at(-1) ??
      records
        .filter((record) => record.purpose === 'action' && record.status === 'running')
        .at(-1) ??
      records.filter((record) => record.purpose === 'action').at(-1)
    )
  }

  private assertCapacity(conversationId: string, ownerWebContentsId: number): void {
    const conversationCount = (this.conversationSessionIds.get(conversationId) ?? []).filter(
      (id) => {
        const record = this.sessions.get(id)
        return record && !isTerminalTombstone(record)
      }
    ).length
    if (conversationCount >= MAX_SESSIONS_PER_CONVERSATION)
      throw new Error('Terminal session limit reached for this task')
    const ownerCount = [...this.sessions.values()].filter(
      (record) => record.ownerWebContentsId === ownerWebContentsId && !isTerminalTombstone(record)
    ).length
    if (ownerCount >= MAX_SESSIONS_PER_OWNER)
      throw new Error('Terminal session limit reached for this window')
  }

  private addConversationSession(record: SessionRecord): void {
    const ids = this.conversationSessionIds.get(record.conversationId) ?? []
    this.conversationSessionIds.set(record.conversationId, [...ids, record.sessionId])
  }

  private assertOwner(record: SessionRecord, ownerWebContentsId: number): void {
    if (record.ownerWebContentsId !== ownerWebContentsId)
      throw new Error('Terminal session belongs to another window')
  }

  private assertTarget(record: SessionRecord, target: TerminalWorkspaceTarget): void {
    if (record.conversationId !== target.conversationId)
      throw new Error('Terminal session belongs to another task')
    if (target.threadId && record.threadId && target.threadId !== record.threadId) {
      throw new Error('Terminal session belongs to another thread')
    }
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Terminal session is unavailable')
    return record
  }

  private requireLiveSession(sessionId: string): SessionRecord {
    const record = this.requireSession(sessionId)
    if (record.status !== 'running' || !record.backend)
      throw new Error('Terminal session is not running')
    return record
  }

  private snapshot(record: SessionRecord): TerminalWorkspaceSessionSnapshot {
    return {
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      conversationId: record.conversationId,
      ...(record.threadId ? { threadId: record.threadId } : {}),
      hostId: record.hostId,
      backendKind: record.backendKind,
      purpose: record.purpose,
      cwd: record.cwd,
      shell: record.shell,
      shellKind: record.shellKind,
      ...(record.rawShellTitle ? { rawShellTitle: record.rawShellTitle } : {}),
      ...(record.fixedTitle ? { fixedTitle: record.fixedTitle } : {}),
      title: record.title,
      cols: record.cols,
      rows: record.rows,
      status: record.status,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      ...(record.signal !== undefined ? { signal: record.signal } : {}),
      truncated: record.output.snapshot().truncated,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.exitedAt ? { exitedAt: record.exitedAt } : {})
    }
  }

  private emit(event: TerminalWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private nowIso(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString()
  }

  private pruneTombstones(conversationId?: string): void {
    const now = (this.dependencies.now ?? (() => new Date()))().getTime()
    const conversations = conversationId
      ? [conversationId]
      : [...this.conversationSessionIds.keys()]
    for (const id of conversations) {
      const ids = this.conversationSessionIds.get(id) ?? []
      const tombstones = ids
        .map((sessionId) => this.sessions.get(sessionId))
        .filter(
          (record): record is SessionRecord => record !== undefined && isTerminalTombstone(record)
        )
      const expired = tombstones.filter(
        (record) => record.exitedAt && now - Date.parse(record.exitedAt) > TOMBSTONE_MAX_AGE_MS
      )
      const overCapacity = tombstones
        .filter((record) => !expired.includes(record))
        .slice(0, Math.max(0, tombstones.length - expired.length - MAX_TOMBSTONES_PER_CONVERSATION))
      for (const record of [...expired, ...overCapacity]) this.removeTombstone(record)
    }
  }

  private removeTombstone(record: SessionRecord): void {
    this.sessions.delete(record.sessionId)
    const remaining = (this.conversationSessionIds.get(record.conversationId) ?? []).filter(
      (id) => id !== record.sessionId
    )
    if (remaining.length) this.conversationSessionIds.set(record.conversationId, remaining)
    else this.conversationSessionIds.delete(record.conversationId)
    if (this.activeSessionIds.get(record.conversationId) === record.sessionId) {
      this.activeSessionIds.delete(record.conversationId)
    }
  }
}

function isTerminalTombstone(record: SessionRecord): boolean {
  return TERMINAL_TOMBSTONE_STATUSES.has(record.status)
}

function shellIdForRefresh(record: SessionRecord): string | undefined {
  if (REFRESHED_SHELL_IDS.has(record.shellDefinition.id)) return undefined
  return record.shellDefinition.id
}

function hasShellDefinitionChanged(record: SessionRecord, shell: ResolvedTerminalShell): boolean {
  return (
    shell.shell !== record.shell ||
    shell.kind !== record.shellKind ||
    shell.args.join('\0') !== record.shellDefinition.args.join('\0')
  )
}

function splitData(data: string): string[] {
  if (data.length <= TERMINAL_DATA_EVENT_MAX_CHARACTERS) return [data]
  const chunks: string[] = []
  for (let index = 0; index < data.length; index += TERMINAL_DATA_EVENT_MAX_CHARACTERS) {
    chunks.push(data.slice(index, index + TERMINAL_DATA_EVENT_MAX_CHARACTERS))
  }
  return chunks
}

function sanitizeTitle(value: string | undefined): string | undefined {
  const sanitized = value
    // eslint-disable-next-line no-control-regex -- terminal titles must not retain terminal control bytes.
    ?.replace(/[\x00-\x1F\x7F]/gu, '')
    .trim()
    .slice(0, 512)
  return sanitized || undefined
}

function terminalTitle(
  rawShellTitle: string | undefined,
  fixedTitle: string | undefined,
  cwd: string
): string {
  const preferred = fixedTitle ?? rawShellTitle
  if (preferred)
    return preferred.replace(new RegExp(`^${escapeRegExp(cwd)}\\s*[-:|]\\s*`, 'u'), '') || preferred
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) || 'Terminal'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestShell(
  appTerminalCommand: string | undefined,
  target: TerminalExecutionTarget,
  shellId: string | undefined
): ResolvedTerminalShell {
  // Validate the renderer-provided ID even when an authorized main override wins.
  // This keeps the API's allowlist contract invariant instead of silently accepting junk.
  const preferredShell = resolveTerminalShell(shellId)
  if (target.hostId !== 'local') return remotePosixTerminalShell(target.terminalCommand)
  const command = target.terminalCommand ?? appTerminalCommand
  return command ? configuredTerminalShell(command) : preferredShell
}

function remotePosixTerminalShell(command = '/bin/sh'): ResolvedTerminalShell {
  if (isKnownWindowsShell(command)) throw new Error('Remote terminal requires POSIX shell.')
  return { id: 'remote-posix', label: command, shell: command, args: ['-l'], kind: 'posix' }
}

function isKnownWindowsShell(command: string): boolean {
  const executable = command.split(/[\\/]/u).at(-1)?.toLowerCase() ?? command.toLowerCase()
  return executable.endsWith('.exe') || WINDOWS_SHELL_EXECUTABLES.has(executable)
}
