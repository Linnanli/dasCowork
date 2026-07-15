import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerContextChangeBroker } from './ComposerContextChangeBroker'

afterEach(() => {
  vi.useRealTimers()
})

describe('ComposerContextChangeBroker', () => {
  it('coalesces sections with the same scope within 250ms', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const broker = new ComposerContextChangeBroker({ publish })

    broker.notify({ sectionIds: ['agents'], scope: { threadId: 'thread-1' } })
    broker.notify({ sectionIds: ['chats'], scope: { threadId: 'thread-1' } })
    vi.advanceTimersByTime(249)
    expect(publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith({
      version: 1,
      sectionIds: ['agents', 'chats'],
      scope: { threadId: 'thread-1' }
    })
  })

  it('keeps different scopes separate and cancels pending changes on dispose', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const broker = new ComposerContextChangeBroker({ publish })

    broker.notify({ sectionIds: ['agents'], scope: { threadId: 'thread-1' } })
    broker.notify({ sectionIds: ['agents'], scope: { threadId: 'thread-2' } })
    broker.dispose()
    vi.runAllTimers()

    expect(publish).not.toHaveBeenCalled()
  })
})
