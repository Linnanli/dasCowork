export const WORKSPACE_DRAG_THRESHOLD_PX = 6

export function hasCrossedWorkspaceDragThreshold(
  origin: { x: number; y: number },
  current: { x: number; y: number }
): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) >= WORKSPACE_DRAG_THRESHOLD_PX
}

export function reorderTabAfter(
  tabIds: readonly string[],
  tabId: string,
  afterTabId: string | undefined
): readonly string[] {
  const withoutTab = tabIds.filter((id) => id !== tabId)
  if (!afterTabId) return [tabId, ...withoutTab]
  const index = afterTabId ? withoutTab.indexOf(afterTabId) : -1
  return index === -1
    ? [...withoutTab, tabId]
    : [...withoutTab.slice(0, index + 1), tabId, ...withoutTab.slice(index + 1)]
}

export type WorkspaceDragDropTarget = {
  panelId: 'right' | 'bottom'
  tabId?: string
  placement?: 'before' | 'after'
}

export function workspaceDragDropTargetFromElement(
  element: Element | null | undefined,
  point?: { x: number; y: number }
): WorkspaceDragDropTarget | undefined {
  const target = element?.closest<HTMLElement>('[data-workspace-tab], [data-workspace-drop-panel]')
  if (!target) return undefined
  const panelId = target.dataset.workspacePanelId
  if (panelId !== 'right' && panelId !== 'bottom') return undefined
  const tabId = target.dataset.workspaceTabId
  const placement = tabId && point ? tabDropPlacement(target, point) : undefined
  return {
    panelId,
    tabId,
    placement
  }
}

export function insertAfterTabIdForWorkspaceDrop(
  tabIds: readonly string[],
  draggedTabId: string,
  targetTabId: string | undefined,
  placement: 'before' | 'after' | undefined
): string | undefined {
  const withoutDraggedTab = tabIds.filter((id) => id !== draggedTabId)
  if (!targetTabId) return withoutDraggedTab.at(-1)
  const targetIndex = withoutDraggedTab.indexOf(targetTabId)
  if (targetIndex === -1)
    return tabIds.indexOf(draggedTabId) > 0 ? tabIds[tabIds.indexOf(draggedTabId) - 1] : undefined
  if (placement === 'before') return withoutDraggedTab[targetIndex - 1]
  return targetTabId
}

function tabDropPlacement(
  target: HTMLElement,
  point: { x: number; y: number }
): 'before' | 'after' {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return 'after'
  return point.x < rect.left + rect.width / 2 ? 'before' : 'after'
}
