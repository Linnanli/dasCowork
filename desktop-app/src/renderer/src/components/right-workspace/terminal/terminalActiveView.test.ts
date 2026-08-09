// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearActiveTerminalView,
  registerActiveTerminalView,
  requestClearActiveTerminalView,
  resetActiveTerminalViewsForTests
} from './terminalActiveView'

afterEach(resetActiveTerminalViewsForTests)

describe('terminal active view', () => {
  it('clears only the focused xterm view and leaves unfocused views untouched', () => {
    const first = document.createElement('div')
    const firstInput = document.createElement('textarea')
    first.append(firstInput)
    const second = document.createElement('div')
    const secondInput = document.createElement('textarea')
    second.append(secondInput)
    document.body.append(first, second)
    const clearFirst = vi.fn()
    const clearSecond = vi.fn()
    registerActiveTerminalView({ element: first, terminal: { clear: clearFirst } })
    registerActiveTerminalView({ element: second, terminal: { clear: clearSecond } })

    secondInput.focus()

    expect(clearActiveTerminalView()).toBe(true)
    expect(clearFirst).not.toHaveBeenCalled()
    expect(clearSecond).toHaveBeenCalledOnce()
    first.remove()
    second.remove()
  })

  it('does nothing when focus is outside a terminal', () => {
    const terminal = document.createElement('div')
    const input = document.createElement('textarea')
    terminal.append(input)
    const outside = document.createElement('button')
    document.body.append(terminal, outside)
    const clear = vi.fn()
    registerActiveTerminalView({ element: terminal, terminal: { clear } })

    outside.focus()

    expect(clearActiveTerminalView()).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    terminal.remove()
    outside.remove()
  })

  it('dispatches the app-level clear command without changing the replay buffer', () => {
    const terminal = document.createElement('div')
    const input = document.createElement('textarea')
    terminal.append(input)
    document.body.append(terminal)
    const clear = vi.fn()
    registerActiveTerminalView({ element: terminal, terminal: { clear } })
    input.focus()

    window.addEventListener(
      'desktopCodexWorkspace.clear-active-terminal',
      () => clearActiveTerminalView(),
      { once: true }
    )
    requestClearActiveTerminalView()

    expect(clear).toHaveBeenCalledOnce()
    terminal.remove()
  })
})
