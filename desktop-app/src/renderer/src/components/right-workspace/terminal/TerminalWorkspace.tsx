import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { LoaderCircleIcon, RotateCcwIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type {
  TerminalWorkspaceEvent,
  TerminalWorkspaceSessionSnapshot
} from '../../../../../shared/terminalWorkspaceApi'
import type { GitConversationTarget } from '../../../../../shared/localGitApi'
import type { RightWorkspaceTab } from '../workspaceState'
import { registerActiveTerminalView } from './terminalActiveView'
import { installTerminalInteractionHandlers } from './terminalKeyHandler'
import { TerminalPreferencesMenu } from './TerminalPreferencesMenu'
import { currentTerminalShellId } from './terminalPreferences'
import {
  attachOrCreateTerminalSession,
  detachTerminalSession,
  restartTerminalSession,
  resizeTerminalSession,
  terminalSessionIdFromTabId,
  terminalSessionSnapshot,
  terminalSessionTitle,
  terminalViewIdForTabId,
  subscribeTerminalSession,
  updateTerminalTitle,
  writeTerminalInput
} from './terminalSessionStore'
import { terminalAppearance, watchTerminalAppearance } from './terminalTheme'
import { registerTerminalWorkspaceFitter } from './terminalWorkspaceMove'

type Props = {
  tab: Extract<RightWorkspaceTab, { type: 'terminal' }>
  workspaceId: string
  target?: GitConversationTarget
  onTitleChange(title: string): void
  onOpenTerminal(): void
}

export function TerminalWorkspace({
  tab,
  workspaceId,
  target,
  onTitleChange,
  onOpenTerminal
}: Props): React.JSX.Element {
  const sessionId = terminalSessionIdFromTabId(tab.id)
  const viewId = terminalViewIdForTabId(tab.id)
  const [session, setSession] = useState<TerminalWorkspaceSessionSnapshot | undefined>(() =>
    sessionId ? terminalSessionSnapshot(sessionId) : undefined
  )
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(true)
  const terminalElementRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | undefined>(undefined)
  const writeRef = useRef<(data: string) => void>(() => undefined)
  const openTerminalRef = useRef(onOpenTerminal)
  const titleChangeRef = useRef(onTitleChange)
  const lastResizeRef = useRef<{ cols: number; rows: number } | undefined>(undefined)
  const initAppliedRef = useRef(false)
  const sessionStatus = session?.status

  const send = useCallback(
    (data: string): void => {
      if (!sessionId || (sessionStatus && isRestartableTerminalStatus(sessionStatus))) return
      void writeTerminalInput(sessionId, data).catch((cause) =>
        setError(cause instanceof Error ? cause.message : '终端输入失败。')
      )
    },
    [sessionId, sessionStatus]
  )

  useEffect(() => {
    writeRef.current = send
  }, [send])

  useEffect(() => {
    openTerminalRef.current = onOpenTerminal
  }, [onOpenTerminal])

  useEffect(() => {
    titleChangeRef.current = onTitleChange
  }, [onTitleChange])

  const writeOutput = useCallback((data: string): void => {
    const terminal = xtermRef.current
    if (!terminal || !data) return
    const wasAtBottom = isNearBottom(terminal)
    terminal.write(data, () => {
      if (wasAtBottom) terminal.scrollToBottom()
    })
  }, [])

  useEffect(() => {
    if (!sessionId) return
    initAppliedRef.current = false
    const unsubscribe = subscribeTerminalSession(sessionId, (event) => {
      if (!belongsToSession(event, sessionId)) return
      if (event.type === 'data') {
        writeOutput(event.data)
        return
      }
      if (event.type === 'init') {
        if (!initAppliedRef.current) {
          initAppliedRef.current = true
          xtermRef.current?.reset()
          writeOutput(event.output)
        }
      }
      setSession(event.session)
      if (event.type === 'title') titleChangeRef.current(terminalSessionTitle(event.session))
      if (event.type === 'error') setError(event.message)
    })
    return unsubscribe
  }, [sessionId, writeOutput])

  useEffect(() => {
    const element = terminalElementRef.current
    if (!sessionId || !element) return

    const appearance = terminalAppearance(element)
    const terminal = new Terminal({
      allowProposedApi: false,
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      scrollback: 10_000,
      theme: appearance.theme
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    xtermRef.current = terminal
    const unregisterActiveView = registerActiveTerminalView({ element, terminal })

    const resize = (): void => {
      fitAddon.fit()
      if (
        lastResizeRef.current?.cols === terminal.cols &&
        lastResizeRef.current.rows === terminal.rows
      ) {
        return
      }
      lastResizeRef.current = { cols: terminal.cols, rows: terminal.rows }
      void resizeTerminalSession(sessionId, terminal.cols, terminal.rows).catch(() => undefined)
    }
    const unregisterFitter = registerTerminalWorkspaceFitter(tab.id, resize)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    const input = terminal.onData((data) => writeRef.current(data))
    const title = terminal.onTitleChange((rawTitle) => {
      void updateTerminalTitle(sessionId, rawTitle).catch(() => undefined)
    })
    const interactions = installTerminalInteractionHandlers({
      terminal,
      platform: window.desktopApp.environment.platform,
      write: (data) => writeRef.current(data),
      openTerminal: () => openTerminalRef.current(),
      openExternalHttpUrl: (url) =>
        void window.desktopApp.codex.openExternalHttpUrl(url).catch(() => undefined)
    })
    const unwatchAppearance = watchTerminalAppearance(terminal, element, () => {
      resize()
      terminal.refresh(0, terminal.rows - 1)
    })
    requestAnimationFrame(() => {
      if (document.activeElement === document.body || element.contains(document.activeElement)) {
        terminal.focus()
      }
    })

    return () => {
      unregisterFitter()
      unregisterActiveView()
      input.dispose()
      title.dispose()
      interactions.dispose()
      unwatchAppearance()
      observer.disconnect()
      if (xtermRef.current === terminal) xtermRef.current = undefined
      terminal.dispose()
      void detachTerminalSession({ sessionId, viewId }).catch(() => undefined)
    }
  }, [sessionId, tab.id, viewId])

  useEffect(() => {
    let active = true
    if (!sessionId || !target) return () => void (active = false)
    void attachOrCreateTerminalSession({
      sessionId,
      workspaceId,
      target,
      viewId,
      cols: lastResizeRef.current?.cols ?? 100,
      rows: lastResizeRef.current?.rows ?? 30,
      shellId: currentTerminalShellId()
    })
      .then((next) => {
        if (!active) return
        setSession(next)
        titleChangeRef.current(terminalSessionTitle(next))
      })
      .catch((cause) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : '无法启动终端。')
      })
      .finally(() => {
        if (active) setStarting(false)
      })
    return () => {
      active = false
    }
  }, [sessionId, target, viewId, workspaceId])

  const start = (): void => {
    if (!sessionId || !target || starting) return
    setStarting(true)
    setError(undefined)
    let startSession: Promise<TerminalWorkspaceSessionSnapshot>
    if (session && isRestartableTerminalStatus(session.status)) {
      startSession = restartTerminalSession({
        sessionId,
        workspaceId,
        target,
        viewId
      })
    } else {
      startSession = attachOrCreateTerminalSession({
        sessionId,
        workspaceId,
        target,
        viewId,
        cols: lastResizeRef.current?.cols ?? 100,
        rows: lastResizeRef.current?.rows ?? 30,
        shellId: currentTerminalShellId()
      })
    }
    void startSession
      .then((next) => {
        setSession(next)
        titleChangeRef.current(terminalSessionTitle(next))
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法启动终端。'))
      .finally(() => setStarting(false))
  }

  if (!target) return <TerminalNotice message="当前任务没有可用的本地项目。" />
  if (!sessionId) return <TerminalNotice message="终端标签缺少会话标识。" />
  const stoppedSession =
    session && isRestartableTerminalStatus(session.status) ? session : undefined
  const stoppedMessage = stoppedSession ? terminalStoppedMessage(stoppedSession) : undefined
  return (
    <div className="relative h-full min-h-0 bg-background p-4">
      <div
        ref={terminalElementRef}
        data-slot="terminal-workspace-surface"
        className="h-full min-h-0 overflow-hidden bg-background text-foreground"
      />
      <div className="absolute top-3 right-3 flex items-center gap-2 rounded border border-border/60 bg-background/95 px-1.5 py-1 text-xs text-muted-foreground">
        <TerminalPreferencesMenu />
        {starting ? (
          <span className="flex items-center gap-2 pr-1">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            正在连接终端
          </span>
        ) : null}
      </div>
      {stoppedMessage || error ? (
        <div className="absolute right-3 bottom-2 flex items-center gap-2 rounded border border-red-500/40 bg-background/95 px-2 py-1 text-xs text-red-300">
          <span>{error ?? stoppedMessage}</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={start}>
            {stoppedSession ? (
              <>
                <RotateCcwIcon className="size-3.5" />
                重新启动
              </>
            ) : (
              '重试'
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function isNearBottom(terminal: Terminal): boolean {
  return terminal.buffer.active.viewportY >= terminal.buffer.active.baseY - 1
}

function TerminalNotice({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function isRestartableTerminalStatus(status: TerminalWorkspaceSessionSnapshot['status']): boolean {
  return status === 'exited' || status === 'error' || status === 'connection-lost'
}

function terminalStoppedMessage(session: TerminalWorkspaceSessionSnapshot): string {
  if (session.status === 'connection-lost') return '连接已断开'
  if (session.status === 'error') return '终端出错'
  if (session.exitCode !== null && session.exitCode !== undefined) {
    return `进程已退出 · 代码 ${session.exitCode}`
  }
  return '进程已退出'
}

function belongsToSession(event: TerminalWorkspaceEvent, sessionId: string | undefined): boolean {
  if (!sessionId) return false
  return event.type === 'data'
    ? event.sessionId === sessionId
    : event.session.sessionId === sessionId
}
