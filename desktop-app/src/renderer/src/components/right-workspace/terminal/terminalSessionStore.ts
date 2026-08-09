import {
  TERMINAL_WORKSPACE_API_VERSION,
  type TerminalWorkspaceEvent,
  type TerminalWorkspaceSessionSnapshot,
  type TerminalWorkspaceSessionStatus,
  type TerminalWorkspaceTarget
} from '../../../../../shared/terminalWorkspaceApi'

const TERMINAL_TAB_PREFIX = 'terminal:'
const MAX_PENDING_WRITES = 256
const MAX_PENDING_ACTIONS = 64

type TerminalSessionListener = (event: TerminalWorkspaceEvent) => void
type PendingAction = {
  command: string
  title?: string
  resolve(): void
  reject(error: unknown): void
}

const listeners = new Map<string, Set<TerminalSessionListener>>()
const sessions = new Map<string, TerminalWorkspaceSessionSnapshot>()
const pendingWrites = new Map<string, string[]>()
const pendingResizes = new Map<string, { cols: number; rows: number }>()
const pendingActions = new Map<string, PendingAction[]>()
const attachedSessions = new Set<string>()
let unsubscribeEvents: (() => void) | undefined

export function terminalSessionIdFromTabId(tabId: string): string | undefined {
  if (!tabId.startsWith(TERMINAL_TAB_PREFIX)) return undefined
  return tabId.slice(TERMINAL_TAB_PREFIX.length) || undefined
}

export function terminalViewIdForTabId(tabId: string): string {
  return `${tabId}:view`
}

export function subscribeTerminalSession(
  sessionId: string,
  listener: TerminalSessionListener
): () => void {
  ensureTerminalEventSubscription()
  const sessionListeners = listeners.get(sessionId) ?? new Set<TerminalSessionListener>()
  sessionListeners.add(listener)
  listeners.set(sessionId, sessionListeners)
  return () => {
    sessionListeners.delete(listener)
    if (!sessionListeners.size) listeners.delete(sessionId)
  }
}

export async function attachOrCreateTerminalSession(input: {
  sessionId: string
  workspaceId: string
  target: TerminalWorkspaceTarget
  viewId: string
  cols: number
  rows: number
  shellId?: string
}): Promise<TerminalWorkspaceSessionSnapshot> {
  ensureTerminalEventSubscription()
  try {
    const attached = await window.desktopApp.workspace.terminal.attach({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      target: input.target,
      viewId: input.viewId,
      allowConversationFallback: false,
      forceCwdSync: true
    })
    await markReadyAndFlush(attached, 'attached')
    return attached
  } catch (error) {
    if (!isUnavailableTerminalSessionError(error)) {
      clearPendingForFailure(input.sessionId, error)
      throw error
    }
    let created: TerminalWorkspaceSessionSnapshot
    try {
      created = await window.desktopApp.workspace.terminal.create({
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        target: input.target,
        cols: input.cols,
        rows: input.rows,
        ...(input.shellId ? { shellId: input.shellId } : {}),
        purpose: 'interactive'
      })
    } catch (createError) {
      clearPendingForFailure(input.sessionId, createError)
      throw createError
    }
    sessions.set(created.sessionId, created)
    try {
      const attached = await attachTerminalSession({
        sessionId: created.sessionId,
        workspaceId: input.workspaceId,
        target: input.target,
        viewId: input.viewId
      })
      await markReadyAndFlush(attached, 'attached')
      return attached
    } catch (attachError) {
      clearPendingForFailure(created.sessionId, attachError)
      throw attachError
    }
  }
}

export async function restartTerminalSession(input: {
  sessionId: string
  workspaceId: string
  target: TerminalWorkspaceTarget
  viewId: string
}): Promise<TerminalWorkspaceSessionSnapshot> {
  ensureTerminalEventSubscription()
  try {
    const restarted = await window.desktopApp.workspace.terminal.restart({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      target: input.target,
      viewId: input.viewId,
      reason: 'retry'
    })
    await markReadyAndFlush(restarted, 'attached')
    return restarted
  } catch (error) {
    clearPendingForFailure(input.sessionId, error)
    throw error
  }
}

export async function detachTerminalSession(input: {
  sessionId: string
  viewId: string
}): Promise<void> {
  attachedSessions.delete(input.sessionId)
  clearPendingInput(input.sessionId)
  await window.desktopApp.workspace.terminal
    .detach({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId: input.sessionId,
      viewId: input.viewId
    })
    .then(() => undefined)
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  attachedSessions.delete(sessionId)
  try {
    await window.desktopApp.workspace.terminal
      .close({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId })
      .then(() => undefined)
    clearPendingForFailure(sessionId, new Error('Terminal session was closed'))
  } catch (error) {
    clearPendingForFailure(sessionId, error)
    throw error
  }
}

export function terminalSessionSnapshot(
  sessionId: string
): TerminalWorkspaceSessionSnapshot | undefined {
  return sessions.get(sessionId)
}

export function terminalSessionTitle(session: TerminalWorkspaceSessionSnapshot): string {
  return sanitizeTerminalTitle(session.fixedTitle ?? session.rawShellTitle ?? session.title)
}

export async function writeTerminalInput(sessionId: string, data: string): Promise<void> {
  if (!data) return
  if (!attachedSessions.has(sessionId)) {
    const queue = pendingWrites.get(sessionId) ?? []
    if (queue.length >= MAX_PENDING_WRITES) {
      throw new Error('Terminal write queue is full')
    }
    queue.push(data)
    pendingWrites.set(sessionId, queue)
    return
  }
  await writeNow(sessionId, data)
}

export async function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  if (!attachedSessions.has(sessionId)) {
    pendingResizes.set(sessionId, { cols, rows })
    return
  }
  await resizeNow(sessionId, cols, rows)
}

export async function updateTerminalTitle(sessionId: string, rawShellTitle: string): Promise<void> {
  const title = sanitizeTerminalTitle(rawShellTitle)
  if (!title) return
  await window.desktopApp.workspace.terminal
    .setTitle({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId,
      rawShellTitle: title
    })
    .then(() => undefined)
}

/**
 * Queues an action until its terminal is attached. Main remains the authority
 * that serializes backend restarts; the renderer queue only preserves intent
 * during the attach/create race.
 */
export async function runTerminalAction(
  sessionId: string,
  command: string,
  title?: string
): Promise<void> {
  if (attachedSessions.has(sessionId)) {
    await runActionNow(sessionId, command, title)
    return
  }
  const queue = pendingActions.get(sessionId) ?? []
  if (queue.length >= MAX_PENDING_ACTIONS) {
    throw new Error('Terminal action queue is full')
  }
  await new Promise<void>((resolve, reject) => {
    queue.push({ command, ...(title ? { title } : {}), resolve, reject })
    pendingActions.set(sessionId, queue)
  })
}

export function resetTerminalSessionStoreForTests(): void {
  unsubscribeEvents?.()
  unsubscribeEvents = undefined
  listeners.clear()
  sessions.clear()
  pendingWrites.clear()
  pendingResizes.clear()
  for (const queue of pendingActions.values()) {
    for (const action of queue) action.reject(new Error('Terminal session store was reset'))
  }
  pendingActions.clear()
  attachedSessions.clear()
}

function ensureTerminalEventSubscription(): void {
  if (unsubscribeEvents || !window.desktopApp?.workspace?.terminal?.onEvent) return
  unsubscribeEvents = window.desktopApp.workspace.terminal.onEvent((event) => {
    const session = event.type === 'data' ? undefined : event.session
    if (session) {
      sessions.set(session.sessionId, session)
      const canFlush = updateAttachedState(session, event.type)
      if ((event.type === 'attached' || event.type === 'init') && canFlush) {
        void flushPendingWrites(session.sessionId)
        void flushPendingResize(session.sessionId)
        void flushPendingActions(session.sessionId)
      }
    }
    const sessionId = event.type === 'data' ? event.sessionId : event.session.sessionId
    listeners.get(sessionId)?.forEach((listener) => listener(event))
  })
}

async function attachTerminalSession(input: {
  sessionId: string
  workspaceId: string
  target: TerminalWorkspaceTarget
  viewId: string
}): Promise<TerminalWorkspaceSessionSnapshot> {
  return window.desktopApp.workspace.terminal.attach({
    version: TERMINAL_WORKSPACE_API_VERSION,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    target: input.target,
    viewId: input.viewId,
    allowConversationFallback: false,
    forceCwdSync: true
  })
}

async function markReadyAndFlush(
  session: TerminalWorkspaceSessionSnapshot,
  source: 'attached' | 'init'
): Promise<void> {
  const canFlush = updateAttachedState(session, source)
  if (!canFlush) return
  await flushPendingWrites(session.sessionId)
  await flushPendingResize(session.sessionId)
  await flushPendingActions(session.sessionId)
}

function updateAttachedState(
  session: TerminalWorkspaceSessionSnapshot,
  source: TerminalWorkspaceEvent['type'] | 'attached' | 'init'
): boolean {
  sessions.set(session.sessionId, session)
  if (isDetachedStatus(session.status) || source === 'exit' || source === 'error') {
    attachedSessions.delete(session.sessionId)
    clearPendingForFailure(
      session.sessionId,
      new Error(`Terminal session is ${terminalStatusLabel(session.status)}`)
    )
    return false
  }
  if (source === 'status' && session.status === 'starting') {
    attachedSessions.delete(session.sessionId)
    return false
  }
  if (session.status === 'running' || source === 'attached' || source === 'init') {
    attachedSessions.add(session.sessionId)
    return true
  }
  return false
}

function isDetachedStatus(status: TerminalWorkspaceSessionStatus): boolean {
  return status === 'exited' || status === 'error' || status === 'connection-lost'
}

function terminalStatusLabel(status: TerminalWorkspaceSessionStatus): string {
  return status === 'connection-lost' ? 'connection lost' : status
}

async function flushPendingWrites(sessionId: string): Promise<void> {
  const queue = pendingWrites.get(sessionId)
  if (!queue?.length) return
  pendingWrites.delete(sessionId)
  for (const data of queue) {
    await writeNow(sessionId, data)
  }
}

async function writeNow(sessionId: string, data: string): Promise<void> {
  await window.desktopApp.workspace.terminal
    .write({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId, data })
    .then(() => undefined)
}

async function flushPendingResize(sessionId: string): Promise<void> {
  const pending = pendingResizes.get(sessionId)
  if (!pending) return
  pendingResizes.delete(sessionId)
  await resizeNow(sessionId, pending.cols, pending.rows)
}

async function resizeNow(sessionId: string, cols: number, rows: number): Promise<void> {
  await window.desktopApp.workspace.terminal
    .resize({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId, cols, rows })
    .then(() => undefined)
}

async function flushPendingActions(sessionId: string): Promise<void> {
  const queue = pendingActions.get(sessionId)
  if (!queue?.length) return
  pendingActions.delete(sessionId)
  for (const action of queue) {
    try {
      await runActionNow(sessionId, action.command, action.title)
      action.resolve()
    } catch (error) {
      action.reject(error)
    }
  }
}

async function runActionNow(sessionId: string, command: string, title?: string): Promise<void> {
  await window.desktopApp.workspace.terminal
    .runAction({
      version: TERMINAL_WORKSPACE_API_VERSION,
      sessionId,
      command,
      ...(title ? { title } : {})
    })
    .then(() => undefined)
}

function clearPendingForFailure(sessionId: string, error: unknown): void {
  clearPendingInput(sessionId)
  const queue = pendingActions.get(sessionId)
  if (!queue?.length) return
  pendingActions.delete(sessionId)
  for (const action of queue) action.reject(error)
}

function clearPendingInput(sessionId: string): void {
  pendingWrites.delete(sessionId)
  pendingResizes.delete(sessionId)
}

function sanitizeTerminalTitle(title: string): string {
  return [...title]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
    .slice(0, 120)
}

function isUnavailableTerminalSessionError(error: unknown): boolean {
  return error instanceof Error && /terminal session is unavailable/iu.test(error.message)
}
