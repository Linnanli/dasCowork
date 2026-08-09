import type { Terminal } from '@xterm/xterm'

type ActiveTerminalView = {
  element: HTMLElement
  terminal: Pick<Terminal, 'clear'>
}

const views = new Set<ActiveTerminalView>()

export const CLEAR_ACTIVE_TERMINAL_EVENT = 'desktopCodexWorkspace.clear-active-terminal'

/** Clears only the visible xterm that owns focus; replay and AI tails stay intact. */
export function clearActiveTerminalView(): boolean {
  for (const view of views) {
    if (!view.element.contains(document.activeElement)) continue
    view.terminal.clear()
    return true
  }
  return false
}

export function registerActiveTerminalView(view: ActiveTerminalView): () => void {
  views.add(view)
  return () => views.delete(view)
}

/** Requests a local visual clear; it deliberately does not alter the main-process replay tail. */
export function requestClearActiveTerminalView(): void {
  window.dispatchEvent(new Event(CLEAR_ACTIVE_TERMINAL_EVENT))
}

export function resetActiveTerminalViewsForTests(): void {
  views.clear()
}
