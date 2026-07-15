import { describe, expect, it, vi } from 'vitest'

import { createComposerContextBridge } from './composerContextBridge'

describe('createComposerContextBridge', () => {
  it('exposes only the versioned list, refresh and local validation channels', async () => {
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

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'codex:composer-context:list',
      'codex:composer-context:refresh',
      'codex:composer-context:validate-local-attachments'
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
})
