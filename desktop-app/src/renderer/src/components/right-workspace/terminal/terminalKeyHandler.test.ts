// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'

import { installTerminalInteractionHandlers } from './terminalKeyHandler'

afterEach(() => vi.unstubAllGlobals())

describe('terminal key and link handlers', () => {
  it('keeps terminal shortcuts in one owner and sends shell control sequences', () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined
    const write = vi.fn()
    const openTerminal = vi.fn()
    const terminal = fakeTerminal((next) => {
      handler = next
    })
    const disposable = installTerminalInteractionHandlers({
      terminal: terminal as unknown as Terminal,
      platform: 'darwin',
      write,
      openTerminal,
      openExternalHttpUrl: vi.fn()
    })

    expect(handler?.(new KeyboardEvent('keydown', { key: 't', metaKey: true }))).toBe(false)
    expect(openTerminal).toHaveBeenCalledOnce()
    expect(handler?.(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true }))).toBe(false)
    expect(handler?.(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true }))).toBe(false)
    expect(write).toHaveBeenNthCalledWith(1, '\x1b[1;5D')
    expect(write).toHaveBeenNthCalledWith(2, '\x17')
    disposable.dispose()
  })

  it('uses clipboard APIs and sends Ctrl+C only when there is no selection', async () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined
    const write = vi.fn()
    const writeText = vi.fn(async () => undefined)
    const readText = vi.fn(async () => 'pasted')
    vi.stubGlobal('navigator', { clipboard: { writeText, readText } })
    const selectedTerminal = fakeTerminal((next) => {
      handler = next
    }, 'selected')
    installTerminalInteractionHandlers({
      terminal: selectedTerminal as unknown as Terminal,
      platform: 'darwin',
      write,
      openTerminal: vi.fn(),
      openExternalHttpUrl: vi.fn()
    })
    expect(handler?.(new KeyboardEvent('keydown', { key: 'c', metaKey: true }))).toBe(false)
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('selected'))
    expect(write).not.toHaveBeenCalled()

    let windowsHandler: ((event: KeyboardEvent) => boolean) | undefined
    const unselectedTerminal = fakeTerminal((next) => {
      windowsHandler = next
    })
    installTerminalInteractionHandlers({
      terminal: unselectedTerminal as unknown as Terminal,
      platform: 'linux',
      write,
      openTerminal: vi.fn(),
      openExternalHttpUrl: vi.fn()
    })
    expect(windowsHandler?.(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(false)
    expect(
      windowsHandler?.(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }))
    ).toBe(false)
    await vi.waitFor(() => expect(write).toHaveBeenLastCalledWith('pasted'))
    expect(write).toHaveBeenNthCalledWith(1, '\x03')
  })

  it('routes only HTTP(S) links through the injected safe external opener', () => {
    let provider: { provideLinks(line: number, callback: (links: readonly { activate(): void }[]) => void): void } | undefined
    const openExternalHttpUrl = vi.fn()
    const terminal = fakeTerminal(undefined, '', 'see https://example.test/path')
    terminal.registerLinkProvider = vi.fn((next) => {
      provider = next
      return { dispose: vi.fn() }
    })
    installTerminalInteractionHandlers({
      terminal: terminal as unknown as Terminal,
      platform: 'darwin',
      write: vi.fn(),
      openTerminal: vi.fn(),
      openExternalHttpUrl
    })

    let links: readonly { activate(): void }[] = []
    provider?.provideLinks(1, (next) => {
      links = next
    })
    expect(links).toHaveLength(1)
    links[0]?.activate()
    expect(openExternalHttpUrl).toHaveBeenCalledWith('https://example.test/path')
  })
})

function fakeTerminal(
  onKeyHandler?: (handler: (event: KeyboardEvent) => boolean) => void,
  selection = '',
  line = ''
): FakeTerminal {
  return {
    buffer: { active: { getLine: vi.fn(() => ({ translateToString: () => line })) } },
    registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
    attachCustomKeyEventHandler: vi.fn((handler) => onKeyHandler?.(handler)),
    getSelection: vi.fn(() => selection)
  }
}

type FakeTerminal = {
  buffer: { active: { getLine: ReturnType<typeof vi.fn> } }
  registerLinkProvider: ReturnType<typeof vi.fn>
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
}
