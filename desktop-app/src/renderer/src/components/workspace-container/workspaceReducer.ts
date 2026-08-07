import {
  WORKSPACE_PANEL_IDS,
  type WorkspaceContainerAction,
  type WorkspaceContainerState,
  type WorkspacePanelId,
  type WorkspacePanelState,
  type WorkspaceTabRecord,
  type WorkspaceTabRuntime
} from './workspaceTypes'

export const DEFAULT_RIGHT_PANEL_SIZE = 560
export const DEFAULT_BOTTOM_PANEL_SIZE = 320

export function createWorkspaceContainerState(
  overrides: Partial<WorkspaceContainerState> = {}
): WorkspaceContainerState {
  const panels = {
    right: createPanelState('right', DEFAULT_RIGHT_PANEL_SIZE),
    bottom: createPanelState('bottom', DEFAULT_BOTTOM_PANEL_SIZE),
    ...overrides.panels
  }
  return {
    panels,
    tabs: overrides.tabs ?? {},
    runtime: overrides.runtime ?? {},
    lastFocusedPanelId: overrides.lastFocusedPanelId ?? 'right'
  }
}

export const defaultWorkspaceContainerState = createWorkspaceContainerState()

export function workspaceContainerReducer(
  state: WorkspaceContainerState,
  action: WorkspaceContainerAction
): WorkspaceContainerState {
  switch (action.type) {
    case 'open-tab':
      return openTab(
        state,
        action.panelId,
        action.tab,
        action.insertAfterTabId,
        action.insertAtStart
      )
    case 'activate-tab':
      return activateTab(state, action.panelId, action.tabId)
    case 'pin-tab':
      return pinTab(state, action.tabId)
    case 'close-tab':
      return closeTabs(state, action.panelId, [action.tabId])
    case 'close-tabs':
      return closeTabs(state, action.panelId, action.tabIds)
    case 'reorder-tabs':
      return reorderTabs(state, action.panelId, action.tabIds)
    case 'move-tab':
      return moveTab(
        state,
        action.sourcePanelId,
        action.destinationPanelId,
        action.tabId,
        action.insertAfterTabId
      )
    case 'set-panel-open':
      return updatePanel(state, action.panelId, (panel) => ({
        ...panel,
        isOpen: action.isOpen,
        isMaximized: action.isOpen ? panel.isMaximized : false
      }))
    case 'set-panel-size':
      return Number.isFinite(action.size)
        ? updatePanel(state, action.panelId, (panel) => ({
            ...panel,
            size: Math.round(action.size)
          }))
        : state
    case 'toggle-panel-maximized':
      return togglePanelMaximized(state, action.panelId)
    case 'set-tab-runtime':
      return state.tabs[action.tabId]
        ? {
            ...state,
            runtime: {
              ...state.runtime,
              [action.tabId]: { ...state.runtime[action.tabId], ...action.runtime }
            }
          }
        : state
    case 'clear-tab-runtime': {
      if (!state.runtime[action.tabId]) return state
      const runtime: Record<string, WorkspaceTabRuntime> = { ...state.runtime }
      delete runtime[action.tabId]
      return { ...state, runtime }
    }
    case 'set-last-focused-panel':
      return { ...state, lastFocusedPanelId: action.panelId }
    default:
      return state
  }
}

/** Returns the current preview that would be replaced by a new preview tab. */
export function previewReplacementCandidate(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  tabId: string
): WorkspaceTabRecord | undefined {
  const panel = state.panels[panelId]
  return panel.tabIds.map((id) => state.tabs[id]).find((tab) => tab?.isPreview && tab.id !== tabId)
}

export function tabPanelId(
  state: WorkspaceContainerState,
  tabId: string
): WorkspacePanelId | undefined {
  return WORKSPACE_PANEL_IDS.find((panelId) => state.panels[panelId].tabIds.includes(tabId))
}

export function panelTabs(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId
): readonly WorkspaceTabRecord[] {
  return state.panels[panelId].tabIds.flatMap((tabId) => {
    const tab = state.tabs[tabId]
    return tab ? [tab] : []
  })
}

function createPanelState(id: WorkspacePanelId, size: number): WorkspacePanelState {
  return {
    id,
    isOpen: false,
    isMaximized: false,
    size,
    tabIds: [],
    activationHistory: []
  }
}

function openTab(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  tab: WorkspaceTabRecord,
  insertAfterTabId: string | undefined,
  insertAtStart: boolean | undefined
): WorkspaceContainerState {
  const owner = tabPanelId(state, tab.id)
  if (owner) {
    const current = state.tabs[tab.id]
    const updated = {
      ...tab,
      // A pinned tab must never be downgraded by a later preview request.
      isPreview: current.isPreview ? tab.isPreview : false
    }
    return activateTab({ ...state, tabs: { ...state.tabs, [tab.id]: updated } }, owner, tab.id)
  }

  const replacement = tab.isPreview
    ? previewReplacementCandidate(state, panelId, tab.id)
    : undefined
  const withoutPreview = replacement ? closeTabs(state, panelId, [replacement.id]) : state
  const panel = withoutPreview.panels[panelId]
  const tabIds = insertAfter(
    panel.tabIds,
    tab.id,
    insertAfterTabId ?? panel.activeTabId,
    insertAtStart === true
  )
  return activateTab(
    {
      ...withoutPreview,
      tabs: { ...withoutPreview.tabs, [tab.id]: tab },
      panels: {
        ...withoutPreview.panels,
        [panelId]: { ...panel, tabIds, isOpen: true }
      }
    },
    panelId,
    tab.id
  )
}

function activateTab(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  tabId: string
): WorkspaceContainerState {
  const panel = state.panels[panelId]
  if (!panel.tabIds.includes(tabId)) return state
  return {
    ...state,
    panels: {
      ...state.panels,
      [panelId]: {
        ...panel,
        isOpen: true,
        activeTabId: tabId,
        activationHistory: [tabId, ...panel.activationHistory.filter((id) => id !== tabId)]
      }
    },
    lastFocusedPanelId: panelId
  }
}

function pinTab(state: WorkspaceContainerState, tabId: string): WorkspaceContainerState {
  const tab = state.tabs[tabId]
  if (!tab || !tab.isPreview) return state
  return { ...state, tabs: { ...state.tabs, [tabId]: { ...tab, isPreview: false } } }
}

function closeTabs(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  tabIds: readonly string[]
): WorkspaceContainerState {
  const panel = state.panels[panelId]
  const closing = new Set(tabIds.filter((id) => panel.tabIds.includes(id)))
  if (!closing.size) return state

  const remainingIds = panel.tabIds.filter((id) => !closing.has(id))
  const activeTabId = closing.has(panel.activeTabId ?? '')
    ? chooseNextActiveTab(panel, remainingIds, closing)
    : panel.activeTabId
  const tabs: Record<string, WorkspaceTabRecord> = { ...state.tabs }
  const runtime: Record<string, WorkspaceTabRuntime> = { ...state.runtime }
  for (const tabId of closing) {
    delete tabs[tabId]
    delete runtime[tabId]
  }
  return {
    ...state,
    tabs,
    runtime,
    panels: {
      ...state.panels,
      [panelId]: {
        ...panel,
        tabIds: remainingIds,
        activeTabId,
        activationHistory: panel.activationHistory.filter((id) => !closing.has(id)),
        isOpen: remainingIds.length > 0 ? panel.isOpen : false,
        isMaximized: remainingIds.length > 0 ? panel.isMaximized : false
      }
    }
  }
}

function chooseNextActiveTab(
  panel: WorkspacePanelState,
  remainingIds: readonly string[],
  closing: ReadonlySet<string>
): string | undefined {
  const fromHistory = panel.activationHistory.find(
    (tabId) => !closing.has(tabId) && remainingIds.includes(tabId)
  )
  if (fromHistory) return fromHistory
  const activeIndex = panel.tabIds.indexOf(panel.activeTabId ?? '')
  return remainingIds[Math.max(0, activeIndex - 1)] ?? remainingIds[0]
}

function reorderTabs(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  tabIds: readonly string[]
): WorkspaceContainerState {
  const panel = state.panels[panelId]
  if (!sameIds(panel.tabIds, tabIds)) return state
  return updatePanel(state, panelId, (current) => ({ ...current, tabIds: [...tabIds] }))
}

function moveTab(
  state: WorkspaceContainerState,
  sourcePanelId: WorkspacePanelId,
  destinationPanelId: WorkspacePanelId,
  tabId: string,
  insertAfterTabId: string | undefined
): WorkspaceContainerState {
  if (sourcePanelId === destinationPanelId) return state
  const source = state.panels[sourcePanelId]
  const destination = state.panels[destinationPanelId]
  if (!state.tabs[tabId] || !source.tabIds.includes(tabId) || destination.tabIds.includes(tabId)) {
    return state
  }
  const sourceTabIds = source.tabIds.filter((id) => id !== tabId)
  const destinationTabIds = insertAfter(
    destination.tabIds,
    tabId,
    insertAfterTabId ?? destination.activeTabId
  )
  const sourceActiveTabId =
    source.activeTabId === tabId
      ? chooseNextActiveTab(source, sourceTabIds, new Set([tabId]))
      : source.activeTabId
  const next = {
    ...state,
    panels: {
      ...state.panels,
      [sourcePanelId]: {
        ...source,
        tabIds: sourceTabIds,
        activeTabId: sourceActiveTabId,
        activationHistory: source.activationHistory.filter((id) => id !== tabId),
        isOpen: sourceTabIds.length > 0 ? source.isOpen : false,
        isMaximized: sourceTabIds.length > 0 ? source.isMaximized : false
      },
      [destinationPanelId]: {
        ...destination,
        tabIds: destinationTabIds,
        isOpen: true
      }
    }
  }
  return activateTab(next, destinationPanelId, tabId)
}

function togglePanelMaximized(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId
): WorkspaceContainerState {
  const panel = state.panels[panelId]
  const nextMaximized = !panel.isMaximized
  return {
    ...state,
    panels: {
      ...state.panels,
      ...Object.fromEntries(
        WORKSPACE_PANEL_IDS.map((id) => [
          id,
          id === panelId
            ? { ...state.panels[id], isOpen: true, isMaximized: nextMaximized }
            : { ...state.panels[id], isMaximized: false }
        ])
      )
    }
  }
}

function updatePanel(
  state: WorkspaceContainerState,
  panelId: WorkspacePanelId,
  update: (panel: WorkspacePanelState) => WorkspacePanelState
): WorkspaceContainerState {
  return { ...state, panels: { ...state.panels, [panelId]: update(state.panels[panelId]) } }
}

function insertAfter(
  tabIds: readonly string[],
  tabId: string,
  afterTabId: string | undefined,
  insertAtStart = false
): readonly string[] {
  if (insertAtStart) return [tabId, ...tabIds]
  const index = afterTabId ? tabIds.indexOf(afterTabId) : -1
  if (index === -1) return [...tabIds, tabId]
  return [...tabIds.slice(0, index + 1), tabId, ...tabIds.slice(index + 1)]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id))
}
