import type { IDisposable, Terminal } from '@xterm/xterm'

type TerminalKeyHandlerOptions = {
  terminal: Terminal
  platform: NodeJS.Platform
  write(data: string): void
  openTerminal(): void
  openExternalHttpUrl(url: string): void
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu

export function installTerminalInteractionHandlers({
  terminal,
  platform,
  write,
  openTerminal,
  openExternalHttpUrl
}: TerminalKeyHandlerOptions): IDisposable {
  const linkProvider = terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber)?.translateToString(true) ?? ''
      callback(
        [...line.matchAll(URL_PATTERN)].map((match) => ({
          text: match[0],
          range: {
            start: { x: (match.index ?? 0) + 1, y: bufferLineNumber },
            end: { x: (match.index ?? 0) + match[0].length + 1, y: bufferLineNumber }
          },
          activate: () => openExternalHttpUrl(match[0])
        }))
      )
    }
  })
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    if (isNewTerminalShortcut(event, platform)) {
      event.preventDefault()
      openTerminal()
      return false
    }
    if (isCopyShortcut(event, platform)) {
      const selection = terminal.getSelection()
      if (selection) {
        event.preventDefault()
        void navigator.clipboard?.writeText(selection)
        return false
      }
      if (!event.shiftKey && !event.metaKey) {
        write('\x03')
        return false
      }
    }
    if (isPasteShortcut(event, platform)) {
      event.preventDefault()
      void navigator.clipboard?.readText().then((text) => {
        if (text) write(text)
      })
      return false
    }
    const sequence = shellControlSequence(event)
    if (sequence) {
      event.preventDefault()
      write(sequence)
      return false
    }
    return true
  })
  return {
    dispose: () => {
      linkProvider.dispose()
      terminal.attachCustomKeyEventHandler(() => true)
    }
  }
}

function isNewTerminalShortcut(event: KeyboardEvent, platform: NodeJS.Platform): boolean {
  const key = event.key.toLowerCase()
  return key === 't' && (platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey)
}

function isCopyShortcut(event: KeyboardEvent, platform: NodeJS.Platform): boolean {
  const key = event.key.toLowerCase()
  return platform === 'darwin'
    ? key === 'c' && event.metaKey
    : key === 'c' && event.ctrlKey && (event.shiftKey || !event.altKey)
}

function isPasteShortcut(event: KeyboardEvent, platform: NodeJS.Platform): boolean {
  const key = event.key.toLowerCase()
  return platform === 'darwin'
    ? key === 'v' && event.metaKey
    : key === 'v' && event.ctrlKey && event.shiftKey
}

function shellControlSequence(event: KeyboardEvent): string | undefined {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return undefined
  switch (event.key) {
    case 'ArrowLeft':
      return '\x1b[1;5D'
    case 'ArrowRight':
      return '\x1b[1;5C'
    case 'Backspace':
      return '\x17'
    case 'Delete':
      return '\x1b[3;5~'
    default:
      return undefined
  }
}
