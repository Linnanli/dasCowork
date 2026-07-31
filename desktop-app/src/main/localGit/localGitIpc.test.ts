import { describe, expect, it, vi } from 'vitest'

import { createLocalGitIpcHandlers } from './localGitIpc'

const target = {
  conversationId: 'c',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

describe('localGitIpc', () => {
  it('rejects illegal refs before reaching the branch service', async () => {
    const localGit = { resolveTrustedGitRoot: vi.fn() } as never
    const branches = {
      list: vi.fn(),
      search: vi.fn(),
      checkout: vi.fn(),
      createAndCheckout: vi.fn()
    } as never
    const handlers = createLocalGitIpcHandlers({ localGit, branches })

    await expect(
      handlers.checkoutBranch(undefined, {
        target,
        branch: '../bad'
      })
    ).rejects.toThrow()
  })

  it('rejects malformed renderer-provided turn patches at the schema boundary', async () => {
    const localGit = { applyTurnPatch: vi.fn() } as never
    const handlers = createLocalGitIpcHandlers({ localGit })

    await expect(
      handlers.applyTurnPatch(undefined, {
        target,
        action: 'undo',
        turnId: 'turn_1',
        batches: [{ cwd: 'relative', diff: 'tampered patch' }]
      })
    ).rejects.toThrow()
  })

  it('forwards bounded persistent batches without a Main-memory registry', async () => {
    const applyTurnPatch = vi.fn(async () => ({ status: 'success' }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { applyTurnPatch } as never
    })

    await handlers.applyTurnPatch(undefined, {
      target,
      action: 'undo',
      turnId: 'turn_1',
      batches: [{ cwd: '/repo', gitRoot: '/repo', diff: 'trusted persisted patch' }]
    })

    expect(applyTurnPatch).toHaveBeenCalledWith({
      target,
      action: 'undo',
      turnId: 'turn_1',
      batches: [{ cwd: '/repo', gitRoot: '/repo', diff: 'trusted persisted patch' }]
    })
  })

  it('refreshes only schema-validated review paths', async () => {
    const refreshReviewFiles = vi.fn(async () => ({ snapshotGeneration: 'next', files: [] }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { refreshReviewFiles } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      paths: ['src/index.ts']
    }

    await handlers.refreshReviewFiles(undefined, request)

    expect(refreshReviewFiles).toHaveBeenCalledWith(request)
    await expect(
      handlers.refreshReviewFiles(undefined, { ...request, paths: ['../outside.ts'] })
    ).rejects.toThrow()
  })

  it('parses a safe base branch before resolving its merge base', async () => {
    const resolveMergeBase = vi.fn(async () => ({ mergeBase: 'a'.repeat(40) }))
    const localGit = {
      resolveMergeBase
    }
    const handlers = createLocalGitIpcHandlers({ localGit: localGit as never })

    await handlers.resolveMergeBase(undefined, {
      target,
      baseBranch: 'main'
    })

    expect(resolveMergeBase).toHaveBeenCalledWith(target, 'main')
    await expect(
      handlers.resolveMergeBase(undefined, {
        target,
        baseBranch: '../bad'
      })
    ).rejects.toThrow()
  })
})
