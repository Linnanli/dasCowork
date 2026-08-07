import type { WorkspacePanelId } from './workspaceTypes'

export function adjacentWorkspaceTabId(
  tabIds: readonly string[],
  activeTabId: string | undefined,
  direction: -1 | 1
): string | undefined {
  if (!tabIds.length) return undefined
  const currentIndex = Math.max(0, tabIds.indexOf(activeTabId ?? ''))
  return tabIds[(currentIndex + direction + tabIds.length) % tabIds.length]
}

export function isWorkspaceEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], .cm-content, .xterm, [role="textbox"]'
    )
  )
}

export function workspacePanelFromData(value: string | undefined): WorkspacePanelId | undefined {
  return value === 'right' || value === 'bottom' ? value : undefined
}
