import { describe, expect, it, vi } from 'vitest'

import {
  createListComposerContextHandler,
  createRefreshComposerContextHandler
} from './composerContextIpc'

describe('composer context IPC handlers', () => {
  it('validates list and refresh payloads before invoking the service', async () => {
    const service = {
      list: vi.fn(async () => ({ version: 1 as const, generatedAt: '', sections: [] })),
      refresh: vi.fn(async () => ({ version: 1 as const, generatedAt: '', sections: [] }))
    }
    const list = createListComposerContextHandler(service)
    const refresh = createRefreshComposerContextHandler(service)

    await list(undefined, { version: 1, cwd: '/repo' })
    await refresh(undefined, {
      input: { version: 1, threadId: 'thread-1' },
      options: { sectionIds: ['skills'] }
    })
    expect(service.list).toHaveBeenCalledWith({ version: 1, cwd: '/repo' })
    expect(service.refresh).toHaveBeenCalledWith(
      { version: 1, threadId: 'thread-1' },
      { sectionIds: ['skills'] }
    )
    expect(() => list(undefined, { version: 2 })).toThrow()
    expect(service.list).toHaveBeenCalledTimes(1)
  })
})
