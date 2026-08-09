import type { TerminalWorkspaceShellOption } from '../../../../../shared/terminalWorkspaceApi'

const TERMINAL_SHELL_PREFERENCE_KEY = 'desktopCodex.integratedTerminal.shellId'

/** Renderer-owned preference. Main still validates the id against its own catalog. */
export function saveTerminalShellPreference(shellId: string): void {
  safeStorageSet(TERMINAL_SHELL_PREFERENCE_KEY, shellId.trim())
}

export function clearTerminalShellPreference(): void {
  safeStorageRemove(TERMINAL_SHELL_PREFERENCE_KEY)
}

export function currentTerminalShellId(): string | undefined {
  const value = safeStorageGet(TERMINAL_SHELL_PREFERENCE_KEY)?.trim()
  return value || undefined
}

export function preferredTerminalShellId(
  options: readonly TerminalWorkspaceShellOption[]
): string | undefined {
  const saved = currentTerminalShellId()
  if (saved && options.some((option) => option.id === saved)) return saved
  return options.find((option) => option.isDefault)?.id ?? options[0]?.id
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Private contexts can deny storage; terminal creation still uses the platform default.
  }
}

function safeStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // See safeStorageSet.
  }
}
