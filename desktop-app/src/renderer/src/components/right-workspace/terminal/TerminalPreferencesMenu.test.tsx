// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TerminalPreferencesMenu } from './TerminalPreferencesMenu'
import { terminalFontPreferences, TERMINAL_FONT_PREFERENCES_CHANGED_EVENT } from './terminalTheme'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let listShells: ReturnType<typeof vi.fn>
const originalScrollIntoView = Element.prototype.scrollIntoView

describe('TerminalPreferencesMenu', () => {
  beforeEach(() => {
    window.localStorage.clear()
    listShells = vi.fn().mockResolvedValue([
      { id: 'zsh', label: 'Zsh', isDefault: true },
      { id: 'bash', label: 'Bash', isDefault: false }
    ])
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    Element.prototype.scrollIntoView = vi.fn()
    Object.defineProperty(window, 'desktopApp', {
      configurable: true,
      value: {
        workspace: {
          terminal: {
            listShells
          }
        }
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.replaceChildren()
    window.localStorage.clear()
    Element.prototype.scrollIntoView = originalScrollIntoView
    vi.unstubAllGlobals()
  })

  it('loads shell options from the terminal workspace API when opened', async () => {
    await renderMenu()
    await openMenu()

    await vi.waitFor(() => expect(listShells).toHaveBeenCalledOnce())
    expect(document.body.textContent).toContain('Zsh')
  })

  it('saves only the selected shell id', async () => {
    await renderMenu()
    await openMenu()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Zsh'))

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    })
    await vi.waitFor(() =>
      expect(document.body.querySelectorAll('[data-slot="command-item"]').length).toBeGreaterThan(0)
    )
    await act(async () => {
      commandItem('Bash')?.click()
    })

    expect(window.localStorage.getItem('desktopCodex.integratedTerminal.shellId')).toBe('bash')
  })

  it('saves font settings with size bounds and notifies already-open terminals', async () => {
    const listener = vi.fn()
    window.addEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, listener)
    await renderMenu()
    await openMenu()

    await act(async () => {
      setInputValue(inputByLabel('终端字体'), 'Fira Code')
      setInputValue(inputByLabel('终端字号'), '40')
    })
    await act(async () => {
      buttonWithText('保存字体')?.click()
    })

    expect(terminalFontPreferences()).toMatchObject({
      fontFamily: 'Fira Code',
      fontSize: 32
    })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, listener)
  })
})

async function renderMenu(): Promise<void> {
  await act(async () => {
    root.render(<TerminalPreferencesMenu />)
  })
}

async function openMenu(): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="终端偏好"]')?.click()
  })
}

function commandItem(label: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
    (element) => element.textContent?.includes(label)
  )
}

function buttonWithText(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label
  )
}

function inputByLabel(label: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!input) throw new Error(`Missing input: ${label}`)
  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
