// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceTabStrip } from './WorkspaceTabStrip'
import { WorkspaceTabDragProvider } from './WorkspaceTabDragProvider'
import type { WorkspacePanelId, WorkspaceTabRecord } from './workspaceTypes'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const tabs: readonly WorkspaceTabRecord[] = [
  {
    id: 'A',
    kind: 'file',
    title: 'Alpha',
    props: {},
    isPreview: false,
    isClosable: true
  },
  {
    id: 'B',
    kind: 'terminal',
    title: 'Beta',
    props: {},
    isPreview: false,
    isClosable: true
  },
  {
    id: 'C',
    kind: 'browser',
    title: 'Gamma',
    props: {},
    isPreview: false,
    isClosable: true
  }
]

const bottomTabs: readonly WorkspaceTabRecord[] = [
  {
    id: 'D',
    kind: 'terminal',
    title: 'Delta',
    props: {},
    isPreview: false,
    isClosable: true
  },
  {
    id: 'E',
    kind: 'file',
    title: 'Epsilon',
    props: {},
    isPreview: false,
    isClosable: true
  }
]

class TestPointerEvent extends MouseEvent {
  pointerId: number
  isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.isPrimary = init.isPrimary ?? true
  }
}

class TestResizeObserver {
  observe(): void {
    return undefined
  }

  unobserve(): void {
    return undefined
  }

  disconnect(): void {
    return undefined
  }
}

describe('WorkspaceTabStrip', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('desktopApp', {
      nativeContextMenu: { show: vi.fn().mockResolvedValue(null) }
    })
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    document.elementFromPoint = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps a stable invisible source slot and shifts neighboring tabs while dragging', async () => {
    const onMove = vi.fn()
    await renderTabStrip({ onMove })
    stubTabRects()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(workspaceTab('B'))

    const alpha = workspaceTab('A')
    await dispatchPointer(alpha, 'pointerdown', { clientX: 10, clientY: 10 })
    await dispatchPointer(alpha, 'pointermove', { clientX: 155, clientY: 10 })
    await dispatchPointer(alpha, 'pointermove', { clientX: 156, clientY: 10 })

    expect(tabLabels()).toEqual(['Beta', 'Alpha', 'Gamma'])
    expect(workspaceTabContainer('A').className).toContain('opacity-0')
    expect(workspaceTabContainer('B').style.transform).toBe('translate3d(-104px, 0px, 0)')
    const overlay = document.querySelector<HTMLElement>('[data-workspace-drag-overlay="true"]')
    const overlayWrapper = overlay?.parentElement
    expect(overlay?.textContent).toContain('Alpha')
    expect(overlayWrapper?.parentElement).toBe(document.body)
    expect(overlayWrapper?.style.width).toBe('100px')
    expect(overlayWrapper?.style.height).toBe('28px')
    expect(overlayWrapper?.style.transform).toContain('translate3d(146px, 0px, 0)')
    expect(document.querySelector('.fixed.inset-0.cursor-grabbing')).not.toBeNull()

    await dispatchPointer(alpha, 'pointercancel', { clientX: 155, clientY: 10 })

    expect(tabLabels()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(workspaceTabContainer('A').className).not.toContain('opacity-0')
    expect(workspaceTabContainer('B').style.transform).toBe('')
    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).toBeNull()
    expect(document.querySelector('.fixed.inset-0.cursor-grabbing')).toBeNull()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('commits a same-panel drop once using before and after tab positioning', async () => {
    const onMove = vi.fn()
    await renderTabStrip({ onMove })
    stubTabRects()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(workspaceTab('B'))

    const gamma = workspaceTab('C')
    await dispatchPointer(gamma, 'pointerdown', { clientX: 230, clientY: 10 })
    await dispatchPointer(gamma, 'pointermove', { clientX: 120, clientY: 10 })
    await dispatchPointer(gamma, 'pointermove', { clientX: 119, clientY: 10 })
    expect(tabLabels()).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect(workspaceTabContainer('B').style.transform).toBe('translate3d(104px, 0px, 0)')

    await dispatchPointer(gamma, 'pointerup', { clientX: 120, clientY: 10 })

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('right', 'right', 'C', 'A')
    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).toBeNull()
  })

  it('inserts between cross-panel tabs without opening a gap at the far left', async () => {
    const onMove = vi.fn()
    await renderCrossPanelTabStrips(onMove)
    stubTabRects()
    stubTabRect('D', { left: 0, top: 100, width: 100 })
    stubTabRect('E', { left: 104, top: 100, width: 100 })
    stubStripRect('right', { left: 0, top: 0, width: 400 })
    stubStripRect('bottom', { left: 0, top: 100, width: 400 })

    const alpha = workspaceTab('A')
    await dispatchPointer(alpha, 'pointerdown', { clientX: 10, clientY: 10 })
    await dispatchPointer(alpha, 'pointermove', { clientX: 20, clientY: 10 })
    await dispatchPointer(document, 'pointermove', { clientX: 102, clientY: 110 })

    expect(tabLabels('right')).toEqual(['Beta', 'Gamma'])
    expect(tabLabels('bottom')).toEqual(['Delta', 'Alpha', 'Epsilon'])

    await dispatchPointer(document, 'pointerup', { clientX: 102, clientY: 110 })

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('right', 'bottom', 'A', 'D')
    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).toBeNull()
  })

  it('removes every drag layer when the window loses focus', async () => {
    const onMove = vi.fn()
    await renderTabStrip({ onMove })
    stubTabRects()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(workspaceTab('B'))

    const alpha = workspaceTab('A')
    await dispatchPointer(alpha, 'pointerdown', { clientX: 10, clientY: 10 })
    await dispatchPointer(alpha, 'pointermove', { clientX: 155, clientY: 10 })
    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).not.toBeNull()

    await act(async () => window.dispatchEvent(new Event('blur')))

    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).toBeNull()
    expect(workspaceTabContainer('A').className).not.toContain('opacity-0')
    expect(workspaceTabContainer('B').style.transform).toBe('')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('cleans up a drag after pointer capture is lost', async () => {
    const onMove = vi.fn()
    await renderTabStrip({ onMove })
    stubTabRects()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(workspaceTab('B'))

    const alpha = workspaceTab('A')
    await dispatchPointer(alpha, 'pointerdown', { clientX: 10, clientY: 10 })
    await dispatchPointer(alpha, 'pointermove', { clientX: 155, clientY: 10 })

    await act(async () => {
      alpha.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }))
    })

    expect(document.querySelector('[data-workspace-drag-overlay="true"]')).toBeNull()
    expect(workspaceTabContainer('A').className).not.toContain('opacity-0')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('uses the native menu for tab actions without rendering an ellipsis control', async () => {
    const showNativeMenu = vi.fn().mockResolvedValue('close-others')
    const onCloseOther = vi.fn()
    const onCloseToRight = vi.fn()
    vi.stubGlobal('desktopApp', { nativeContextMenu: { show: showNativeMenu } })
    await renderTabStrip({ onMove: vi.fn(), onCloseOther, onCloseToRight })

    await act(async () => {
      workspaceTab('A').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      )
      await Promise.resolve()
    })

    expect(showNativeMenu).toHaveBeenCalledWith([
      { type: 'action', id: 'close', label: '关闭' },
      { type: 'action', id: 'close-others', label: '关闭其他标签页' },
      { type: 'action', id: 'close-to-right', label: '关闭右侧标签页' }
    ])
    expect(onCloseOther).toHaveBeenCalledWith('A')
    expect(container.querySelector('[aria-label^="More actions for"]')).toBeNull()
  })
})

async function renderTabStrip({
  onMove,
  panelId = 'right',
  onCloseOther,
  onCloseToRight
}: {
  onMove: (
    sourcePanelId: WorkspacePanelId,
    destinationPanelId: WorkspacePanelId,
    tabId: string,
    insertAfterTabId?: string
  ) => void
  panelId?: WorkspacePanelId
  onCloseOther?: (tabId: string) => void
  onCloseToRight?: (tabId: string) => void
}): Promise<void> {
  await act(async () => {
    root.render(
      <WorkspaceTabStrip
        panelId={panelId}
        tabs={tabs}
        activeTabId="A"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseOther={onCloseOther}
        onCloseToRight={onCloseToRight}
        onOpen={vi.fn()}
        onMove={onMove}
      />
    )
  })
}

async function renderCrossPanelTabStrips(onMove: WorkspaceTabStripPropsOnMove): Promise<void> {
  await act(async () => {
    root.render(
      <WorkspaceTabDragProvider>
        <WorkspaceTabStrip
          panelId="right"
          tabs={tabs}
          activeTabId="A"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onMove={onMove}
        />
        <WorkspaceTabStrip
          panelId="bottom"
          tabs={bottomTabs}
          activeTabId="D"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onMove={onMove}
        />
      </WorkspaceTabDragProvider>
    )
  })
}

type WorkspaceTabStripPropsOnMove = (
  sourcePanelId: WorkspacePanelId,
  destinationPanelId: WorkspacePanelId,
  tabId: string,
  insertAfterTabId?: string
) => void

async function dispatchPointer(
  element: EventTarget,
  type: string,
  init: PointerEventInit
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }))
  })
}

function workspaceTab(tabId: string): HTMLButtonElement {
  const tab = document.querySelector<HTMLButtonElement>(
    `[data-workspace-tab-id="${tabId}"][role="tab"]`
  )
  if (!tab) throw new Error(`Expected workspace tab ${tabId}`)
  return tab
}

function stubTabRects(): void {
  stubTabRect('A', { left: 0, width: 100 })
  stubTabRect('B', { left: 104, width: 100 })
  stubTabRect('C', { left: 208, width: 100 })
}

function stubTabRect(tabId: string, rect: { left: number; top?: number; width: number }): void {
  const top = rect.top ?? 0
  const completeRect = {
    ...rect,
    top,
    right: rect.left + rect.width,
    bottom: top + 28,
    height: 28
  }
  for (const element of [workspaceTab(tabId), workspaceTabContainer(tabId)]) {
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => completeRect
    })
  }
}

function stubStripRect(
  panelId: WorkspacePanelId,
  rect: { left: number; top: number; width: number }
): void {
  const strip = document.querySelector<HTMLElement>(
    `[data-workspace-tab-strip="true"][data-workspace-panel-id="${panelId}"]`
  )
  if (!strip) throw new Error(`Expected workspace tab strip ${panelId}`)
  Object.defineProperty(strip, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + 28,
      height: 28
    })
  })
}

function workspaceTabContainer(tabId: string): HTMLDivElement {
  const tab = document.querySelector<HTMLDivElement>(
    `[data-workspace-tab-container="true"][data-workspace-tab-id="${tabId}"]`
  )
  if (!tab) throw new Error(`Expected workspace tab container ${tabId}`)
  return tab
}

function tabLabels(panelId?: WorkspacePanelId): string[] {
  const selector = panelId ? `[role="tab"][data-workspace-panel-id="${panelId}"]` : '[role="tab"]'
  return [...document.querySelectorAll<HTMLButtonElement>(selector)].map(
    (tab) => tab.textContent ?? ''
  )
}
