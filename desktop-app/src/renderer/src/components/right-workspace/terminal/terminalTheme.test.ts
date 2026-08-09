// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'

import {
  applyTerminalAppearance,
  saveTerminalFontPreferences,
  terminalAppearance,
  terminalFontPreferences,
  TERMINAL_FONT_PREFERENCES_CHANGED_EVENT,
  watchTerminalAppearance
} from './terminalTheme'

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('terminal appearance', () => {
  it('applies saved font settings to an already-open terminal and refits it', () => {
    window.localStorage.setItem('terminal.fontFamily', 'Fira Code')
    window.localStorage.setItem('terminal.fontSize', '15')
    const element = document.createElement('div')
    document.body.append(element)
    const terminal = { options: {} } as unknown as Terminal
    const fit = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    applyTerminalAppearance(terminal, element, fit)

    expect(terminal.options).toMatchObject({ fontFamily: 'Fira Code', fontSize: 15 })
    expect(fit).toHaveBeenCalledOnce()
    element.remove()
  })

  it('removes the observer and storage listener on dispose', () => {
    const disconnect = vi.fn()
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = vi.fn()
        disconnect = disconnect
      }
    )
    const remove = vi.spyOn(window, 'removeEventListener')
    const terminal = { options: {} } as unknown as Terminal
    const dispose = watchTerminalAppearance(terminal, document.createElement('div'), vi.fn())

    dispose()

    expect(disconnect).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
  })

  it('uses bounded font preferences and a renderer-derived theme', () => {
    window.localStorage.setItem('terminal.fontSize', '99')
    const appearance = terminalAppearance(document.createElement('div'))
    expect(appearance.fontSize).toBe(13)
    expect(appearance.theme).toHaveProperty('background')
  })

  it('saves normalized font preferences and emits a same-window update event', () => {
    const listener = vi.fn()
    window.addEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, listener)

    saveTerminalFontPreferences({ fontFamily: '  JetBrains Mono  ', fontSize: 99 })

    expect(terminalFontPreferences()).toMatchObject({
      fontFamily: 'JetBrains Mono',
      fontSize: 32
    })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, listener)
  })
})
