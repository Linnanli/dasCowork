import type {
  WorkspaceContainerState,
  WorkspaceJsonValue,
  WorkspacePanelId,
  WorkspacePanelState,
  WorkspaceTabRecord
} from './workspaceTypes'
import { createWorkspaceContainerState, DEFAULT_RIGHT_PANEL_SIZE } from './workspaceReducer'

export const WORKSPACE_CONTAINER_STORAGE_VERSION = 2

export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function workspaceContainerStorageKey(scope: string): string {
  return `workspace-container:v2:${normalizedScope(scope)}`
}

export function legacyRightWorkspaceStorageKey(scope: string): string {
  return `right-workspace:${normalizedScope(scope)}`
}

export function loadWorkspaceContainerState(
  storage: WorkspaceStorage | undefined,
  scope: string
): WorkspaceContainerState {
  if (!storage) return createWorkspaceContainerState()
  const current = safelyParse(storage.getItem(workspaceContainerStorageKey(scope)))
  if (current) return restoreV2(current)
  return migrateLegacyRightWorkspace(
    safelyParse(storage.getItem(legacyRightWorkspaceStorageKey(scope)))
  )
}

export function persistWorkspaceContainerState(
  storage: WorkspaceStorage | undefined,
  scope: string,
  state: WorkspaceContainerState
): void {
  if (!storage) return
  const payload = {
    version: WORKSPACE_CONTAINER_STORAGE_VERSION,
    panels: state.panels,
    tabs: state.tabs,
    lastFocusedPanelId: state.lastFocusedPanelId
  }
  try {
    storage.setItem(workspaceContainerStorageKey(scope), JSON.stringify(payload))
  } catch {
    // Browser quota errors must not turn workspace interaction into a crash.
  }
}

function restoreV2(value: unknown): WorkspaceContainerState {
  if (!isRecord(value) || value.version !== WORKSPACE_CONTAINER_STORAGE_VERSION) {
    return createWorkspaceContainerState()
  }
  const tabs = Object.fromEntries(
    Object.entries(isRecord(value.tabs) ? value.tabs : {}).flatMap(([id, tab]) => {
      const restored = restoreTab(id, tab)
      return restored ? [[id, restored]] : []
    })
  )
  const panels = {
    right: restorePanel('right', value.panels, tabs),
    bottom: restorePanel('bottom', value.panels, tabs)
  }
  return createWorkspaceContainerState({
    panels,
    tabs,
    lastFocusedPanelId: value.lastFocusedPanelId === 'bottom' ? 'bottom' : 'right'
  })
}

function migrateLegacyRightWorkspace(value: unknown): WorkspaceContainerState {
  if (!isRecord(value)) return createWorkspaceContainerState()
  const legacyTabs = Array.isArray(value.tabs) ? value.tabs : []
  const tabs = Object.fromEntries(
    legacyTabs.flatMap((legacyTab) => {
      const tab = migrateLegacyTab(legacyTab)
      return tab ? [[tab.id, tab]] : []
    })
  )
  const tabIds = legacyTabs
    .map((tab) => (isRecord(tab) && typeof tab.id === 'string' ? tab.id : undefined))
    .filter((id): id is string => Boolean(id && tabs[id]))
  const activeTabId =
    typeof value.activeTabId === 'string' && tabs[value.activeTabId]
      ? value.activeTabId
      : tabIds.at(-1)
  return createWorkspaceContainerState({
    tabs,
    panels: {
      right: {
        id: 'right',
        isOpen: value.isOpen === true,
        isMaximized: value.isMaximized === true,
        size: finiteNumber(value.panelWidth, DEFAULT_RIGHT_PANEL_SIZE),
        tabIds,
        activeTabId,
        activationHistory: activeTabId
          ? [activeTabId, ...tabIds.filter((id) => id !== activeTabId)]
          : []
      },
      bottom: createWorkspaceContainerState().panels.bottom
    },
    lastFocusedPanelId: 'right'
  })
}

function restorePanel(
  id: WorkspacePanelId,
  rawPanels: unknown,
  tabs: Readonly<Record<string, WorkspaceTabRecord>>
): WorkspacePanelState {
  const fallback = createWorkspaceContainerState().panels[id]
  if (!isRecord(rawPanels) || !isRecord(rawPanels[id])) return fallback
  const value = rawPanels[id]
  const tabIds = uniqueStrings(value.tabIds).filter((tabId) => Boolean(tabs[tabId]))
  const activeTabId =
    typeof value.activeTabId === 'string' && tabIds.includes(value.activeTabId)
      ? value.activeTabId
      : tabIds.at(-1)
  const activationHistory = uniqueStrings(value.activationHistory).filter((tabId) =>
    tabIds.includes(tabId)
  )
  return {
    id,
    isOpen: value.isOpen === true,
    isMaximized: value.isMaximized === true,
    size: finiteNumber(value.size, fallback.size),
    tabIds,
    activeTabId,
    activationHistory: activeTabId
      ? [activeTabId, ...activationHistory.filter((tabId) => tabId !== activeTabId)]
      : activationHistory
  }
}

function restoreTab(id: string, value: unknown): WorkspaceTabRecord | undefined {
  if (
    !isRecord(value) ||
    value.id !== id ||
    typeof value.kind !== 'string' ||
    typeof value.title !== 'string'
  ) {
    return undefined
  }
  return {
    id,
    kind: value.kind,
    title: value.title,
    props: isJsonRecord(value.props) ? value.props : {},
    isPreview: value.isPreview === true,
    isClosable: value.isClosable !== false
  }
}

function migrateLegacyTab(value: unknown): WorkspaceTabRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string')
    return undefined
  const title = typeof value.title === 'string' ? value.title : value.type
  switch (value.type) {
    case 'review':
      if (value.id !== 'review') return undefined
      return legacyTab(
        value.id,
        value.type,
        title,
        value.source === undefined ? {} : { source: jsonValue(value.source) }
      )
    case 'file':
      return typeof value.relativePath === 'string'
        ? legacyTab(value.id, value.type, title, { relativePath: value.relativePath })
        : undefined
    case 'terminal':
    case 'browser':
      return legacyTab(value.id, value.type, title, {})
    default:
      return undefined
  }
}

function legacyTab(
  id: string,
  kind: string,
  title: string,
  props: Record<string, WorkspaceJsonValue>
): WorkspaceTabRecord {
  return { id, kind, title, props, isPreview: false, isClosable: true }
}

function safelyParse(raw: string | null): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((candidate): candidate is string => typeof candidate === 'string'))]
    : []
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRecord(value: unknown): value is Record<string, WorkspaceJsonValue> {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is WorkspaceJsonValue {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function jsonValue(value: unknown): WorkspaceJsonValue {
  return isJsonValue(value) ? value : null
}

function normalizedScope(scope: string): string {
  return scope.trim() || 'default'
}
