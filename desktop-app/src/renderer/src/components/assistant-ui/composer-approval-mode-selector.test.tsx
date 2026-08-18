// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FullAccessConfirmationStore } from '../../runtime/FullAccessConfirmationStore'

import { ComposerApprovalModeSelector } from './composer-approval-mode-selector'
import { sandboxDocumentationUrl } from './composer-approval-mode-options'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class MockResizeObserver {
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

describe('ComposerApprovalModeSelector', () => {
  let container: HTMLDivElement
  let root: Root
  let openExternalHttpUrl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    openExternalHttpUrl = vi.fn(async () => undefined)
    vi.stubGlobal('desktopApp', { codex: { openExternalHttpUrl } })
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('renders the three options and emits a safe selected mode', async () => {
    const onApprovalModeKindChange = vi.fn()
    await render({ onApprovalModeKindChange })

    const trigger = getTrigger()
    expect(trigger?.getAttribute('data-mode')).toBe('request-approval')
    expect(trigger?.textContent).toContain('请求批准')

    await openMenu()
    expect(document.body.textContent).toContain('应如何批准 ChatGPT 操作？')
    expect(document.body.textContent).toContain('帮我批准')
    expect(document.body.textContent).toContain('完全访问权限')

    await selectMenuItem('approve-for-me')
    expect(onApprovalModeKindChange).toHaveBeenCalledWith('approve-for-me')
  })

  it('uses the warning appearance for full access and keeps the trigger disabled', async () => {
    await render({ approvalModeKind: 'full-access', disabled: true })

    const trigger = getTrigger()
    expect(trigger?.disabled).toBe(true)
    expect(trigger?.className).toContain('text-orange-600')
    expect(trigger?.getAttribute('data-mode')).toBe('full-access')
  })

  it('requires confirmation before enabling full access and only persists after confirm', async () => {
    const onApprovalModeKindChange = vi.fn()
    const confirmationStore = new FullAccessConfirmationStore(new MemoryStorage())
    await render({ onApprovalModeKindChange, confirmationStore })

    await openMenu()
    await selectMenuItem('full-access')
    expect(onApprovalModeKindChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('确定要开启完全访问权限吗？')

    await act(async () => {
      findButton('取消')?.click()
    })
    expect(confirmationStore.hasConfirmed()).toBe(false)
    expect(onApprovalModeKindChange).not.toHaveBeenCalled()

    await openMenu()
    await selectMenuItem('full-access')
    await act(async () => {
      findButton('开启完全访问权限')?.click()
    })
    expect(confirmationStore.hasConfirmed()).toBe(true)
    expect(onApprovalModeKindChange).toHaveBeenCalledWith('full-access')

    await render({ onApprovalModeKindChange, confirmationStore })
    await openMenu()
    await selectMenuItem('full-access')
    expect(onApprovalModeKindChange).toHaveBeenCalledTimes(2)
  })

  it('supports keyboard navigation, selection, and Escape focus restore', async () => {
    const onApprovalModeKindChange = vi.fn()
    await render({ onApprovalModeKindChange })

    const trigger = getTrigger()
    await focusElement(trigger)
    await openMenu()

    const items = getMenuItems()
    expect(items.map((item) => item.dataset.mode)).toEqual([
      'request-approval',
      'approve-for-me',
      'full-access'
    ])

    items[0]?.focus()
    await pressKey(items[0], 'ArrowDown')
    expect(document.activeElement).toBe(items[1])

    await act(async () => {
      items[1]?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      await Promise.resolve()
    })
    await pressKey(items[1], 'ArrowUp')
    expect(document.body.querySelector('[data-slot="composer-approval-mode-menu"]')).not.toBeNull()
    expect(onApprovalModeKindChange).not.toHaveBeenCalled()

    await focusElement(items[1])
    await pressKey(items[1], 'Enter')
    expect(onApprovalModeKindChange).toHaveBeenCalledWith('approve-for-me')

    await render({ approvalModeKind: 'approve-for-me', onApprovalModeKindChange })
    await focusElement(getTrigger())
    await openMenu()
    const reopenedItems = getMenuItems()
    reopenedItems[0]?.focus()
    await pressKey(reopenedItems[0], ' ')
    expect(onApprovalModeKindChange).toHaveBeenCalledWith('request-approval')

    await openMenu()
    await pressKey(document, 'Escape')
    await flushEffects()
    expect(document.body.querySelector('[data-slot="composer-approval-mode-menu"]')).toBeNull()
    expect(document.activeElement).toBe(getTrigger())
  })

  it('cancels first full access confirmation with Escape or overlay without switching', async () => {
    const onApprovalModeKindChange = vi.fn()
    const confirmationStore = new FullAccessConfirmationStore(new MemoryStorage())
    await render({ onApprovalModeKindChange, confirmationStore })

    await openMenu()
    await selectMenuItem('full-access')
    expect(getFullAccessDialog()).not.toBeNull()

    await pressKey(document, 'Escape')
    expect(getFullAccessDialog()).toBeNull()
    expect(confirmationStore.hasConfirmed()).toBe(false)
    expect(onApprovalModeKindChange).not.toHaveBeenCalled()

    await openMenu()
    await selectMenuItem('full-access')
    expect(getFullAccessDialog()).not.toBeNull()

    await act(async () => {
      getDialogOverlay()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0 })
      )
      getDialogOverlay()?.click()
      await Promise.resolve()
    })
    expect(getFullAccessDialog()).toBeNull()
    expect(confirmationStore.hasConfirmed()).toBe(false)
    expect(onApprovalModeKindChange).not.toHaveBeenCalled()
  })

  it('opens the sandbox documentation with the approved external bridge', async () => {
    await render()
    await openMenu()

    await act(async () => {
      findButton('了解更多')?.click()
    })
    expect(openExternalHttpUrl).toHaveBeenCalledWith(sandboxDocumentationUrl)
  })

  async function render(
    overrides: Partial<ComponentProps<typeof ComposerApprovalModeSelector>> = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        <ComposerApprovalModeSelector
          approvalModeKind="request-approval"
          onApprovalModeKindChange={vi.fn()}
          {...overrides}
        />
      )
    })
  }

  function getTrigger(): HTMLButtonElement | null {
    return container.querySelector('button[data-slot="composer-approval-mode-selector"]')
  }

  async function openMenu(): Promise<void> {
    await act(async () => {
      getTrigger()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      getTrigger()?.click()
    })
  }

  async function selectMenuItem(mode: string): Promise<void> {
    await act(async () => {
      document.body
        .querySelector<HTMLElement>(`[data-slot="dropdown-menu-item"][data-mode="${mode}"]`)
        ?.click()
    })
  }

  function getMenuItems(): HTMLElement[] {
    return [
      ...document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"][data-mode]')
    ]
  }

  async function pressKey(target: EventTarget, key: string): Promise<void> {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function focusElement(element: HTMLElement | null | undefined): void {
    act(() => {
      element?.focus()
    })
  }

  async function flushEffects(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }

  function getFullAccessDialog(): HTMLElement | null {
    return document.body.querySelector('[data-slot="full-access-confirmation-dialog"]')
  }

  function getDialogOverlay(): HTMLElement | null {
    return document.body.querySelector('[data-slot="dialog-overlay"]')
  }

  function findButton(label: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === label
    )
  }
})
