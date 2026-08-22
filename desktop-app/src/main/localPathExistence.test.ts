import { describe, expect, it, vi } from 'vitest'

import { createListExistingLocalPathsHandler, listExistingLocalPaths } from './localPathExistence'

describe('localPathExistence', () => {
  it('returns only existing validated paths while preserving the renderer lookup key', async () => {
    const stat = vi.fn(async (path: string) => {
      if (path === '/tmp/dasCowork/reports/summary.pdf') return {}
      throw new Error('ENOENT')
    })

    await expect(
      listExistingLocalPaths(
        {
          paths: [
            { path: 'reports/summary.pdf', cwd: '/tmp/dasCowork' },
            { path: '/tmp/missing.pdf' }
          ]
        },
        stat
      )
    ).resolves.toEqual({
      existingPaths: [{ path: 'reports/summary.pdf', cwd: '/tmp/dasCowork' }]
    })
    expect(stat).toHaveBeenCalledWith('/tmp/dasCowork/reports/summary.pdf')
    expect(stat).toHaveBeenCalledWith('/tmp/missing.pdf')
  })

  it('rejects unsafe paths before probing the filesystem', async () => {
    const stat = vi.fn(async () => ({}))
    const handler = createListExistingLocalPathsHandler({ stat })

    await expect(
      handler(undefined, { paths: [{ path: '../secrets.txt', cwd: '/tmp/dasCowork' }] })
    ).rejects.toThrow('relative path must stay inside cwd')
    expect(stat).not.toHaveBeenCalled()
  })
})
