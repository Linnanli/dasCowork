import { describe, expect, it, vi } from 'vitest'

import { createOpenLocalPathHandler, openLocalPath } from './localPathOpen'

describe('localPathOpen', () => {
  it('opens only the validated path and keeps line as best-effort metadata', async () => {
    const shellOpenPath = vi.fn(async () => '')
    const handler = createOpenLocalPathHandler(shellOpenPath)

    await handler(undefined, { path: '/tmp/report.md', line: 12 })

    expect(shellOpenPath).toHaveBeenCalledWith('/tmp/report.md')
    expect(shellOpenPath).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe renderer payloads before opening a path', async () => {
    const shellOpenPath = vi.fn(async () => '')
    const handler = createOpenLocalPathHandler(shellOpenPath)

    await expect(handler(undefined, { path: 'relative/report.md' })).rejects.toThrow()
    expect(shellOpenPath).not.toHaveBeenCalled()
  })

  it('surfaces shell.openPath errors', async () => {
    await expect(
      openLocalPath({ path: '/tmp/missing.md' }, async () => 'not found')
    ).rejects.toThrow('not found')
  })
})
