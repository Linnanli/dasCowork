import { describe, expect, it } from 'vitest'

import {
  clampRightWorkspaceWidth,
  defaultRightWorkspaceState,
  RIGHT_WORKSPACE_MAX_WIDTH_RATIO,
  rightWorkspaceReducer,
  type RightWorkspaceState
} from './workspaceState'

describe('rightWorkspaceReducer', () => {
  it('limits a dragged workspace to 70% of the viewport without an additional pixel cap', () => {
    expect(clampRightWorkspaceWidth(2_000, 1_000)).toBe(
      Math.floor(1_000 * RIGHT_WORKSPACE_MAX_WIDTH_RATIO)
    )
    expect(clampRightWorkspaceWidth(2_000, 2_000)).toBe(
      Math.floor(2_000 * RIGHT_WORKSPACE_MAX_WIDTH_RATIO)
    )
  })

  it('keeps Review single and updates its requested source', () => {
    const opened = rightWorkspaceReducer(defaultRightWorkspaceState, {
      type: 'open-review',
      source: { type: 'unstaged' }
    })
    const repeated = rightWorkspaceReducer(opened, {
      type: 'open-review',
      source: { type: 'staged' }
    })

    expect(repeated.tabs).toHaveLength(1)
    expect(repeated.tabs[0]).toMatchObject({ id: 'review', source: { type: 'staged' } })
  })

  it('creates independent terminal tabs but deduplicates files by normalized path', () => {
    const first = rightWorkspaceReducer(defaultRightWorkspaceState, {
      type: 'open-tab',
      tab: { id: 'terminal-1', type: 'terminal', title: 'Terminal' }
    })
    const second = rightWorkspaceReducer(first, {
      type: 'open-tab',
      tab: { id: 'terminal-2', type: 'terminal', title: 'Terminal' }
    })
    const file = rightWorkspaceReducer(second, {
      type: 'open-file',
      relativePath: 'src/example.ts'
    })
    const repeatedFile = rightWorkspaceReducer(file, {
      type: 'open-file',
      relativePath: './src/example.ts'
    })

    expect(second.tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(2)
    expect(repeatedFile.tabs.filter((tab) => tab.type === 'file')).toHaveLength(1)
  })

  it('activates the left neighbour after closing the active tab and retains the empty launcher', () => {
    const state: RightWorkspaceState = {
      isOpen: true,
      isMaximized: false,
      panelWidth: 560,
      tabs: [
        { id: 'terminal-1', type: 'terminal', title: 'Terminal' },
        { id: 'browser-1', type: 'browser', title: 'New tab' }
      ],
      activeTabId: 'browser-1'
    }
    const afterClose = rightWorkspaceReducer(state, { type: 'close-tab', tabId: 'browser-1' })
    const empty = rightWorkspaceReducer(afterClose, { type: 'close-tab', tabId: 'terminal-1' })

    expect(afterClose.activeTabId).toBe('terminal-1')
    expect(empty).toMatchObject({ isOpen: true, tabs: [], activeTabId: undefined })
  })
})
