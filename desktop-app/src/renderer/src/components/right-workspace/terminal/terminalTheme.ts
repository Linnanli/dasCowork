import type { ITerminalOptions, ITheme, Terminal } from '@xterm/xterm'

export type TerminalAppearance = Pick<ITerminalOptions, 'fontFamily' | 'fontSize'> & {
  theme: ITheme
}

export type TerminalFontPreferences = {
  fontFamily: NonNullable<ITerminalOptions['fontFamily']>
  fontSize: NonNullable<ITerminalOptions['fontSize']>
}

export const TERMINAL_FONT_PREFERENCES_CHANGED_EVENT =
  'desktopCodex:terminal-font-preferences-changed'
export const DEFAULT_TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 32

const TERMINAL_FONT_FAMILY_KEY = 'terminal.fontFamily'
const TERMINAL_FONT_SIZE_KEY = 'terminal.fontSize'

export function terminalAppearance(element: HTMLElement): TerminalAppearance {
  const styles = window.getComputedStyle(element)
  const preferences = terminalFontPreferences()
  return {
    fontFamily: preferences.fontFamily,
    fontSize: preferences.fontSize,
    theme: {
      background: styles.backgroundColor,
      cursor: styles.color,
      foreground: styles.color,
      selectionBackground: 'rgba(127, 127, 127, 0.35)'
    }
  }
}

export function applyTerminalAppearance(
  terminal: Terminal,
  element: HTMLElement,
  fit: () => void
): void {
  const appearance = terminalAppearance(element)
  terminal.options.theme = appearance.theme
  terminal.options.fontFamily = appearance.fontFamily
  terminal.options.fontSize = appearance.fontSize
  requestAnimationFrame(fit)
}

export function terminalFontPreferences(): TerminalFontPreferences {
  return {
    fontFamily: localStorageString(TERMINAL_FONT_FAMILY_KEY) ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize:
      storedFontSize(localStorageNumber(TERMINAL_FONT_SIZE_KEY)) ?? DEFAULT_TERMINAL_FONT_SIZE
  }
}

export function saveTerminalFontPreferences(preferences: TerminalFontPreferences): void {
  safeStorageSet(TERMINAL_FONT_FAMILY_KEY, preferences.fontFamily.trim())
  safeStorageSet(
    TERMINAL_FONT_SIZE_KEY,
    String(boundedFontSize(preferences.fontSize) ?? DEFAULT_TERMINAL_FONT_SIZE)
  )
  window.dispatchEvent(new CustomEvent(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT))
}

export function watchTerminalAppearance(
  terminal: Terminal,
  element: HTMLElement,
  fit: () => void
): () => void {
  const update = (): void => applyTerminalAppearance(terminal, element, fit)
  const observer = new MutationObserver(update)
  observer.observe(document.documentElement, {
    attributeFilter: ['class', 'style', 'data-theme'],
    attributes: true
  })
  window.addEventListener('storage', update)
  window.addEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, update)
  return () => {
    observer.disconnect()
    window.removeEventListener('storage', update)
    window.removeEventListener(TERMINAL_FONT_PREFERENCES_CHANGED_EVENT, update)
  }
}

function localStorageString(key: string): string | undefined {
  try {
    const value = window.localStorage.getItem(key)?.trim()
    return value || undefined
  } catch {
    return undefined
  }
}

function localStorageNumber(key: string): number | undefined {
  const value = localStorageString(key)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boundedFontSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)))
}

function storedFontSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value >= TERMINAL_FONT_SIZE_MIN && value <= TERMINAL_FONT_SIZE_MAX
    ? Math.round(value)
    : undefined
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Private contexts can deny storage; terminals still use defaults for this window.
  }
}
