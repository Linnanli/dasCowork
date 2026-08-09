// @vitest-environment jsdom

import { isValidElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const adapters = vi.hoisted(() => ({
  repositionBrowserWorkspaceView: vi
    .fn<(tabId: string, viewId: string) => Promise<void>>()
    .mockResolvedValue(undefined),
  refitTerminalWorkspace: vi.fn<(tabId: string) => Promise<void>>().mockResolvedValue(undefined)
}))

vi.mock('../right-workspace/browser/browserWorkspaceMove', () => ({
  repositionBrowserWorkspaceView: adapters.repositionBrowserWorkspaceView
}))

vi.mock('../right-workspace/browser/BrowserWorkspace', () => ({ BrowserWorkspace: () => null }))

vi.mock('../right-workspace/terminal/terminalWorkspaceMove', () => ({
  refitTerminalWorkspace: adapters.refitTerminalWorkspace
}))

vi.mock('../right-workspace/terminal/TerminalWorkspace', () => ({ TerminalWorkspace: () => null }))

import { createWorkspaceContentRegistry } from './WorkspaceContentRegistry'
import type {
  WorkspaceContentLifecycleContext,
  WorkspaceContentRenderContext
} from './WorkspaceContentRegistry'
import type { WorkspaceTabRecord } from './workspaceTypes'

const lifecycleContext: WorkspaceContentLifecycleContext = {
  panelId: 'bottom',
  workspaceId: 'conversation:one',
  runtime: undefined
}

afterEach(() => vi.clearAllMocks())

describe('WorkspaceContentRegistry move lifecycle', () => {
  it('refits an existing terminal after it moves to another panel', async () => {
    await createWorkspaceContentRegistry().move(terminalTab('terminal:one'), lifecycleContext)

    expect(adapters.refitTerminalWorkspace).toHaveBeenCalledWith('terminal:one')
  })

  it('repositions and shows an existing browser view after it moves', async () => {
    await createWorkspaceContentRegistry().move(browserTab('browser:one'), {
      ...lifecycleContext,
      runtime: { browserViewId: 'view-1' }
    })

    expect(adapters.repositionBrowserWorkspaceView).toHaveBeenCalledWith('browser:one', 'view-1')
  })

  it('does not schedule browser work when the tab has no native view', async () => {
    await createWorkspaceContentRegistry().move(browserTab('browser:one'), lifecycleContext)

    expect(adapters.repositionBrowserWorkspaceView).not.toHaveBeenCalled()
  })
})

describe('WorkspaceContentRegistry terminal lifecycle', () => {
  it('opens another terminal in the panel that contains the current terminal', () => {
    const openTarget = vi.fn()
    const rendered = createWorkspaceContentRegistry().render(terminalTab('terminal:one'), {
      ...renderContext(openTarget),
      panelId: 'right'
    })

    if (!isValidElement<{ onOpenTerminal(): void }>(rendered)) {
      throw new Error('Expected a terminal workspace element.')
    }
    rendered.props.onOpenTerminal()

    expect(openTarget).toHaveBeenCalledWith({ type: 'terminal' }, { panelId: 'right' })
  })

  it('closes terminal tabs by stable session id from tab id', async () => {
    const close = vi.fn(async () => ({ sessionId: 'one' }))
    vi.stubGlobal('desktopApp', {
      workspace: { terminal: { close } }
    })

    await createWorkspaceContentRegistry().close(terminalTab('terminal:one'), lifecycleContext)

    expect(close).toHaveBeenCalledWith({ version: 2, sessionId: 'one' })
  })
})

describe('WorkspaceContentRegistry file tabs', () => {
  it('keeps the Files explorer open when it opens a preview file', () => {
    const openTarget = vi.fn()
    const rendered = createWorkspaceContentRegistry().render(fileTab('files:explorer', ''), {
      ...renderContext(openTarget),
      panelId: 'right'
    })

    if (
      !isValidElement<{
        onOpenFile(relativePath: string, title: string, mode?: 'preview' | 'pinned'): void
      }>(rendered)
    ) {
      throw new Error('Expected a file workspace element.')
    }
    const { onOpenFile } = rendered.props
    onOpenFile('README.md', 'README.md')

    expect(openTarget).toHaveBeenCalledWith(
      { type: 'file', relativePath: 'README.md', title: 'README.md' },
      { panelId: 'right', mode: 'preview' }
    )
  })
})

function terminalTab(id: string): WorkspaceTabRecord {
  return { id, kind: 'terminal', title: 'Terminal', props: {}, isPreview: false, isClosable: true }
}

function browserTab(id: string): WorkspaceTabRecord {
  return { id, kind: 'browser', title: 'Browser', props: {}, isPreview: false, isClosable: true }
}

function fileTab(id: string, relativePath: string): WorkspaceTabRecord {
  return {
    id,
    kind: 'file',
    title: relativePath || 'Files',
    props: { relativePath },
    isPreview: false,
    isClosable: true
  }
}

function renderContext(
  openTarget: WorkspaceContentRenderContext['openTarget']
): WorkspaceContentRenderContext {
  return {
    ...lifecycleContext,
    panel: {
      id: 'right',
      isOpen: true,
      isMaximized: false,
      size: 400,
      tabIds: ['files:explorer'],
      activeTabId: 'files:explorer',
      activationHistory: ['files:explorer']
    },
    target: undefined,
    openTarget,
    setTabTitle: vi.fn(),
    setRuntime: vi.fn()
  }
}
