// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  clearTerminalShellPreference,
  currentTerminalShellId,
  preferredTerminalShellId,
  saveTerminalShellPreference
} from './terminalPreferences'

afterEach(() => {
  clearTerminalShellPreference()
  window.localStorage.clear()
})

describe('terminal shell preference', () => {
  const shells = [
    { id: 'zsh', label: 'zsh', isDefault: true },
    { id: 'bash', label: 'bash', isDefault: false }
  ] as const

  it('keeps only a known shell id and falls back to the main-provided default', () => {
    saveTerminalShellPreference('bash')
    expect(preferredTerminalShellId(shells)).toBe('bash')

    saveTerminalShellPreference('removed-shell')
    expect(preferredTerminalShellId(shells)).toBe('zsh')
  })

  it('removes the renderer-only preference when requested', () => {
    saveTerminalShellPreference('bash')
    clearTerminalShellPreference()
    expect(preferredTerminalShellId(shells)).toBe('zsh')
  })

  it('stores only the trimmed shell id', () => {
    saveTerminalShellPreference('  bash  ')
    expect(currentTerminalShellId()).toBe('bash')
    expect(
      [...Array(window.localStorage.length).keys()].map((index) => window.localStorage.key(index))
    ).toEqual(['desktopCodex.integratedTerminal.shellId'])
  })
})
