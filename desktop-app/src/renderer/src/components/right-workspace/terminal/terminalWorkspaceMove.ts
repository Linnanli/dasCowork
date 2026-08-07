const terminalFitters = new Map<string, () => void>()

/**
 * Registers the live xterm resize callback for a tab. The container adapter
 * uses this after a cross-panel move without creating another terminal.
 */
export function registerTerminalWorkspaceFitter(tabId: string, fit: () => void): () => void {
  terminalFitters.set(tabId, fit)
  return () => {
    if (terminalFitters.get(tabId) === fit) terminalFitters.delete(tabId)
  }
}

/** Refit an existing xterm after its destination panel has committed layout. */
export async function refitTerminalWorkspace(tabId: string): Promise<void> {
  await nextAnimationFrame()
  terminalFitters.get(tabId)?.()
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(resolve)
      return
    }
    requestAnimationFrame(() => resolve())
  })
}
