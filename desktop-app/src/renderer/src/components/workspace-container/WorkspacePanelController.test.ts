// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { WorkspaceContentRegistry } from './WorkspaceContentRegistry'
import { WorkspacePanelController } from './WorkspacePanelController'
import { createWorkspaceContainerState, workspaceContainerReducer } from './workspaceReducer'
import type {
  WorkspaceContainerAction,
  WorkspaceContainerState,
  WorkspaceTabRecord
} from './workspaceTypes'

const terminal = (id: string): WorkspaceTabRecord => ({
  id,
  kind: 'terminal',
  title: 'Terminal',
  props: {},
  isPreview: false,
  isClosable: true
})

const previewFile = (id: string): WorkspaceTabRecord => ({
  id,
  kind: 'file',
  title: id,
  props: { relativePath: id },
  isPreview: true,
  isClosable: true
})

const pinnedFile = (id: string): WorkspaceTabRecord => ({
  ...previewFile(id),
  isPreview: false
})

const filesExplorer = (): WorkspaceTabRecord => ({
  id: 'files:explorer',
  kind: 'file',
  title: 'Files',
  props: { relativePath: '' },
  isPreview: false,
  isClosable: true
})

describe('WorkspacePanelController', () => {
  it('opens an explicitly targeted terminal in the bottom panel', async () => {
    const store = createStore(createWorkspaceContainerState())
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry(),
      workspaceId: 'conversation:one'
    })

    await controller.open({ type: 'terminal', id: 'terminal:bottom' }, { panelId: 'bottom' })

    const state = store.getState()
    expect(state.panels.bottom.tabIds).toEqual(['terminal:bottom'])
    expect(state.panels.bottom.isOpen).toBe(true)
    expect(state.panels.right.tabIds).toEqual([])
    expect(state.lastFocusedPanelId).toBe('bottom')
  })

  it('does not commit a bulk close when the one confirmation is cancelled', async () => {
    const state = openedTerminalState()
    const store = createStore(state)
    vi.stubGlobal('desktopApp', {
      workspace: {
        terminal: {
          list: vi.fn(async () => ({
            version: 2,
            sessions: [sampleSession('one'), sampleSession('two')]
          }))
        }
      }
    })
    const close = vi.fn()
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'terminal',
        render: () => null,
        onClose: close
      }),
      workspaceId: 'conversation:one',
      confirmTerminalClose: vi.fn().mockResolvedValue(false)
    })

    await controller.closeOther('right', 'terminal:one')

    expect(store.getState().panels.right.tabIds).toEqual(['terminal:one', 'terminal:two'])
    expect(close).not.toHaveBeenCalled()
  })

  it('does not commit a close when an adapter vetoes before close', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('A')
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('B')
    })
    const beforeClose = vi.fn((tab: WorkspaceTabRecord) => tab.id !== 'B')
    const close = vi.fn()
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onBeforeClose: beforeClose,
        onClose: close
      }),
      workspaceId: 'conversation:one'
    })

    await controller.closeOther('right', 'A')

    expect(store.getState().panels.right.tabIds).toEqual(['A', 'B'])
    expect(beforeClose).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('closes a preview through one lifecycle pipeline before replacing it', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: previewFile('A')
    })
    const close = vi.fn()
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onClose: close
      }),
      workspaceId: 'conversation:one'
    })

    await controller.open(
      { type: 'file', relativePath: 'B' },
      { panelId: 'right', mode: 'preview' }
    )

    expect(store.getState().panels.right.tabIds).toEqual(['file:B'])
    expect(close).toHaveBeenCalledTimes(1)
    expect(close.mock.calls[0][0].id).toBe('A')
  })

  it('does not replace a preview when its before-close guard vetoes', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: previewFile('A')
    })
    const beforeClose = vi.fn().mockResolvedValue(false)
    const close = vi.fn()
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onBeforeClose: beforeClose,
        onClose: close
      }),
      workspaceId: 'conversation:one'
    })

    await controller.open(
      { type: 'file', relativePath: 'B' },
      { panelId: 'right', mode: 'preview' }
    )

    expect(store.getState().panels.right.tabIds).toEqual(['A'])
    expect(store.getState().tabs.A).toBeDefined()
    expect(store.getState().tabs['file:B']).toBeUndefined()
    expect(beforeClose).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('reuses the replaced preview tab position instead of jumping to the active tab', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: previewFile('A')
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: { ...terminal('terminal:one'), isPreview: false }
    })
    state = workspaceContainerReducer(state, {
      type: 'activate-tab',
      panelId: 'right',
      tabId: 'terminal:one'
    })
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({ kind: 'file', render: () => null }),
      workspaceId: 'conversation:one'
    })

    await controller.open(
      { type: 'file', relativePath: 'B' },
      { panelId: 'right', mode: 'preview' }
    )

    expect(store.getState().panels.right.tabIds).toEqual(['file:B', 'terminal:one'])
  })

  it('replaces the empty Files workspace when its tree selects a file', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: terminal('terminal:one')
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: filesExplorer()
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: terminal('terminal:two')
    })
    state = workspaceContainerReducer(state, {
      type: 'activate-tab',
      panelId: 'right',
      tabId: 'files:explorer'
    })
    const close = vi.fn()
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onClose: close
      }),
      workspaceId: 'conversation:one'
    })

    await controller.open(
      { type: 'file', relativePath: 'src/App.tsx' },
      { panelId: 'right', mode: 'pinned', replaceTabId: 'files:explorer' }
    )

    expect(store.getState().panels.right.tabIds).toEqual([
      'terminal:one',
      'file:src/App.tsx',
      'terminal:two'
    ])
    expect(store.getState().panels.right.activeTabId).toBe('file:src/App.tsx')
    expect(store.getState().tabs['file:src/App.tsx'].isPreview).toBe(false)
    expect(close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'files:explorer' }),
      expect.any(Object)
    )
  })

  it('moves a terminal without calling its close lifecycle or losing unrelated runtime state', async () => {
    let state = openedTerminalState()
    state = workspaceContainerReducer(state, {
      type: 'set-tab-runtime',
      tabId: 'terminal:one',
      runtime: { browserViewId: 'view-1' }
    })
    const close = vi.fn()
    const move = vi.fn()
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'terminal',
        render: () => null,
        onClose: close,
        onMove: move
      }),
      workspaceId: 'conversation:one'
    })

    await controller.move('right', 'bottom', 'terminal:one')

    expect(store.getState().panels.bottom.tabIds).toEqual(['terminal:one'])
    expect(store.getState().runtime['terminal:one']).toEqual({ browserViewId: 'view-1' })
    expect(close).not.toHaveBeenCalled()
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('uses v2 terminal list and stable tab session ids for the running close guard', async () => {
    const list = vi.fn(async () => ({
      version: 2,
      sessions: [sampleSession('one'), sampleSession('two')]
    }))
    vi.stubGlobal('desktopApp', { workspace: { terminal: { list } } })
    const store = createStore(openedTerminalState())
    const confirmTerminalClose = vi.fn(async () => false)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({ kind: 'terminal', render: () => null }),
      workspaceId: 'conversation:one',
      confirmTerminalClose
    })

    await controller.closeOther('right', 'terminal:one')

    expect(list).toHaveBeenCalledWith({ version: 2, workspaceId: 'conversation:one' })
    expect(confirmTerminalClose).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'terminal:two' })
    ])
  })

  it('runs deactivate before state change cleanup and activate after active tab changes', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('A')
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('B')
    })
    const events: string[] = []
    const store = createStore(state, (action) => {
      if (action.type === 'close-tabs') {
        events.push(`dispatch:${store.getState().panels.right.activeTabId ?? 'none'}`)
      }
    })
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onDeactivate: (tab) => {
          events.push(`deactivate:${tab.id}:${store.getState().panels.right.activeTabId ?? 'none'}`)
        },
        onClose: (tab) => {
          events.push(`close:${tab.id}:${store.getState().panels.right.activeTabId ?? 'none'}`)
        },
        onActivate: (tab) => {
          events.push(`activate:${tab.id}:${store.getState().panels.right.activeTabId ?? 'none'}`)
        }
      }),
      workspaceId: 'conversation:one'
    })

    await controller.close('right', 'B')

    expect(events).toEqual(['deactivate:B:B', 'dispatch:B', 'close:B:A', 'activate:A:A'])
  })

  it('runs lifecycle hooks when controller activation changes tabs', async () => {
    let state = createWorkspaceContainerState()
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('A')
    })
    state = workspaceContainerReducer(state, {
      type: 'open-tab',
      panelId: 'right',
      tab: pinnedFile('B')
    })
    const events: string[] = []
    const store = createStore(state)
    const controller = new WorkspacePanelController({
      ...store,
      registry: new WorkspaceContentRegistry().register({
        kind: 'file',
        render: () => null,
        onDeactivate: (tab) => {
          events.push(`deactivate:${tab.id}`)
        },
        onActivate: (tab) => {
          events.push(`activate:${tab.id}`)
        }
      }),
      workspaceId: 'conversation:one'
    })

    await controller.activate('right', 'A')

    expect(store.getState().panels.right.activeTabId).toBe('A')
    expect(events).toEqual(['deactivate:B', 'activate:A'])
  })
})

function createStore(initial: WorkspaceContainerState): {
  getState(): WorkspaceContainerState
  dispatch(action: WorkspaceContainerAction): void
}
function createStore(
  initial: WorkspaceContainerState,
  beforeDispatch: (action: WorkspaceContainerAction) => void
): {
  getState(): WorkspaceContainerState
  dispatch(action: WorkspaceContainerAction): void
}
function createStore(
  initial: WorkspaceContainerState,
  beforeDispatch?: (action: WorkspaceContainerAction) => void
): {
  getState(): WorkspaceContainerState
  dispatch(action: WorkspaceContainerAction): void
} {
  let state = initial
  return {
    getState: () => state,
    dispatch: (action) => {
      beforeDispatch?.(action)
      state = workspaceContainerReducer(state, action)
    }
  }
}

function openedTerminalState(): WorkspaceContainerState {
  let state = createWorkspaceContainerState()
  state = workspaceContainerReducer(state, {
    type: 'open-tab',
    panelId: 'right',
    tab: terminal('terminal:one')
  })
  return workspaceContainerReducer(state, {
    type: 'open-tab',
    panelId: 'right',
    tab: terminal('terminal:two')
  })
}

function sampleSession(sessionId: string): {
  sessionId: string
  status: 'running'
} {
  return { sessionId, status: 'running' }
}
