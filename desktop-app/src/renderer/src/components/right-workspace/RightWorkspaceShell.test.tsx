// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RightWorkspaceProvider, useRightWorkspace } from './RightWorkspaceProvider'
import { RightWorkspaceShell } from './RightWorkspaceShell'
import { RIGHT_WORKSPACE_MAX_WIDTH_RATIO, RIGHT_WORKSPACE_MIN_WIDTH } from './workspaceState'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const RESIZE_RAIL_SIZE = 8
const COLLAPSE_THRESHOLD = RIGHT_WORKSPACE_MIN_WIDTH / 2

class TestPointerEvent extends MouseEvent {
  pointerId: number

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

describe('RightWorkspaceShell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    HTMLElement.prototype.setPointerCapture = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders no workspace launcher until an external control opens the panel', async () => {
    await act(async () => {
      root.render(
        <RightWorkspaceProvider projectScope="shell-test">
          <RightWorkspaceShell />
          <WorkspaceTestControls />
        </RightWorkspaceProvider>
      )
    })

    expect(container.querySelector('[aria-label="Right workspace launcher"]')).toBeNull()
    expect(container.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('aside')?.style.width).toBe('0px')
    expect(container.querySelector('aside')?.style.transform).toBe('')

    await act(async () => buttonWithLabel('Open workspace')?.click())
    await act(async () => buttonWithLabel('Open Browser')?.click())
    expect(document.body.textContent).toContain('New tab')

    // The shell must be allowed to honor its configured width even when a tab
    // contains an unbreakable surface such as a terminal.
    expect(container.querySelector('aside')?.className).toContain('min-w-0')
    expect(container.querySelector('aside')?.className).toContain('transition-[width]')
    expect(container.querySelector('aside')?.className).toContain('bg-background')
    expect(container.querySelector('aside')?.style.transform).toBe('')
    expect(
      container.querySelector<HTMLElement>('[data-slot="right-workspace-viewport"]')?.className
    ).toContain('overflow-hidden')
    const workspaceSurface = container.querySelector<HTMLElement>(
      '[data-slot="right-workspace-surface"]'
    )
    expect(workspaceSurface?.className).toContain('absolute')
    expect(workspaceSurface?.className).toContain('bg-background')
    expect(workspaceSurface?.className).toContain('[contain:layout_paint]')
    expect(workspaceSurface?.style.width).toBe(container.querySelector('aside')?.style.width)
    expect(workspaceSurface?.style.minWidth).toBe(workspaceSurface?.style.width)
    const resizeHandle = container.querySelector('[aria-label="Resize workspace"]')
    expect(resizeHandle?.className).toContain('bg-transparent')
    expect(resizeHandle?.querySelector('[aria-hidden="true"]')?.className).toContain('w-px')

    await act(async () => buttonWithLabel('Set maximum workspace width')?.click())
    expect(parseFloat(container.querySelector('aside')?.style.width ?? '')).toBeCloseTo(
      window.innerWidth * RIGHT_WORKSPACE_MAX_WIDTH_RATIO
    )

    await act(async () => buttonWithLabel('Collapse workspace')?.click())
    expect(container.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('aside')?.style.width).toBe('0px')
    expect(container.querySelector('aside')?.style.transform).toBe('')
    expect(container.querySelector('[data-slot="right-workspace-surface"]')).not.toBeNull()
    expect(document.body.textContent).toContain('New tab')

    await act(async () => finishWidthTransition(container.querySelector('aside')))
    expect(container.querySelector('[data-slot="right-workspace-surface"]')).toBeNull()
    expect(document.body.textContent).not.toContain('New tab')

    await act(async () => buttonWithLabel('Open workspace')?.click())
    await act(async () => buttonWithLabel('Maximize workspace')?.click())
    expect(container.querySelector('aside')?.className).toContain('absolute')
  })

  it('uses tablist semantics and arrow keys to switch the active tab', async () => {
    await act(async () => {
      root.render(
        <RightWorkspaceProvider projectScope="keyboard-test">
          <RightWorkspaceShell />
          <WorkspaceTestControls />
        </RightWorkspaceProvider>
      )
    })

    await act(async () => buttonWithLabel('Open workspace')?.click())
    await act(async () => buttonWithLabel('Open Browser')?.click())
    await act(async () => buttonWithLabel('Open terminal')?.click())

    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(document.body.querySelector('[role="tablist"]')).not.toBeNull()
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-controls')).toBe('right-workspace-tab-panel')
    expect(tabs[0].getAttribute('data-slot')).toBe('button')
    expect(tabs[0].getAttribute('data-variant')).toBe('ghost')
    expect(tabs[0].getAttribute('data-size')).toBe('xs')
    expect(tabs[0].parentElement?.getAttribute('data-slot')).toBeNull()
    expect(tabs[0].className).toContain('font-normal')

    await act(async () => {
      tabs[0].focus()
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })
    const updatedTabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(updatedTabs[1]).toBe(document.activeElement)
    expect(updatedTabs[1].getAttribute('aria-selected')).toBe('true')
  })

  it('holds at the minimum width before collapsing and can reopen during the same drag', async () => {
    await act(async () => {
      root.render(
        <RightWorkspaceProvider projectScope="resize-collapse-test">
          <RightWorkspaceShell />
          <WorkspaceTestControls />
        </RightWorkspaceProvider>
      )
    })

    await act(async () => buttonWithLabel('Open workspace')?.click())
    await act(async () => buttonWithLabel('Open Browser')?.click())

    const shell = container.querySelector<HTMLElement>('[data-slot="right-workspace-shell"]')
    const resizeHandle = buttonWithLabel('Resize workspace')
    const initialSize = parseFloat(shell?.style.width ?? '')

    expect(initialSize).toBeGreaterThan(RIGHT_WORKSPACE_MIN_WIDTH)
    expect(resizeHandle).toBeDefined()

    await dispatchPointer(resizeHandle!, 'pointerdown', { clientX: 0 })
    await dispatchPointer(window, 'pointermove', {
      clientX: initialSize - (RIGHT_WORKSPACE_MIN_WIDTH - 20 + RESIZE_RAIL_SIZE)
    })

    expect(shell?.getAttribute('aria-hidden')).toBe('false')
    expect(shell?.style.width).toBe(`${RIGHT_WORKSPACE_MIN_WIDTH + RESIZE_RAIL_SIZE}px`)

    await dispatchPointer(window, 'pointermove', {
      clientX: initialSize - (COLLAPSE_THRESHOLD - 1 + RESIZE_RAIL_SIZE)
    })

    expect(shell?.getAttribute('aria-hidden')).toBe('true')
    expect(shell?.style.width).toBe('0px')
    expect(buttonWithLabel('Resize workspace')).toBeDefined()

    await dispatchPointer(window, 'pointermove', {
      clientX: initialSize - (COLLAPSE_THRESHOLD + 40 + RESIZE_RAIL_SIZE)
    })

    expect(shell?.getAttribute('aria-hidden')).toBe('false')
    expect(shell?.style.width).toBe(`${RIGHT_WORKSPACE_MIN_WIDTH + RESIZE_RAIL_SIZE}px`)

    await dispatchPointer(window, 'pointermove', {
      clientX: initialSize - (400 + RESIZE_RAIL_SIZE)
    })

    expect(shell?.style.width).toBe('408px')
    await dispatchPointer(window, 'pointerup', {})
  })
})

function WorkspaceTestControls(): React.JSX.Element {
  const { collapse, openTab, restore, setPanelWidth, toggleMaximized } = useRightWorkspace()

  return (
    <div>
      <button aria-label="Open workspace" onClick={restore} type="button" />
      <button aria-label="Collapse workspace" onClick={collapse} type="button" />
      <button aria-label="Maximize workspace" onClick={toggleMaximized} type="button" />
      <button aria-label="Open Browser" onClick={() => openTab('browser')} type="button" />
      <button aria-label="Open terminal" onClick={() => openTab('terminal')} type="button" />
      <button
        aria-label="Set maximum workspace width"
        onClick={() => setPanelWidth(100_000)}
        type="button"
      />
    </div>
  )
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === label
  )
}

function finishWidthTransition(element: Element | null): void {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: 'width' })
  element?.dispatchEvent(event)
}

async function dispatchPointer(
  element: EventTarget,
  type: string,
  init: PointerEventInit
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }))
  })
}
