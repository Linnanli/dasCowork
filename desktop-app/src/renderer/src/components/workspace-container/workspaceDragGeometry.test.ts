// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  hasCrossedWorkspaceDragThreshold,
  insertAfterTabIdForWorkspaceDrop,
  reorderTabAfter,
  workspaceDragDropTargetFromElement
} from './workspaceDragGeometry'

describe('workspace drag geometry', () => {
  it('requires a 6px pointer movement before starting a drag', () => {
    expect(hasCrossedWorkspaceDragThreshold({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false)
    expect(hasCrossedWorkspaceDragThreshold({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true)
  })

  it('reorders without duplicating the dragged id', () => {
    expect(reorderTabAfter(['A', 'B', 'C'], 'A', 'B')).toEqual(['B', 'A', 'C'])
    expect(reorderTabAfter(['A', 'B', 'C'], 'B', undefined)).toEqual(['B', 'A', 'C'])
  })

  it('reads workspace drop targets from tab and panel elements', () => {
    const panel = document.createElement('div')
    panel.dataset.workspaceDropPanel = 'true'
    panel.dataset.workspacePanelId = 'bottom'
    const tab = document.createElement('button')
    tab.dataset.workspaceTab = 'true'
    tab.dataset.workspacePanelId = 'right'
    tab.dataset.workspaceTabId = 'terminal:one'
    const child = document.createElement('span')
    tab.append(child)
    Object.defineProperty(tab, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, width: 100 })
    })

    expect(workspaceDragDropTargetFromElement(child, { x: 30, y: 0 })).toEqual({
      panelId: 'right',
      tabId: 'terminal:one',
      placement: 'before'
    })
    expect(workspaceDragDropTargetFromElement(panel)).toEqual({ panelId: 'bottom' })
  })

  it('chooses a stable insert-after id for same-panel drag previews', () => {
    expect(insertAfterTabIdForWorkspaceDrop(['A', 'B', 'C'], 'A', 'B', 'after')).toBe('B')
    expect(insertAfterTabIdForWorkspaceDrop(['A', 'B', 'C'], 'C', 'B', 'before')).toBe('A')
    expect(insertAfterTabIdForWorkspaceDrop(['A', 'B', 'C'], 'C', undefined, undefined)).toBe('B')
    expect(insertAfterTabIdForWorkspaceDrop(['A'], 'A', 'A', 'before')).toBeUndefined()
  })
})
