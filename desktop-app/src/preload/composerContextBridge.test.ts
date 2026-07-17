import { describe, expect, it, vi } from 'vitest'

import { createComposerContextBridge } from './composerContextBridge'

describe('createComposerContextBridge', () => {
  it('exposes only the fixed catalog, validation, and search channels', async () => {
    const invoke = vi.fn(async (channel: string, payload: unknown) => ({ channel, payload }))
    const subscribe = vi.fn(() => () => undefined)
    const bridge = createComposerContextBridge(invoke, subscribe)

    await bridge.list({ version: 1, cwd: '/repo' })
    await bridge.refresh({ version: 1, threadId: 'thread-1' }, { sectionIds: ['agents'] })
    await bridge.validateLocalAttachments({
      version: 1,
      references: [
        { kind: 'file', path: '/repo/a.ts', fileUrl: 'file:///repo/a.ts', label: 'a.ts' }
      ]
    })
    await bridge.startSearch({ version: 1, cwd: '/repo' })
    await bridge.updateSearch({ version: 1, sessionId: 'search-1', query: 'needle' })
    await bridge.stopSearch({ version: 1, sessionId: 'search-1' })

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'codex:composer-context:list',
      'codex:composer-context:refresh',
      'codex:composer-context:validate-local-attachments',
      'codex:composer-context-search:start',
      'codex:composer-context-search:update',
      'codex:composer-context-search:stop'
    ])
    expect(invoke.mock.calls[1]?.[1]).toEqual({
      input: { version: 1, threadId: 'thread-1' },
      options: { sectionIds: ['agents'] }
    })
  })

  it('validates change events and returns the listener cleanup', () => {
    let listener: ((payload: unknown) => void) | undefined
    const cleanup = vi.fn()
    const bridge = createComposerContextBridge(
      vi.fn(),
      vi.fn((_channel, callback) => {
        listener = callback
        return cleanup
      })
    )
    const callback = vi.fn()

    const remove = bridge.onDidChange(callback)
    listener?.({ version: 2, sectionIds: ['chats'] })
    listener?.({ version: 1, sectionIds: ['agents'], scope: { threadId: 'thread-1' } })
    remove()

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({
      version: 1,
      sectionIds: ['agents'],
      scope: { threadId: 'thread-1' }
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('validates search events before forwarding them', () => {
    let listener: ((payload: unknown) => void) | undefined
    const bridge = createComposerContextBridge(
      vi.fn(),
      vi.fn((_channel, callback) => {
        listener = callback
        return () => undefined
      })
    )
    const callback = vi.fn()

    bridge.onSearchUpdate(callback)
    listener?.({
      version: 1,
      sessionId: 'search-1',
      query: 'needle',
      sectionId: 'agents',
      status: 'ready',
      items: [],
      complete: true
    })
    listener?.({
      version: 1,
      sessionId: 'search-1',
      query: 'needle',
      sectionId: 'files',
      status: 'ready',
      items: [],
      complete: true
    })

    expect(callback).toHaveBeenCalledOnce()
  })
})
