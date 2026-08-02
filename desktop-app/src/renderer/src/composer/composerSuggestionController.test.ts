import { describe, expect, it, vi } from 'vitest'

import { ComposerSuggestionStore } from './composerSuggestionController'
import type {
  ComposerSuggestionItem,
  ComposerSuggestionSection,
  ComposerSuggestionSession
} from './composerSuggestionTypes'

const noopAction = { type: 'action', run: vi.fn() } as const

function command(id: string, disabled = false): ComposerSuggestionItem {
  return {
    id,
    kind: 'command',
    label: id,
    disabled,
    selection: noopAction
  }
}

function section(items: readonly ComposerSuggestionItem[]): ComposerSuggestionSection {
  return { id: 'commands', items }
}

function requireOpenSession(
  session: ComposerSuggestionSession
): Extract<ComposerSuggestionSession, { open: true }> {
  if (!session.open) throw new Error('Expected an open suggestion session')
  return session
}

describe('ComposerSuggestionStore', () => {
  it('opens explicit sessions for typed slash, typed at, and plus sources', () => {
    const store = new ComposerSuggestionStore()

    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: 'review',
      range: { start: 0, end: 7 }
    })
    expect(store.getSnapshot()).toEqual({
      open: true,
      trigger: '/',
      source: 'typed-slash',
      query: 'review',
      range: { start: 0, end: 7 },
      highlightedId: null,
      view: { type: 'list' }
    })

    store.openFromEditor({
      trigger: '@',
      source: 'typed-at',
      query: 'src',
      range: { start: 3, end: 7 }
    })
    expect(store.getSnapshot()).toMatchObject({
      open: true,
      trigger: '@',
      source: 'typed-at',
      query: 'src',
      range: { start: 3, end: 7 },
      view: { type: 'list' }
    })

    store.openFromEditor({ trigger: '+', source: 'plus', query: '', range: null })
    expect(store.getSnapshot()).toMatchObject({
      open: true,
      trigger: '+',
      source: 'plus',
      query: '',
      range: null,
      view: { type: 'list' }
    })
  })

  it('tracks highlighted item by id and preserves it while sections reorder', () => {
    const store = new ComposerSuggestionStore()
    store.setSections([section([command('first'), command('second')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })

    expect(store.getSnapshot()).toMatchObject({ highlightedId: 'first' })
    store.highlight('second')
    store.setSections([section([command('second'), command('first')])])

    expect(store.getSnapshot()).toMatchObject({ highlightedId: 'second' })
  })

  it('falls back to the first enabled item when the highlighted id disappears', () => {
    const store = new ComposerSuggestionStore()
    store.setSections([section([command('first'), command('second')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })
    store.highlight('second')

    store.setSections([section([command('disabled', true), command('third')])])

    expect(store.getSnapshot()).toMatchObject({ highlightedId: 'third' })
  })

  it('wraps keyboard navigation across enabled items only', () => {
    const store = new ComposerSuggestionStore()
    store.setSections([section([command('first'), command('disabled', true), command('second')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })

    expect(store.moveHighlight(-1)).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ highlightedId: 'second' })
    expect(store.moveHighlight(1)).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ highlightedId: 'first' })
  })

  it('selects the highlighted item with the current open session', () => {
    const store = new ComposerSuggestionStore()
    const select = vi.fn()
    store.setSections([section([command('first')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })

    expect(store.selectHighlighted(select)).toBe(true)
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'first' }),
      expect.objectContaining({ open: true, trigger: '/' })
    )
  })

  it('escapes from submenu before closing the root session', () => {
    const store = new ComposerSuggestionStore()
    store.setSections([section([command('first')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })
    store.updateSession({
      ...requireOpenSession(store.getSnapshot()),
      open: true,
      query: '',
      highlightedId: null,
      view: { type: 'submenu', id: 'children', parentId: 'first' }
    })

    expect(store.handleEscape()).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ open: true, view: { type: 'list' } })
    expect(store.handleEscape()).toBe(true)
    expect(store.getSnapshot()).toEqual({ open: false })
  })

  it('uses empty submenu backspace as a parent-list navigation event', () => {
    const store = new ComposerSuggestionStore()
    store.setSections([section([command('first')])])
    store.openFromEditor({
      trigger: '/',
      source: 'typed-slash',
      query: '',
      range: { start: 0, end: 1 }
    })
    store.updateSession({
      ...requireOpenSession(store.getSnapshot()),
      open: true,
      query: '',
      view: { type: 'submenu', id: 'children', parentId: 'first' }
    })

    expect(store.handleEmptySubmenuBackspace()).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ open: true, view: { type: 'list' } })
  })
})
