import { describe, expect, it } from 'vitest'

import { fileTreeUnsafeCss } from './WorkspaceFileTree'

describe('workspace file-tree theme', () => {
  it('inherits the app semantic colors and current system color scheme', () => {
    expect(fileTreeUnsafeCss).toContain('color-scheme: light dark;')
    expect(fileTreeUnsafeCss).toContain('--trees-bg-override: var(--background);')
    expect(fileTreeUnsafeCss).toContain('--trees-bg-muted-override: var(--accent);')
    expect(fileTreeUnsafeCss).toContain('--trees-fg-override: var(--foreground);')
    expect(fileTreeUnsafeCss).toContain('--trees-fg-muted-override: var(--muted-foreground);')
    expect(fileTreeUnsafeCss).toContain('--trees-selected-bg-override: var(--muted);')
    expect(fileTreeUnsafeCss).toContain('--trees-selected-fg-override: var(--foreground);')
    expect(fileTreeUnsafeCss).toContain('--trees-focus-ring-color-override: var(--ring);')
  })
})
