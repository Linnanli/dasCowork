import { describe, expect, it, vi } from 'vitest'

import { createOpenLocalPathHandler, openLocalPath, resolveLocalOpenPath } from './localPathOpen'

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

  it('resolves a relative path inside cwd before opening it', async () => {
    const shellOpenPath = vi.fn(async () => '')
    const handler = createOpenLocalPathHandler(shellOpenPath)

    await handler(undefined, {
      path: 'desktop-app/src/main/index.ts',
      cwd: '/tmp/dasCowork',
      line: 20
    })

    expect(shellOpenPath).toHaveBeenCalledWith('/tmp/dasCowork/desktop-app/src/main/index.ts')
  })

  it('strips a matching workspace basename from relative paths', () => {
    expect(
      resolveLocalOpenPath({
        path: 'dasCowork/desktop-app/src/main/index.ts',
        cwd: '/tmp/dasCowork'
      })
    ).toBe('/tmp/dasCowork/desktop-app/src/main/index.ts')
  })

  it('supports Windows cwd and workspace-prefixed paths', () => {
    expect(
      resolveLocalOpenPath({
        path: 'dasCowork\\desktop-app\\src\\main\\index.ts',
        cwd: 'C:\\work\\dasCowork'
      })
    ).toBe('C:\\work\\dasCowork\\desktop-app\\src\\main\\index.ts')
  })

  it('rejects relative paths that escape cwd', async () => {
    const shellOpenPath = vi.fn(async () => '')
    const handler = createOpenLocalPathHandler(shellOpenPath)

    await expect(
      handler(undefined, { path: '../outside.md', cwd: '/tmp/dasCowork' })
    ).rejects.toThrow('relative path must stay inside cwd')
    expect(shellOpenPath).not.toHaveBeenCalled()
  })

  it.each([
    'https://example.com/report.md',
    'file:///tmp/report.md',
    '\\\\server\\share\\report.md',
    'report\0.md'
  ])('rejects a non-local relative path: %s', async (path) => {
    const shellOpenPath = vi.fn(async () => '')
    const handler = createOpenLocalPathHandler(shellOpenPath)

    await expect(handler(undefined, { path, cwd: '/tmp/dasCowork' })).rejects.toThrow()
    expect(shellOpenPath).not.toHaveBeenCalled()
  })

  it('surfaces shell.openPath errors', async () => {
    await expect(
      openLocalPath({ path: '/tmp/missing.md' }, async () => 'not found')
    ).rejects.toThrow('not found')
  })
})
