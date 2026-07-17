import { describe, expect, it, vi } from 'vitest'

import {
  createStartComposerContextSearchHandler,
  createStopComposerContextSearchHandler,
  createUpdateComposerContextSearchHandler
} from './composerContextSearchIpc'

describe('composer context search IPC', () => {
  it('validates payloads and forwards the sender id for owner checks', async () => {
    const service = {
      start: vi.fn(async () => ({
        version: 1 as const,
        sessionId: 'search-1',
        hostId: 'local',
        filesAvailable: true,
        tasksAvailable: true
      })),
      update: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined)
    }
    const event = { sender: { id: 42 } } as never
    const start = createStartComposerContextSearchHandler(service)
    const update = createUpdateComposerContextSearchHandler(service)
    const stop = createStopComposerContextSearchHandler(service)

    await start(event, { version: 1, cwd: '/repo' })
    await update(event, { version: 1, sessionId: 'search-1', query: 'needle' })
    await stop(event, { version: 1, sessionId: 'search-1' })

    expect(service.start).toHaveBeenCalledWith(42, { version: 1, cwd: '/repo' })
    expect(service.update).toHaveBeenCalledWith(42, {
      version: 1,
      sessionId: 'search-1',
      query: 'needle'
    })
    expect(service.stop).toHaveBeenCalledWith(42, 'search-1')
    expect(() => update(event, { version: 2 })).toThrow()
  })
})
