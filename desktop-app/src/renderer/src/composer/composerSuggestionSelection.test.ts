import { describe, expect, it, vi } from 'vitest'

import {
  dispatchComposerSuggestionSelection,
  getComposerSuggestionQueryRange,
  replaceComposerSuggestionTextRange,
  StaleComposerSuggestionRangeError
} from './composerSuggestionSelection'
import type { ComposerSuggestionItem, ComposerSuggestionSession } from './composerSuggestionTypes'

const fileReference = {
  version: 1,
  kind: 'file',
  canonicalId: 'file:/repo/src/App.tsx',
  label: 'App.tsx',
  path: '/repo/src/App.tsx',
  presentation: 'mention'
} as const

function openSession(
  overrides: Partial<Extract<ComposerSuggestionSession, { open: true }>> = {}
): Extract<ComposerSuggestionSession, { open: true }> {
  return {
    open: true,
    trigger: '/',
    source: 'typed-slash',
    query: 'new',
    range: { start: 6, end: 10 },
    highlightedId: 'item',
    view: { type: 'list' },
    ...overrides
  }
}

function item(selection: ComposerSuggestionItem['selection']): ComposerSuggestionItem {
  return {
    id: 'item',
    kind: 'command',
    label: 'Item',
    selection
  }
}

describe('composerSuggestionSelection', () => {
  it('replaces exact text ranges without touching surrounding draft text', () => {
    expect(replaceComposerSuggestionTextRange('hello /new world', { start: 6, end: 10 }, '')).toBe(
      'hello  world'
    )
    expect(
      replaceComposerSuggestionTextRange('hello /new world', { start: 7, end: 10 }, 'review')
    ).toBe('hello /review world')
  })

  it('rejects invalid ranges before editing text', () => {
    expect(() => replaceComposerSuggestionTextRange('draft', { start: -1, end: 2 }, '')).toThrow(
      RangeError
    )
    expect(() => replaceComposerSuggestionTextRange('draft', { start: 3, end: 2 }, '')).toThrow(
      RangeError
    )
    expect(() => replaceComposerSuggestionTextRange('draft', { start: 0, end: 99 }, '')).toThrow(
      RangeError
    )
  })

  it('dispatches insert-context with the active replacement range', async () => {
    const insertContext = vi.fn()
    const closeSession = vi.fn()

    await dispatchComposerSuggestionSelection({
      session: openSession(),
      item: item({ type: 'insert-context', reference: fileReference }),
      closeSession,
      updateSession: vi.fn(),
      replaceRange: vi.fn(),
      insertContext,
      openContent: vi.fn()
    })

    expect(insertContext).toHaveBeenCalledWith(fileReference, { start: 6, end: 10 })
    expect(closeSession).toHaveBeenCalledOnce()
  })

  it('deletes the full trigger range before running an action', async () => {
    const run = vi.fn()
    const replaceRange = vi.fn()
    const closeSession = vi.fn()

    await dispatchComposerSuggestionSelection({
      session: openSession(),
      item: item({ type: 'action', run }),
      closeSession,
      updateSession: vi.fn(),
      replaceRange,
      insertContext: vi.fn(),
      openContent: vi.fn()
    })

    expect(closeSession).toHaveBeenCalledOnce()
    expect(replaceRange).toHaveBeenCalledWith({ start: 6, end: 10 }, '')
    expect(run).toHaveBeenCalledOnce()
  })

  it('closes without editing or executing when the trigger range is stale', async () => {
    const updateSession = vi.fn()
    const replaceRange = vi.fn()
    const run = vi.fn()

    const result = await dispatchComposerSuggestionSelection({
      session: openSession(),
      item: item({ type: 'action', run }),
      closeSession: vi.fn(),
      updateSession,
      rangeMatches: vi.fn(() => false),
      replaceRange,
      insertContext: vi.fn(),
      openContent: vi.fn()
    })

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.error).toBeInstanceOf(
      StaleComposerSuggestionRangeError
    )
    expect(replaceRange).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(updateSession).toHaveBeenCalledWith({ open: false })
  })

  it('keeps the session open and replaces only the query for query-completion', async () => {
    const updateSession = vi.fn()
    const replaceRange = vi.fn()
    const session = openSession()

    await dispatchComposerSuggestionSelection({
      session,
      item: item({ type: 'query-completion', value: 'review' }),
      closeSession: vi.fn(),
      updateSession,
      replaceRange,
      insertContext: vi.fn(),
      openContent: vi.fn()
    })

    expect(getComposerSuggestionQueryRange(session)).toEqual({ start: 7, end: 10 })
    expect(replaceRange).toHaveBeenCalledWith({ start: 7, end: 10 }, 'review')
    expect(updateSession).toHaveBeenCalledWith({
      ...session,
      query: 'review',
      range: { start: 6, end: 13 },
      highlightedId: null,
      view: { type: 'list' }
    })
  })

  it('enters submenu without editing the draft', async () => {
    const updateSession = vi.fn()
    const replaceRange = vi.fn()
    const session = openSession()

    await dispatchComposerSuggestionSelection({
      session,
      item: item({ type: 'submenu', submenuId: 'mcp-servers' }),
      closeSession: vi.fn(),
      updateSession,
      replaceRange,
      insertContext: vi.fn(),
      openContent: vi.fn()
    })

    expect(replaceRange).not.toHaveBeenCalled()
    expect(updateSession).toHaveBeenCalledWith({
      ...session,
      query: '',
      highlightedId: null,
      view: { type: 'submenu', id: 'mcp-servers', parentId: 'item' }
    })
  })

  it('deletes trigger text and opens content in the same session', async () => {
    const updateSession = vi.fn()
    const openContent = vi.fn()
    const replaceRange = vi.fn()
    const session = openSession()

    await dispatchComposerSuggestionSelection({
      session,
      item: item({ type: 'content', contentId: 'mcp', placement: 'panel' }),
      closeSession: vi.fn(),
      updateSession,
      replaceRange,
      insertContext: vi.fn(),
      openContent
    })

    expect(replaceRange).toHaveBeenCalledWith({ start: 6, end: 10 }, '')
    expect(openContent).toHaveBeenCalledWith({
      contentId: 'mcp',
      item: expect.objectContaining({ id: 'item' }),
      placement: 'panel'
    })
    expect(updateSession).toHaveBeenCalledWith({
      ...session,
      query: '',
      range: null,
      highlightedId: null,
      view: { type: 'content', id: 'mcp', placement: 'panel' }
    })
  })

  it('keeps action failures in a stable closed state', async () => {
    const error = new Error('failed')
    const updateSession = vi.fn()
    const onError = vi.fn()

    const result = await dispatchComposerSuggestionSelection({
      session: openSession(),
      item: item({ type: 'action', run: vi.fn().mockRejectedValue(error) }),
      closeSession: vi.fn(),
      updateSession,
      replaceRange: vi.fn(),
      insertContext: vi.fn(),
      openContent: vi.fn(),
      onError
    })

    expect(result).toEqual({ status: 'failed', error })
    expect(updateSession).toHaveBeenCalledWith({ open: false })
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('keeps content failures in a stable closed state', async () => {
    const error = new Error('content failed')
    const updateSession = vi.fn()

    const result = await dispatchComposerSuggestionSelection({
      session: openSession(),
      item: item({ type: 'content', contentId: 'mcp', placement: 'panel' }),
      closeSession: vi.fn(),
      updateSession,
      replaceRange: vi.fn(),
      insertContext: vi.fn(),
      openContent: vi.fn().mockRejectedValue(error)
    })

    expect(result).toEqual({ status: 'failed', error })
    expect(updateSession).toHaveBeenCalledWith({ open: false })
  })
})
