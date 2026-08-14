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

  it('rejects arbitrary push fields and forwards only a validated target', async () => {
    const push = vi.fn(async () => ({ status: 'nothing-to-push' as const }))
    const pushes = {
      getStatus: vi.fn(async () => ({})),
      push
    } as never
    const handlers = createLocalGitIpcHandlers({ localGit: {} as never, pushes })

    await handlers.pushChanges(undefined, { target })
    expect(push).toHaveBeenCalledWith(target)
    await expect(
      handlers.pushChanges(undefined, {
        target,
        remote: 'origin',
        refspec: 'HEAD:main',
        force: true
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

  it('parses bounded review search requests before reaching the service', async () => {
    const searchReview = vi.fn(async () => ({
      snapshotGeneration: 'generation',
      source: { type: 'unstaged' },
      items: [],
      totalMatches: 0,
      isCapped: false
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { searchReview } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      query: 'needle'
    }

    await handlers.searchReview(undefined, request)

    expect(searchReview).toHaveBeenCalledWith(request)
    await expect(
      handlers.searchReview(undefined, {
        ...request,
        source: { type: 'range', base: 'main' },
        args: ['diff']
      })
    ).rejects.toThrow()
  })

  it('forwards only fixed diff display options', async () => {
    const getFileDiff = vi.fn(async (request) => ({
      status: 'ready' as const,
      snapshotGeneration: request.snapshotGeneration,
      file: request.file,
      diff: '',
      truncated: false,
      binary: false,
      conflicted: false
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { getFileDiff } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      file: { path: 'src/index.ts', revision: 'revision' },
      options: { ignoreWhitespace: true, fullFiles: true }
    }

    await handlers.getFileDiff(undefined, request)

    expect(getFileDiff).toHaveBeenCalledWith(request)
    await expect(
      handlers.getFileDiff(undefined, {
        ...request,
        options: { ...request.options, args: ['--binary'] }
      })
    ).rejects.toThrow()
  })

  it('validates and forwards snapshot-bound apply-command requests', async () => {
    const getReviewApplyCommand = vi.fn(async (request) => ({
      snapshotGeneration: request.snapshotGeneration,
      source: request.source,
      command: "git apply - <<'PATCH'\ndiff --git a/a b/a\nPATCH"
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { getReviewApplyCommand } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation'
    }

    await handlers.getReviewApplyCommand(undefined, request)

    expect(getReviewApplyCommand).toHaveBeenCalledWith(request)
    await expect(
      handlers.getReviewApplyCommand(undefined, { ...request, args: ['diff'] })
    ).rejects.toThrow()
  })

  it('allows only signed rich preview file content requests', async () => {
    const getReviewFileContent = vi.fn(async () => ({
      status: 'text',
      mimeType: 'text/markdown',
      text: '# Preview'
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { getReviewFileContent } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      file: { path: 'docs/readme.md', revision: 'revision' },
      side: 'after'
    }

    await handlers.getReviewFileContent(undefined, request)

    expect(getReviewFileContent).toHaveBeenCalledWith(request)
    await expect(
      handlers.getReviewFileContent(undefined, {
        ...request,
        file: { path: '../outside.md', revision: 'revision' }
      })
    ).rejects.toThrow()
  })

  it('allows only signed full-diff file content requests', async () => {
    const getReviewDiffFileContents = vi.fn(async () => ({
      status: 'text',
      before: 'before\n',
      after: 'after\n'
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { getReviewDiffFileContents } as never
    })
    const request = {
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      file: { path: 'src/index.ts', revision: 'revision' }
    }

    await handlers.getReviewDiffFileContents(undefined, request)

    expect(getReviewDiffFileContents).toHaveBeenCalledWith(request)
    await expect(
      handlers.getReviewDiffFileContents(undefined, {
        ...request,
        file: { path: '../outside.ts', revision: 'revision' }
      })
    ).rejects.toThrow()
  })

  it('allows a repository-relative completed-turn patch request', async () => {
    const getTurnDiffFileContents = vi.fn(async () => ({
      status: 'text',
      before: 'before\n',
      after: 'after\n'
    }))
    const handlers = createLocalGitIpcHandlers({
      localGit: { getTurnDiffFileContents } as never
    })
    const request = {
      target,
      turnId: 'turn-1',
      path: 'src/index.ts'
    }

    await handlers.getTurnDiffFileContents(undefined, request)

    expect(getTurnDiffFileContents).toHaveBeenCalledWith(request)
    await expect(
      handlers.getTurnDiffFileContents(undefined, { ...request, path: '../outside.ts' })
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
