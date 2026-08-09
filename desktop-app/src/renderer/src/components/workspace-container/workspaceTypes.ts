/**
 * Domain types for the renderer-only workspace container.
 *
 * Keep this module free of React and Electron imports. A tab descriptor is
 * deliberately serializable; native handles belong in `runtime`, which is
 * never written to storage.
 */

export type WorkspacePanelId = 'right' | 'bottom'

export const WORKSPACE_PANEL_IDS = [
  'right',
  'bottom'
] as const satisfies readonly WorkspacePanelId[]

export const RIGHT_WORKSPACE_MIN_WIDTH = 320

export type WorkspaceContentKind = string

export type WorkspaceJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkspaceJsonValue[]
  | { readonly [key: string]: WorkspaceJsonValue }

export type WorkspaceTabRecord = {
  id: string
  kind: WorkspaceContentKind
  title: string
  props: Readonly<Record<string, WorkspaceJsonValue>>
  isPreview: boolean
  isClosable: boolean
}

export type WorkspaceTabRuntime = Readonly<Record<string, unknown>>

export type WorkspacePanelState = {
  id: WorkspacePanelId
  isOpen: boolean
  isMaximized: boolean
  /** Width for the right panel and height for the bottom panel. */
  size: number
  tabIds: readonly string[]
  activeTabId?: string
  /** Most-recently activated tab first. */
  activationHistory: readonly string[]
}

export type WorkspaceContainerState = {
  panels: Record<WorkspacePanelId, WorkspacePanelState>
  tabs: Readonly<Record<string, WorkspaceTabRecord>>
  runtime: Readonly<Record<string, WorkspaceTabRuntime>>
  lastFocusedPanelId: WorkspacePanelId
}

export type WorkspaceOpenTabAction = {
  type: 'open-tab'
  panelId: WorkspacePanelId
  tab: WorkspaceTabRecord
  insertAfterTabId?: string
  insertAtStart?: boolean
}

export type WorkspaceContainerAction =
  | WorkspaceOpenTabAction
  | { type: 'activate-tab'; panelId: WorkspacePanelId; tabId: string }
  | { type: 'pin-tab'; tabId: string }
  | { type: 'close-tab'; panelId: WorkspacePanelId; tabId: string }
  | { type: 'close-tabs'; panelId: WorkspacePanelId; tabIds: readonly string[] }
  | { type: 'reorder-tabs'; panelId: WorkspacePanelId; tabIds: readonly string[] }
  | {
      type: 'move-tab'
      sourcePanelId: WorkspacePanelId
      destinationPanelId: WorkspacePanelId
      tabId: string
      insertAfterTabId?: string
    }
  | { type: 'set-panel-open'; panelId: WorkspacePanelId; isOpen: boolean }
  | { type: 'set-panel-size'; panelId: WorkspacePanelId; size: number }
  | { type: 'toggle-panel-maximized'; panelId: WorkspacePanelId }
  | { type: 'set-tab-title'; tabId: string; title: string }
  | { type: 'set-tab-runtime'; tabId: string; runtime: WorkspaceTabRuntime }
  | { type: 'clear-tab-runtime'; tabId: string }
  | { type: 'set-last-focused-panel'; panelId: WorkspacePanelId }

export type WorkspacePersistedState = Omit<WorkspaceContainerState, 'runtime'>
