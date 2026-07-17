import { describe, expect, it, vi } from 'vitest'

import { createBeforeQuitHandler } from './appShutdown'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('createBeforeQuitHandler', () => {
  it('waits for cleanup once before allowing the app to quit', async () => {
    const cleanup = deferred()
    const shutdown = vi.fn(() => cleanup.promise)
    const quit = vi.fn()
    const onError = vi.fn()
    const handler = createBeforeQuitHandler({ shutdown, quit, onError })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    handler(firstEvent)
    handler(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    cleanup.resolve()
    await cleanup.promise
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())

    const finalEvent = { preventDefault: vi.fn() }
    handler(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports cleanup failures and still finishes quitting', async () => {
    const cleanupError = new Error('cleanup failed')
    const quit = vi.fn()
    const onError = vi.fn()
    const handler = createBeforeQuitHandler({
      shutdown: () => Promise.reject(cleanupError),
      quit,
      onError
    })

    handler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    expect(onError).toHaveBeenCalledWith(cleanupError)
  })
})
