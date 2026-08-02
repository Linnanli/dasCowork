import { AlertCircleIcon, ArrowLeftIcon, Loader2Icon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { McpServerSummary } from '../../../../shared/mcpServerStatus'
import { useComposerSuggestionPanelMaxHeight } from './composer-suggestion-panel-layout'

export type ComposerMcpCommandContentProps = {
  onBack: () => void
  onClose: () => void
  threadId?: string
}

type ContentState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; servers: readonly McpServerSummary[] }

/** Renderer-safe MCP status list. It receives only the narrowed desktop DTO. */
export function ComposerMcpCommandContent({
  onBack,
  onClose,
  threadId
}: ComposerMcpCommandContentProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const panelMaxHeight = useComposerSuggestionPanelMaxHeight(panelRef)
  const [state, setState] = useState<{ key: string; value: ContentState }>({
    key: '',
    value: { type: 'loading' }
  })
  const [revision, setRevision] = useState(0)
  const requestKey = `${threadId ?? ''}:${revision}`

  useEffect(() => {
    let current = true
    void window.desktopApp.codex
      .listMcpServers({ version: 1, ...(threadId ? { threadId } : {}) })
      .then((result) => {
        if (current)
          setState({ key: requestKey, value: { type: 'ready', servers: result.servers } })
      })
      .catch((error: unknown) => {
        if (!current) return
        setState({
          key: requestKey,
          value: {
            type: 'error',
            message: error instanceof Error ? error.message : '无法加载 MCP 服务状态'
          }
        })
      })
    return () => {
      current = false
    }
  }, [requestKey, threadId])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const visibleState: ContentState = state.key === requestKey ? state.value : { type: 'loading' }

  return (
    <div
      ref={panelRef}
      data-testid="composer-suggestion-panel"
      data-composer-suggestion-keep-open
      className="aui-composer-context-panel absolute right-0 bottom-full left-0 z-50 mb-3 overflow-y-auto rounded-2xl border border-border bg-popover/90 p-2 text-popover-foreground shadow-lg backdrop-blur-md"
      style={{ maxHeight: panelMaxHeight }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-1 pb-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-3.5" />
          返回命令
        </button>
        <div className="text-sm font-medium">MCP servers</div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          aria-label="关闭 MCP 服务列表"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {visibleState.type === 'loading' ? (
        <div className="flex items-center gap-2 px-2.5 py-4 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          正在加载 MCP 服务…
        </div>
      ) : null}
      {visibleState.type === 'error' ? (
        <div role="alert" className="flex items-center gap-2 px-2.5 py-4 text-sm text-destructive">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{visibleState.message}</span>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-destructive/10"
            aria-label="重试加载 MCP 服务"
            onClick={retry}
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </div>
      ) : null}
      {visibleState.type === 'ready' && visibleState.servers.length === 0 ? (
        <div className="px-2.5 py-4 text-center text-sm text-muted-foreground">
          没有可用的 MCP 服务
        </div>
      ) : null}
      {visibleState.type === 'ready'
        ? visibleState.servers.map((server) => (
            <div
              key={server.name}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm"
            >
              <span
                className={
                  server.connected
                    ? 'size-2 rounded-full bg-emerald-500'
                    : 'size-2 rounded-full bg-muted-foreground'
                }
                aria-label={server.connected ? '已连接' : '未连接'}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
              <span className="text-xs text-muted-foreground">{server.toolCount} tools</span>
              <span className="text-xs text-muted-foreground">
                {authStatusLabel(server.authStatus)}
              </span>
            </div>
          ))
        : null}
    </div>
  )
}

function authStatusLabel(status: McpServerSummary['authStatus']): string {
  switch (status) {
    case 'notLoggedIn':
      return '需登录'
    case 'bearerToken':
      return '令牌认证'
    case 'oAuth':
      return 'OAuth'
    default:
      return '无需认证'
  }
}
