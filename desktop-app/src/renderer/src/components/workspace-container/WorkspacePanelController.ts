import {
  previewReplacementCandidate,
  tabPanelId,
  workspaceContainerReducer
} from './workspaceReducer'
import type {
  WorkspaceContentLifecycleContext,
  WorkspaceContentRegistry
} from './WorkspaceContentRegistry'
import { createWorkspaceDescriptor } from './workspaceOpenTargets'
import { reorderTabAfter } from './workspaceDragGeometry'
import { terminalSessionIdFromTabId } from '../right-workspace/terminal/terminalSessionStore'
import type { WorkspaceOpenOptions, WorkspaceOpenTarget } from './workspaceOpenTargets'
import type {
  WorkspaceContainerAction,
  WorkspaceContainerState,
  WorkspacePanelId,
  WorkspaceTabRecord
} from './workspaceTypes'

type ControllerDependencies = {
  getState(): WorkspaceContainerState
  dispatch(action: WorkspaceContainerAction): void
  registry: WorkspaceContentRegistry
  workspaceId: string
  confirmTerminalClose?(tabs: readonly WorkspaceTabRecord[]): Promise<boolean>
}

/**
 * Orchestrates lifecycle work around the pure reducer. The reducer is allowed
 * to remove a record only after this controller has let every close guard
 * approve the full transaction.
 */
export class WorkspacePanelController {
  constructor(private readonly dependencies: ControllerDependencies) {}

  async open(target: WorkspaceOpenTarget, options: WorkspaceOpenOptions = {}): Promise<void> {
    const state = this.dependencies.getState()
    const panelId = options.panelId ?? state.lastFocusedPanelId
    const tab = createWorkspaceDescriptor(target, options)
    const owner = tabPanelId(state, tab.id)
    const replacing = options.replaceTabId
      ? this.tabInPanel(panelId, options.replaceTabId)
      : owner
        ? undefined
        : previewReplacementCandidate(state, panelId, tab.id)
    if (replacing) {
      const replacementIndex = state.panels[panelId].tabIds.indexOf(replacing.id)
      const previousTabId = state.panels[panelId].tabIds[replacementIndex - 1]
      const closeAction: WorkspaceContainerAction[] = options.replaceTabId
        ? [{ type: 'close-tabs', panelId, tabIds: [replacing.id] }]
        : []
      const stateActions: WorkspaceContainerAction[] = [
        ...closeAction,
        {
          type: 'open-tab',
          panelId,
          tab,
          insertAfterTabId: options.insertAfterTabId ?? previousTabId,
          insertAtStart: options.insertAtStart ?? (replacementIndex === 0 && !previousTabId)
        }
      ]
      await this.closeMany(panelId, [replacing], stateActions)
      return
    }
    await this.dispatchWithActivationLifecycle([
      {
        type: 'open-tab',
        panelId,
        tab,
        insertAfterTabId: options.insertAfterTabId,
        insertAtStart: options.insertAtStart
      }
    ])
  }

  async activate(panelId: WorkspacePanelId, tabId: string): Promise<void> {
    await this.dispatchWithActivationLifecycle([{ type: 'activate-tab', panelId, tabId }])
  }

  async close(panelId: WorkspacePanelId, tabId: string): Promise<void> {
    const tab = this.tabInPanel(panelId, tabId)
    if (!tab) return
    await this.closeMany(panelId, [tab])
  }

  async closeOther(panelId: WorkspacePanelId, tabId: string): Promise<void> {
    const state = this.dependencies.getState()
    const tabs = state.panels[panelId].tabIds
      .filter((id) => id !== tabId)
      .map((id) => state.tabs[id])
      .filter((tab): tab is WorkspaceTabRecord => Boolean(tab?.isClosable))
    await this.closeMany(panelId, tabs)
  }

  async closeToRight(panelId: WorkspacePanelId, tabId: string): Promise<void> {
    const state = this.dependencies.getState()
    const index = state.panels[panelId].tabIds.indexOf(tabId)
    if (index === -1) return
    const tabs = state.panels[panelId].tabIds
      .slice(index + 1)
      .map((id) => state.tabs[id])
      .filter((tab): tab is WorkspaceTabRecord => Boolean(tab?.isClosable))
    await this.closeMany(panelId, tabs)
  }

  async move(
    sourcePanelId: WorkspacePanelId,
    destinationPanelId: WorkspacePanelId,
    tabId: string,
    insertAfterTabId?: string
  ): Promise<void> {
    const state = this.dependencies.getState()
    const tab = this.tabInPanel(sourcePanelId, tabId)
    if (!tab) return
    if (sourcePanelId === destinationPanelId) {
      const reordered = reorderTabAfter(state.panels[sourcePanelId].tabIds, tabId, insertAfterTabId)
      await this.dispatchWithActivationLifecycle([
        {
          type: 'reorder-tabs',
          panelId: sourcePanelId,
          tabIds: reordered
        }
      ])
      return
    }
    if (state.panels[destinationPanelId].tabIds.includes(tabId)) return
    const replacement = tab.isPreview
      ? previewReplacementCandidate(state, destinationPanelId, tab.id)
      : undefined
    const moveAction: WorkspaceContainerAction = {
      type: 'move-tab',
      sourcePanelId,
      destinationPanelId,
      tabId,
      insertAfterTabId
    }
    const move = async (): Promise<void> => {
      await this.dispatchWithActivationLifecycle([moveAction], async (nextState) => {
        await this.dependencies.registry.move(
          tab,
          this.lifecycleContext(destinationPanelId, tab.id, nextState)
        )
      })
    }
    if (replacement) {
      await this.closeMany(
        destinationPanelId,
        [replacement],
        [{ type: 'close-tabs', panelId: destinationPanelId, tabIds: [replacement.id] }, moveAction],
        async (nextState) => {
          await this.dependencies.registry.move(
            tab,
            this.lifecycleContext(destinationPanelId, tab.id, nextState)
          )
        }
      )
      return
    }
    await move()
  }

  private async closeMany(
    panelId: WorkspacePanelId,
    tabs: readonly WorkspaceTabRecord[],
    stateActions: readonly WorkspaceContainerAction[] = [
      { type: 'close-tabs', panelId, tabIds: tabs.map((tab) => tab.id) }
    ],
    afterCommit?: (nextState: WorkspaceContainerState) => Promise<void> | void
  ): Promise<void> {
    if (!tabs.length) {
      await this.dispatchWithActivationLifecycle(stateActions, afterCommit)
      return
    }
    if (!(await this.confirmClose(tabs))) return
    const state = this.dependencies.getState()
    const contexts = tabs.map((tab) => ({
      tab,
      context: this.lifecycleContext(panelId, tab.id, state)
    }))
    for (const { tab, context } of contexts) {
      if (!(await this.dependencies.registry.beforeClose(tab, context))) return
    }
    await this.dispatchWithActivationLifecycle(stateActions, async (nextState) => {
      await Promise.all(
        contexts.map(({ tab, context }) => this.dependencies.registry.close(tab, context))
      )
      await afterCommit?.(nextState)
    })
  }

  private async confirmClose(tabs: readonly WorkspaceTabRecord[]): Promise<boolean> {
    const terminalTabs = tabs.filter((tab) => {
      return tab.kind === 'terminal' && Boolean(terminalSessionIdFromTabId(tab.id))
    })
    if (!terminalTabs.length) return true
    const runningTerminalTabs = await this.runningTerminalTabs(terminalTabs)
    return runningTerminalTabs.length
      ? ((await this.dependencies.confirmTerminalClose?.(runningTerminalTabs)) ?? true)
      : true
  }

  private async runningTerminalTabs(
    terminalTabs: readonly WorkspaceTabRecord[]
  ): Promise<readonly WorkspaceTabRecord[]> {
    const terminal = window.desktopApp?.workspace?.terminal
    if (!terminal) return terminalTabs
    try {
      const listed = await terminal.list({ version: 2, workspaceId: this.dependencies.workspaceId })
      const runningSessionIds = new Set(
        listed.sessions
          .filter((session) => session.status !== 'exited')
          .map((session) => session.sessionId)
      )
      return terminalTabs.filter((tab) => {
        const sessionId = terminalSessionIdFromTabId(tab.id)
        return Boolean(sessionId && runningSessionIds.has(sessionId))
      })
    } catch {
      // The close guard remains conservative when the session query cannot complete.
      return terminalTabs
    }
  }

  private tabInPanel(panelId: WorkspacePanelId, tabId: string): WorkspaceTabRecord | undefined {
    const state = this.dependencies.getState()
    return state.panels[panelId].tabIds.includes(tabId) ? state.tabs[tabId] : undefined
  }

  private lifecycleContext(
    panelId: WorkspacePanelId,
    tabId: string,
    state: WorkspaceContainerState = this.dependencies.getState()
  ): WorkspaceContentLifecycleContext {
    return {
      panelId,
      workspaceId: this.dependencies.workspaceId,
      runtime: state.runtime[tabId]
    }
  }

  private async dispatchWithActivationLifecycle(
    actions: readonly WorkspaceContainerAction[],
    afterCommit?: (nextState: WorkspaceContainerState) => Promise<void> | void
  ): Promise<void> {
    if (!actions.length) {
      await afterCommit?.(this.dependencies.getState())
      return
    }
    const beforeState = this.dependencies.getState()
    const nextState = actions.reduce(workspaceContainerReducer, beforeState)
    const transitions = this.activationTransitions(beforeState, nextState)
    for (const transition of transitions) {
      if (transition.previousTab) {
        await this.dependencies.registry.deactivate(
          transition.previousTab,
          this.lifecycleContext(transition.panelId, transition.previousTab.id, beforeState)
        )
      }
    }
    for (const action of actions) {
      this.dependencies.dispatch(action)
    }
    await afterCommit?.(nextState)
    for (const transition of transitions) {
      if (transition.nextTab) {
        await this.dependencies.registry.activate(
          transition.nextTab,
          this.lifecycleContext(transition.panelId, transition.nextTab.id, nextState)
        )
      }
    }
  }

  private activationTransitions(
    beforeState: WorkspaceContainerState,
    nextState: WorkspaceContainerState
  ): readonly {
    panelId: WorkspacePanelId
    previousTab?: WorkspaceTabRecord
    nextTab?: WorkspaceTabRecord
  }[] {
    return (['right', 'bottom'] as const).flatMap((panelId) => {
      const previousTabId = beforeState.panels[panelId].activeTabId
      const nextTabId = nextState.panels[panelId].activeTabId
      if (previousTabId === nextTabId) return []
      return [
        {
          panelId,
          previousTab: previousTabId ? beforeState.tabs[previousTabId] : undefined,
          nextTab: nextTabId ? nextState.tabs[nextTabId] : undefined
        }
      ]
    })
  }
}
