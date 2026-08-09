import { describe, expect, it } from 'vitest'

import { createWorkspaceContainerState, workspaceContainerReducer } from './workspaceReducer'
import {
  legacyRightWorkspaceStorageKey,
  loadWorkspaceContainerState,
  persistWorkspaceContainerState,
  workspaceContainerStorageKey
} from './workspacePersistence'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    }
  }
}

describe('workspace persistence', () => {
  it('persists only serializable records and never runtime resource handles', () => {
    const storage = memoryStorage()
    let state = workspaceContainerReducer(createWorkspaceContainerState(), {
      type: 'open-tab',
      panelId: 'right',
      tab: {
        id: 'terminal-1',
        kind: 'terminal',
        title: 'Terminal',
        props: {},
        isPreview: false,
        isClosable: true
      }
    })
    state = workspaceContainerReducer(state, {
      type: 'set-tab-runtime',
      tabId: 'terminal-1',
      runtime: { browserViewId: 'view-1' }
    })

    persistWorkspaceContainerState(storage, 'conversation', state)
    const raw = storage.getItem(workspaceContainerStorageKey('conversation')) ?? ''
    expect(raw).not.toContain('view-1')
    expect(loadWorkspaceContainerState(storage, 'conversation').runtime).toEqual({})
  })

  it('migrates the legacy right-workspace payload without deleting its rollback key', () => {
    const storage = memoryStorage()
    storage.setItem(
      legacyRightWorkspaceStorageKey('conversation'),
      JSON.stringify({
        isOpen: true,
        isMaximized: true,
        panelWidth: 700,
        activeTabId: 'file:src/main.ts',
        tabs: [
          { id: 'review', type: 'review', title: 'Review', source: { type: 'staged' } },
          { id: 'file:src/main.ts', type: 'file', title: 'main.ts', relativePath: 'src/main.ts' },
          { id: 'terminal-1', type: 'terminal', title: 'Terminal', terminalSessionId: 'ignored' }
        ]
      })
    )

    const migrated = loadWorkspaceContainerState(storage, 'conversation')
    expect(migrated.panels.right).toMatchObject({
      isOpen: true,
      isMaximized: true,
      size: 700,
      activeTabId: 'file:src/main.ts'
    })
    expect(migrated.panels.right.tabIds).toEqual(['review', 'file:src/main.ts', 'terminal-1'])
    expect(migrated.tabs['file:src/main.ts'].props).toEqual({ relativePath: 'src/main.ts' })
    expect(migrated.runtime).toEqual({})
    expect(storage.getItem(legacyRightWorkspaceStorageKey('conversation'))).not.toBeNull()
  })

  it('restores terminal tabs from a previous renderer-local scope into the durable scope', () => {
    const storage = memoryStorage()
    let state = workspaceContainerReducer(createWorkspaceContainerState(), {
      type: 'open-tab',
      panelId: 'right',
      tab: {
        id: 'terminal:stable-session',
        kind: 'terminal',
        title: 'Terminal',
        props: {},
        isPreview: false,
        isClosable: true
      }
    })
    state = workspaceContainerReducer(state, {
      type: 'set-tab-title',
      tabId: 'terminal:stable-session',
      title: 'zsh'
    })
    persistWorkspaceContainerState(storage, 'local-conversation-id', state)

    const restored = loadWorkspaceContainerState(storage, 'thread-id', ['local-conversation-id'])

    expect(restored.panels.right).toMatchObject({
      isOpen: true,
      activeTabId: 'terminal:stable-session'
    })
    expect(restored.panels.right.tabIds).toEqual(['terminal:stable-session'])
    expect(restored.tabs['terminal:stable-session']).toMatchObject({
      id: 'terminal:stable-session',
      kind: 'terminal',
      title: 'zsh'
    })
    expect(restored.runtime).toEqual({})
  })

  it('keeps an empty workspace panel open while its local scope becomes durable', () => {
    const storage = memoryStorage()
    const openState = workspaceContainerReducer(createWorkspaceContainerState(), {
      type: 'set-panel-open',
      panelId: 'right',
      isOpen: true
    })
    persistWorkspaceContainerState(storage, 'local-conversation-id', openState)

    const restored = loadWorkspaceContainerState(storage, 'thread-id', ['local-conversation-id'])

    expect(restored.panels.right.isOpen).toBe(true)
    expect(restored.panels.right.tabIds).toEqual([])
  })

  it('safely falls back for corrupt and unknown-version payloads', () => {
    const storage = memoryStorage()
    storage.setItem(workspaceContainerStorageKey('corrupt'), '{')
    expect(loadWorkspaceContainerState(storage, 'corrupt').panels.right.tabIds).toEqual([])

    storage.setItem(workspaceContainerStorageKey('future'), JSON.stringify({ version: 999 }))
    expect(loadWorkspaceContainerState(storage, 'future').panels.bottom.tabIds).toEqual([])
  })
})
