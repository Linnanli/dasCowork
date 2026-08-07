/* eslint-disable react-refresh/only-export-components -- registry exports are intentionally colocated. */
import type { ReactNode } from 'react'

import type { GitConversationTarget, LocalGitReviewSource } from '../../../../shared/localGitApi'
import { BrowserWorkspace } from '../right-workspace/browser/BrowserWorkspace'
import { repositionBrowserWorkspaceView } from '../right-workspace/browser/browserWorkspaceMove'
import { FileWorkspace } from '../right-workspace/files/FileWorkspace'
import { ReviewWorkspace } from '../right-workspace/review/ReviewWorkspace'
import { TerminalWorkspace } from '../right-workspace/terminal/TerminalWorkspace'
import { refitTerminalWorkspace } from '../right-workspace/terminal/terminalWorkspaceMove'
import type { RightWorkspaceTab } from '../right-workspace/workspaceState'
import type { WorkspaceOpenOptions, WorkspaceOpenTarget } from './workspaceOpenTargets'
import type {
  WorkspacePanelId,
  WorkspacePanelState,
  WorkspaceTabRecord,
  WorkspaceTabRuntime
} from './workspaceTypes'

export type WorkspaceContentRenderContext = {
  panelId: WorkspacePanelId
  panel: WorkspacePanelState
  workspaceId: string
  target?: GitConversationTarget
  runtime: WorkspaceTabRuntime | undefined
  openTarget(target: WorkspaceOpenTarget, options?: WorkspaceOpenOptions): void
  setRuntime(tabId: string, runtime: WorkspaceTabRuntime): void
}

export type WorkspaceContentLifecycleContext = Pick<
  WorkspaceContentRenderContext,
  'panelId' | 'workspaceId' | 'runtime'
>

export type WorkspaceContentAdapter = {
  kind: string
  render(tab: WorkspaceTabRecord, context: WorkspaceContentRenderContext): ReactNode
  onBeforeClose?(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<boolean | void> | boolean | void
  onActivate?(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<void> | void
  onDeactivate?(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<void> | void
  onClose?(tab: WorkspaceTabRecord, context: WorkspaceContentLifecycleContext): Promise<void> | void
  onMove?(tab: WorkspaceTabRecord, context: WorkspaceContentLifecycleContext): Promise<void> | void
}

export class WorkspaceContentRegistry {
  private readonly adapters = new Map<string, WorkspaceContentAdapter>()

  register(adapter: WorkspaceContentAdapter): this {
    this.adapters.set(adapter.kind, adapter)
    return this
  }

  adapterFor(tab: WorkspaceTabRecord): WorkspaceContentAdapter | undefined {
    return this.adapters.get(tab.kind)
  }

  render(tab: WorkspaceTabRecord, context: WorkspaceContentRenderContext): ReactNode {
    const adapter = this.adapterFor(tab)
    if (!adapter) return <WorkspaceRestoreFailure title={tab.title} />
    return adapter.render(tab, context)
  }

  async close(tab: WorkspaceTabRecord, context: WorkspaceContentLifecycleContext): Promise<void> {
    await this.adapterFor(tab)?.onClose?.(tab, context)
  }

  async beforeClose(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<boolean> {
    return (await this.adapterFor(tab)?.onBeforeClose?.(tab, context)) !== false
  }

  async activate(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<void> {
    await this.adapterFor(tab)?.onActivate?.(tab, context)
  }

  async deactivate(
    tab: WorkspaceTabRecord,
    context: WorkspaceContentLifecycleContext
  ): Promise<void> {
    await this.adapterFor(tab)?.onDeactivate?.(tab, context)
  }

  async move(tab: WorkspaceTabRecord, context: WorkspaceContentLifecycleContext): Promise<void> {
    await this.adapterFor(tab)?.onMove?.(tab, context)
  }
}

export function createWorkspaceContentRegistry(): WorkspaceContentRegistry {
  return new WorkspaceContentRegistry()
    .register({
      kind: 'review',
      render: () => <ReviewWorkspace />
    })
    .register({
      kind: 'file',
      render: (tab, context) => (
        <FileWorkspace
          tab={asFileTab(tab)}
          workspaceId={context.workspaceId}
          target={context.target}
          onOpenFile={(relativePath, title, mode = 'preview') =>
            context.openTarget(
              { type: 'file', relativePath, title },
              {
                panelId: context.panelId,
                mode
              }
            )
          }
        />
      )
    })
    .register({
      kind: 'terminal',
      render: (tab, context) => (
        <TerminalWorkspace
          tab={asTerminalTab(tab, context.runtime)}
          workspaceId={context.workspaceId}
          target={context.target}
          onRuntimeChange={(runtime) => context.setRuntime(tab.id, runtime)}
        />
      ),
      onClose: (_tab, context) => {
        const sessionId = context.runtime?.terminalSessionId
        if (typeof sessionId !== 'string') return
        return window.desktopApp.workspace.terminal
          .kill({ version: 1, sessionId })
          .then(() => undefined)
      },
      onMove: (tab) => refitTerminalWorkspace(tab.id)
    })
    .register({
      kind: 'browser',
      render: (tab, context) => (
        <BrowserWorkspace
          tab={asBrowserTab(tab, context.runtime)}
          workspaceId={context.workspaceId}
          onRuntimeChange={(runtime) => context.setRuntime(tab.id, runtime)}
        />
      ),
      onActivate: (_tab, context) => showBrowserView(context.runtime?.browserViewId),
      onDeactivate: (_tab, context) => hideBrowserView(context.runtime?.browserViewId),
      onClose: (_tab, context) => {
        const viewId = context.runtime?.browserViewId
        if (typeof viewId !== 'string') return
        return window.desktopApp.workspace.browser
          .destroy({ version: 1, viewId })
          .then(() => undefined)
      },
      onMove: (tab, context) => {
        const viewId = context.runtime?.browserViewId
        return typeof viewId === 'string'
          ? repositionBrowserWorkspaceView(tab.id, viewId)
          : undefined
      }
    })
}

export function WorkspaceRestoreFailure({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">无法恢复“{title}”工作区内容。</p>
      <p className="text-xs text-muted-foreground">可以关闭此标签后重新打开。</p>
    </div>
  )
}

function asFileTab(tab: WorkspaceTabRecord): Extract<RightWorkspaceTab, { type: 'file' }> {
  return {
    id: tab.id,
    type: 'file',
    title: tab.title,
    relativePath: typeof tab.props.relativePath === 'string' ? tab.props.relativePath : ''
  }
}

function asTerminalTab(
  tab: WorkspaceTabRecord,
  runtime: WorkspaceTabRuntime | undefined
): Extract<RightWorkspaceTab, { type: 'terminal' }> {
  return {
    id: tab.id,
    type: 'terminal',
    title: tab.title,
    terminalSessionId:
      typeof runtime?.terminalSessionId === 'string' ? runtime.terminalSessionId : undefined
  }
}

function asBrowserTab(
  tab: WorkspaceTabRecord,
  runtime: WorkspaceTabRuntime | undefined
): Extract<RightWorkspaceTab, { type: 'browser' }> {
  return {
    id: tab.id,
    type: 'browser',
    title: tab.title,
    browserViewId: typeof runtime?.browserViewId === 'string' ? runtime.browserViewId : undefined
  }
}

function showBrowserView(viewId: unknown): Promise<void> | void {
  if (typeof viewId !== 'string') return
  return window.desktopApp.workspace.browser
    .show({ version: 1, viewId })
    .then(() => undefined)
    .catch(() => undefined)
}

function hideBrowserView(viewId: unknown): Promise<void> | void {
  if (typeof viewId !== 'string') return
  return window.desktopApp.workspace.browser
    .hide({ version: 1, viewId })
    .then(() => undefined)
    .catch(() => undefined)
}

export function reviewSource(tab: WorkspaceTabRecord): LocalGitReviewSource | undefined {
  return tab.kind === 'review' ? (tab.props.source as LocalGitReviewSource | undefined) : undefined
}
