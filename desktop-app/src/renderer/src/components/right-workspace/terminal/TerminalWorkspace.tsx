import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { LoaderCircleIcon, RotateCcwIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  TERMINAL_WORKSPACE_API_VERSION,
  type TerminalWorkspaceEvent,
  type TerminalWorkspaceSessionSnapshot
} from '../../../../../shared/terminalWorkspaceApi'
import type { GitConversationTarget } from '../../../../../shared/localGitApi'
import type { RightWorkspaceTab } from '../workspaceState'
import { registerTerminalWorkspaceFitter } from './terminalWorkspaceMove'

type Props = {
  tab: Extract<RightWorkspaceTab, { type: 'terminal' }>
  workspaceId: string
  target?: GitConversationTarget
  onRuntimeChange(runtime: { terminalSessionId?: string; title?: string }): void
}

export function TerminalWorkspace({
  tab,
  workspaceId,
  target,
  onRuntimeChange
}: Props): React.JSX.Element {
  const [session, setSession] = useState<TerminalWorkspaceSessionSnapshot>()
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const terminalElementRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | undefined>(undefined)
  const writeRef = useRef<(data: string) => void>(() => undefined)

  const send = useCallback(
    (data: string): void => {
      const sessionId = tab.terminalSessionId
      if (!sessionId || session?.status === 'exited') return
      void window.desktopApp.workspace.terminal
        .write({ version: TERMINAL_WORKSPACE_API_VERSION, sessionId, data })
        .catch((cause) => setError(cause instanceof Error ? cause.message : '终端输入失败。'))
    },
    [session?.status, tab.terminalSessionId]
  )

  useEffect(() => {
    writeRef.current = send
  }, [send])

  useEffect(() => {
    const unsubscribe = window.desktopApp.workspace.terminal.onEvent((event) => {
      if (!belongsToTab(event, tab.terminalSessionId)) return
      if (event.type === 'data') {
        xtermRef.current?.write(event.data)
        return
      }
      setSession(event.session)
    })
    return unsubscribe
  }, [tab.id, tab.terminalSessionId])

  useEffect(() => {
    const sessionId = tab.terminalSessionId
    const element = terminalElementRef.current
    if (!sessionId || !element) return

    const terminal = new Terminal({
      allowProposedApi: false,
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: {
        background: window.getComputedStyle(element).backgroundColor,
        cursor: window.getComputedStyle(element).color,
        foreground: window.getComputedStyle(element).color,
        selectionBackground: 'rgba(127, 127, 127, 0.35)'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    xtermRef.current = terminal

    const resize = (): void => {
      fitAddon.fit()
      void window.desktopApp.workspace.terminal
        .resize({
          version: TERMINAL_WORKSPACE_API_VERSION,
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows
        })
        .catch(() => undefined)
    }
    const unregisterFitter = registerTerminalWorkspaceFitter(tab.id, resize)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    const input = terminal.onData((data) => writeRef.current(data))
    terminal.focus()

    return () => {
      unregisterFitter()
      input.dispose()
      observer.disconnect()
      if (xtermRef.current === terminal) xtermRef.current = undefined
      terminal.dispose()
    }
  }, [tab.id, tab.terminalSessionId])

  useEffect(() => {
    let active = true
    if (!tab.terminalSessionId)
      return () => {
        active = false
      }
    void window.desktopApp.workspace.terminal
      .list({ version: TERMINAL_WORKSPACE_API_VERSION, workspaceId })
      .then((result) => {
        const matching = result.sessions.find(
          (candidate) => candidate.sessionId === tab.terminalSessionId
        )
        if (!active || !matching) return
        setSession(matching)
        if (matching.scrollback) xtermRef.current?.write(matching.scrollback)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [tab.terminalSessionId, workspaceId])

  const start = (): void => {
    if (!target || starting) return
    setStarting(true)
    setError(undefined)
    void window.desktopApp.workspace.files
      .prepareRoot({ workspaceId, target })
      .then(() =>
        window.desktopApp.workspace.terminal.create({
          version: TERMINAL_WORKSPACE_API_VERSION,
          workspaceId,
          cols: 100,
          rows: 30
        })
      )
      .then((next) => {
        if (next.status === 'starting') throw new Error('终端原生模块不可用。')
        setSession(next)
        onRuntimeChange({ terminalSessionId: next.sessionId, title: 'Terminal' })
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法启动终端。'))
      .finally(() => setStarting(false))
  }

  if (!target) return <TerminalNotice message="当前任务没有可用的本地项目。" />
  if (!tab.terminalSessionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Button type="button" variant="secondary" disabled={starting} onClick={start}>
          {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
          启动终端
        </Button>
      </div>
    )
  }
  if (session?.status === 'exited') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <span>
          进程已退出
          {session.exitCode === null || session.exitCode === undefined
            ? ''
            : ` · 代码 ${session.exitCode}`}
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={start}>
          <RotateCcwIcon className="size-3.5" />
          重新启动
        </Button>
      </div>
    )
  }
  return (
    <div className="relative h-full min-h-0 bg-background p-4">
      <div
        ref={terminalElementRef}
        className="h-full min-h-0 overflow-hidden bg-background text-foreground"
      />
      {error ? <p className="absolute right-3 bottom-2 text-xs text-red-300">{error}</p> : null}
    </div>
  )
}

function TerminalNotice({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function belongsToTab(event: TerminalWorkspaceEvent, sessionId: string | undefined): boolean {
  if (!sessionId) return false
  return event.type === 'data'
    ? event.sessionId === sessionId
    : event.session.sessionId === sessionId
}
