import { describe, expect, it } from 'vitest'

import {
  createWorkspaceContainerState,
  panelTabs,
  previewReplacementCandidate,
  workspaceContainerReducer
} from './workspaceReducer'
import type {
  WorkspaceContainerState,
  WorkspacePanelId,
  WorkspaceTabRecord
} from './workspaceTypes'

const file = (id: string, isPreview = false): WorkspaceTabRecord => ({
  id,
  kind: 'file',
  title: id,
  props: { relativePath: id },
  isPreview,
  isClosable: true
})

describe('workspaceContainerReducer', () => {
  for (const panelId of ['right', 'bottom'] as const satisfies readonly WorkspacePanelId[]) {
    describe(`${panelId} panel`, () => {
      it('updates an existing stable id instead of inserting it twice', () => {
        const first = reduce(createWorkspaceContainerState(), {
          type: 'open-tab',
          panelId,
          tab: file('A')
        })
        const repeated = reduce(first, {
          type: 'open-tab',
          panelId,
          tab: { ...file('A'), title: 'Updated title' }
        })

        expect(panelTabs(repeated, panelId)).toHaveLength(1)
        expect(repeated.tabs.A.title).toBe('Updated title')
        expect(repeated.panels[panelId].activeTabId).toBe('A')
      })

      it('reuses one preview slot but keeps pinned tabs', () => {
        const first = reduce(createWorkspaceContainerState(), {
          type: 'open-tab',
          panelId,
          tab: file('A', true)
        })
        const pinned = reduce(first, { type: 'pin-tab', tabId: 'A' })
        const openedPreview = reduce(pinned, {
          type: 'open-tab',
          panelId,
          tab: file('B', true)
        })

        expect(panelTabs(openedPreview, panelId).map((tab) => tab.id)).toEqual(['A', 'B'])
        expect(openedPreview.tabs.A.isPreview).toBe(false)
        expect(openedPreview.tabs.B.isPreview).toBe(true)

        const replacement = previewReplacementCandidate(openedPreview, panelId, 'C')
        expect(replacement?.id).toBe('B')
        const replaced = reduce(openedPreview, {
          type: 'open-tab',
          panelId,
          tab: file('C', true)
        })
        expect(panelTabs(replaced, panelId).map((tab) => tab.id)).toEqual(['A', 'C'])
      })

      it('uses MRU history when an active tab is closed and collapses when empty', () => {
        let state = reduce(createWorkspaceContainerState(), {
          type: 'open-tab',
          panelId,
          tab: file('A')
        })
        state = reduce(state, { type: 'open-tab', panelId, tab: file('B') })
        state = reduce(state, { type: 'open-tab', panelId, tab: file('C') })
        state = reduce(state, { type: 'activate-tab', panelId, tabId: 'B' })
        state = reduce(state, { type: 'activate-tab', panelId, tabId: 'C' })
        state = reduce(state, { type: 'close-tab', panelId, tabId: 'C' })

        expect(state.panels[panelId].activeTabId).toBe('B')
        state = reduce(state, { type: 'close-tabs', panelId, tabIds: ['A', 'B'] })
        expect(state.panels[panelId]).toMatchObject({
          isOpen: false,
          activeTabId: undefined,
          tabIds: []
        })
      })
    })
  }

  it('does not downgrade a pinned tab when a later preview request targets it', () => {
    const opened = reduce(createWorkspaceContainerState(), {
      type: 'open-tab',
      panelId: 'right',
      tab: file('A')
    })
    const repeated = reduce(opened, {
      type: 'open-tab',
      panelId: 'right',
      tab: file('A', true)
    })
    expect(repeated.tabs.A.isPreview).toBe(false)
  })

  it('moves runtime-owning tabs without recreating their runtime state', () => {
    let state = reduce(createWorkspaceContainerState(), {
      type: 'open-tab',
      panelId: 'right',
      tab: file('terminal-1')
    })
    state = reduce(state, {
      type: 'set-tab-runtime',
      tabId: 'terminal-1',
      runtime: { terminalSessionId: 'pty-123' }
    })
    state = reduce(state, {
      type: 'move-tab',
      sourcePanelId: 'right',
      destinationPanelId: 'bottom',
      tabId: 'terminal-1'
    })

    expect(state.panels.right.tabIds).toEqual([])
    expect(state.panels.bottom).toMatchObject({ isOpen: true, activeTabId: 'terminal-1' })
    expect(state.runtime['terminal-1']).toEqual({ terminalSessionId: 'pty-123' })
  })

  it('rejects a move into a panel that already contains the same id', () => {
    const state = stateWithDuplicateIdForSafetyTest()
    const moved = reduce(state, {
      type: 'move-tab',
      sourcePanelId: 'right',
      destinationPanelId: 'bottom',
      tabId: 'A'
    })
    expect(moved).toBe(state)
  })

  it('allows only one maximized panel at a time', () => {
    const right = reduce(createWorkspaceContainerState(), {
      type: 'toggle-panel-maximized',
      panelId: 'right'
    })
    const bottom = reduce(right, { type: 'toggle-panel-maximized', panelId: 'bottom' })
    expect(bottom.panels.right.isMaximized).toBe(false)
    expect(bottom.panels.bottom.isMaximized).toBe(true)
  })
})

function reduce(
  state: WorkspaceContainerState,
  action: Parameters<typeof workspaceContainerReducer>[1]
): WorkspaceContainerState {
  return workspaceContainerReducer(state, action)
}

function stateWithDuplicateIdForSafetyTest(): WorkspaceContainerState {
  const tab = file('A')
  return createWorkspaceContainerState({
    tabs: { A: tab },
    panels: {
      right: {
        id: 'right',
        isOpen: true,
        isMaximized: false,
        size: 560,
        tabIds: ['A'],
        activationHistory: ['A'],
        activeTabId: 'A'
      },
      bottom: {
        id: 'bottom',
        isOpen: true,
        isMaximized: false,
        size: 320,
        tabIds: ['A'],
        activationHistory: ['A'],
        activeTabId: 'A'
      }
    }
  })
}
