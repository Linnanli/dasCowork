// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { refitTerminalWorkspace, registerTerminalWorkspaceFitter } from './terminalWorkspaceMove'

afterEach(() => vi.unstubAllGlobals())

describe('TerminalWorkspace move lifecycle', () => {
  it('fits the live terminal on the next frame without creating a new session', async () => {
    const fit = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const unregister = registerTerminalWorkspaceFitter('terminal:one', fit)

    await refitTerminalWorkspace('terminal:one')

    expect(fit).toHaveBeenCalledTimes(1)
    unregister()
  })
})
