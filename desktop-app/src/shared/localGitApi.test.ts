import { describe, expect, it } from 'vitest'

import {
  LOCAL_GIT_PATCH_MAX_CHARACTERS,
  LOCAL_GIT_REVIEW_SEARCH_MAX_RESULTS,
  gitConversationTargetSchema,
  gitIpcChannels,
  gitRepositoryTargetSchema,
  gitResolveRepositoryTargetRequestSchema,
  gitResolveRepositoryTargetResultSchema,
  localBranchCheckoutResultSchema,
  localCommitRequestSchema,
  localCommitResultSchema,
  localGitBranchSearchRequestSchema,
  localGitChangeEventSchema,
  localGitCreateBranchRequestSchema,
  localGitGetFileDiffRequestSchema,
  localGitGetReviewApplyCommandRequestSchema,
  localGitGetReviewDiffFileContentsRequestSchema,
  localGitGetTurnDiffFileContentsRequestSchema,
  localGitGetReviewSnapshotRequestSchema,
  localGitGetReviewFileContentRequestSchema,
  localGitRefreshReviewFilesRequestSchema,
  localGitListCommitsRequestSchema,
  localGitGetSummaryRequestSchema,
  localGitGetPublishStatusRequestSchema,
  localGitFileDiffResultSchema,
  localGitMutationResultSchema,
  localGitPublishStatusSchema,
  localGitReviewApplyCommandSchema,
  localGitReviewMutationRequestSchema,
  localGitReviewSearchResultSchema,
  localGitReviewFileContentSchema,
  localGitReviewDiffFileContentsSchema,
  localGitReviewSnapshotSchema,
  localGitSearchReviewRequestSchema,
  localPushRequestSchema,
  localPushResultSchema,
  turnPatchRequestSchema
} from './localGitApi'

const conversationTarget = { conversationId: 'conversation-1', threadId: 'thread-1' }
const target = {
  ...conversationTarget,
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}
const source = { type: 'unstaged' as const }

describe('local git API schemas', () => {
  it('models a stale file diff as an expected result', () => {
    expect(localGitFileDiffResultSchema.safeParse({ status: 'stale' }).success).toBe(true)
    expect(
      localGitFileDiffResultSchema.safeParse({
        status: 'ready',
        snapshotGeneration: 'generation-1',
        file: {
          path: 'src/index.ts',
          changeKind: 'modified',
          revision: 'revision-1',
          additions: 1,
          deletions: 1,
          binary: false,
          conflicted: false
        },
        diff: '',
        truncated: false,
        binary: false,
        conflicted: false
      }).success
    ).toBe(true)
  })

  it('separates conversation targets from resolved repository targets', () => {
    expect(gitConversationTargetSchema.safeParse(conversationTarget).success).toBe(true)
    expect(gitRepositoryTargetSchema.safeParse(target).success).toBe(true)
    expect(gitRepositoryTargetSchema.safeParse(conversationTarget).success).toBe(false)
    expect(
      gitResolveRepositoryTargetRequestSchema.safeParse({ target: conversationTarget }).success
    ).toBe(true)
    expect(
      gitResolveRepositoryTargetResultSchema.safeParse({ status: 'ready', target }).success
    ).toBe(true)
    expect(
      gitResolveRepositoryTargetResultSchema.safeParse({
        status: 'unavailable',
        reason: 'No local repository is attached'
      }).success
    ).toBe(true)
  })

  it('accepts fixed business requests and rejects arbitrary execution fields', () => {
    expect(localGitGetSummaryRequestSchema.safeParse({ target }).success).toBe(true)
    expect(localGitGetSummaryRequestSchema.safeParse({ target: conversationTarget }).success).toBe(
      false
    )
    expect(
      localGitGetSummaryRequestSchema.safeParse({
        target,
        cwd: '/repo',
        args: ['status'],
        shell: true
      }).success
    ).toBe(false)
  })

  it('bounds commit-list requests without accepting git command fields', () => {
    expect(localGitListCommitsRequestSchema.safeParse({ target, limit: 30 }).success).toBe(true)
    expect(
      localGitListCommitsRequestSchema.safeParse({ target, limit: 101, args: ['log'] }).success
    ).toBe(false)
  })

  it('accepts commits without a snapshot generation and rejects legacy commit snapshots', () => {
    const request = {
      target,
      message: 'Commit current index',
      includeUnstaged: true
    }
    expect(localCommitRequestSchema.safeParse(request).success).toBe(true)
    expect(
      localCommitRequestSchema.safeParse({
        ...request,
        snapshotGeneration: 'legacy-snapshot'
      }).success
    ).toBe(false)
    expect(localCommitResultSchema.safeParse({ status: 'nothing-to-commit' }).success).toBe(true)
    expect(localCommitResultSchema.safeParse({ status: 'stale-snapshot' }).success).toBe(false)
  })

  it('allows publish requests to name only a trusted target', () => {
    expect(localGitGetPublishStatusRequestSchema.safeParse({ target }).success).toBe(true)
    expect(localPushRequestSchema.safeParse({ target }).success).toBe(true)
    for (const field of ['remote', 'refspec', 'force', 'args', 'shell']) {
      expect(
        localPushRequestSchema.safeParse({ target, [field]: field === 'force' ? true : 'value' })
          .success
      ).toBe(false)
    }
  })

  it('uses structured, bounded publish status and result payloads', () => {
    expect(
      localGitPublishStatusSchema.safeParse({
        branch: 'main',
        hasHead: true,
        staged: { fileCount: 1, additions: 2, deletions: 1 },
        unstaged: { fileCount: 1, additions: 3, deletions: 0 },
        upstreamTrackingRef: 'refs/remotes/origin/main',
        upstreamRemote: 'origin',
        upstreamRemoteRef: 'refs/heads/main',
        selectedPushRemote: 'origin',
        commitsAhead: 1,
        pushBlockedReason: null
      }).success
    ).toBe(true)
    expect(
      localPushResultSchema.safeParse({
        status: 'success',
        branch: 'main',
        upstreamTrackingRef: 'refs/remotes/origin/main',
        upstreamRemote: 'origin',
        upstreamRemoteRef: 'refs/heads/main'
      }).success
    ).toBe(true)
    expect(localPushResultSchema.safeParse({ status: 'push-failed', force: true }).success).toBe(
      false
    )
  })

  it('validates review sources and rejects unknown source shapes', () => {
    expect(
      localGitGetReviewSnapshotRequestSchema.safeParse({
        target,
        source: { type: 'commit', commitSha: 'abc1234' }
      }).success
    ).toBe(true)
    expect(
      localGitGetReviewSnapshotRequestSchema.safeParse({
        target,
        source: { type: 'range', base: 'main', head: 'feature' }
      }).success
    ).toBe(false)
  })

  it('rejects unsafe branch refs', () => {
    expect(
      localGitCreateBranchRequestSchema.safeParse({
        target,
        branch: 'feature/local-review',
        failIfExists: true
      }).success
    ).toBe(true)
    for (const branch of ['../escape', 'feature..bad', 'feature lock', 'feature.lock', 'bad@{1}']) {
      expect(
        localGitCreateBranchRequestSchema.safeParse({
          target,
          branch,
          failIfExists: true
        }).success
      ).toBe(false)
    }
    expect(
      localGitCreateBranchRequestSchema.safeParse({
        target,
        branch: 'feature/local-review',
        failIfExists: false
      }).success
    ).toBe(false)
  })

  it('rejects repository path traversal and absolute paths in file targets', () => {
    const validRequest = {
      target,
      source,
      snapshotGeneration: 'generation-1',
      action: 'stage',
      scope: 'file',
      files: [{ path: 'src/index.ts', revision: 'rev-1' }]
    }
    expect(localGitReviewMutationRequestSchema.safeParse(validRequest).success).toBe(true)
    for (const path of ['../secret', 'src/../secret', '/tmp/secret', 'C:\\repo\\secret.ts']) {
      expect(
        localGitReviewMutationRequestSchema.safeParse({
          ...validRequest,
          files: [{ path, revision: 'rev-1' }]
        }).success
      ).toBe(false)
    }
  })

  it('requires hunk indexes for hunk actions', () => {
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        action: 'revert',
        scope: 'hunk',
        files: [{ path: 'src/index.ts', revision: 'rev-1' }]
      }).success
    ).toBe(false)
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        action: 'revert',
        scope: 'hunk',
        hunkIndex: 0,
        files: [{ path: 'src/index.ts', revision: 'rev-1' }]
      }).success
    ).toBe(true)
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        action: 'stage',
        scope: 'file',
        hunkIndex: 0,
        files: [{ path: 'src/index.ts', revision: 'rev-1' }]
      }).success
    ).toBe(false)
  })

  it('requires exact review-file cardinality and unique paths for each scope', () => {
    const file = { path: 'src/index.ts', revision: 'rev-1' }
    const secondFile = { path: 'src/other.ts', revision: 'rev-2' }
    const baseRequest = {
      target,
      source,
      snapshotGeneration: 'generation-1',
      action: 'stage'
    }
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        ...baseRequest,
        scope: 'section',
        files: [file, secondFile]
      }).success
    ).toBe(true)
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        ...baseRequest,
        scope: 'file',
        files: [file, secondFile]
      }).success
    ).toBe(false)
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        ...baseRequest,
        scope: 'hunk',
        hunkIndex: 0,
        files: [file, secondFile]
      }).success
    ).toBe(false)
    expect(
      localGitReviewMutationRequestSchema.safeParse({
        ...baseRequest,
        scope: 'section',
        files: [file, file]
      }).success
    ).toBe(false)
  })

  it('accepts bounded persistent turn patch batches and rejects malformed payloads', () => {
    expect(
      turnPatchRequestSchema.safeParse({
        target,
        action: 'undo',
        turnId: 'turn-1',
        batches: [{ cwd: '/repo', diff: 'diff --git a/a b/a\n' }]
      }).success
    ).toBe(true)
    expect(
      turnPatchRequestSchema.safeParse({
        target,
        action: 'undo',
        turnId: 'turn-1'
      }).success
    ).toBe(false)
    expect(
      turnPatchRequestSchema.safeParse({
        target,
        action: 'undo',
        turnId: 'turn-1',
        batches: [{ cwd: 'relative', diff: 'diff --git a/a b/a\n' }]
      }).success
    ).toBe(false)
    expect(
      turnPatchRequestSchema.safeParse({
        target,
        action: 'undo',
        turnId: 'turn-1',
        batches: [{ cwd: '/repo', diff: 'x'.repeat(LOCAL_GIT_PATCH_MAX_CHARACTERS + 1) }]
      }).success
    ).toBe(false)
    expect(
      turnPatchRequestSchema.safeParse({
        target,
        action: 'undo',
        turnId: 'turn-1',
        batches: [
          { cwd: '/repo', diff: 'x'.repeat(LOCAL_GIT_PATCH_MAX_CHARACTERS / 2 + 1) },
          { cwd: '/repo', diff: 'x'.repeat(LOCAL_GIT_PATCH_MAX_CHARACTERS / 2 + 1) }
        ]
      }).success
    ).toBe(false)
  })

  it('validates review snapshot and mutation result payloads', () => {
    expect(
      localGitReviewSnapshotSchema.safeParse({
        snapshotGeneration: 'generation-1',
        gitRoot: '/repo',
        source,
        files: [
          {
            path: 'src/index.ts',
            changeKind: 'modified',
            revision: 'rev-1',
            additions: 2,
            deletions: 1,
            binary: false,
            conflicted: false
          }
        ],
        stagedFileCount: 0,
        unstagedFileCount: 1,
        largeDiff: false
      }).success
    ).toBe(true)
    expect(
      localGitMutationResultSchema.safeParse({
        status: 'partial-success',
        errorCode: 'stale-snapshot',
        appliedPaths: ['src/index.ts'],
        skippedPaths: ['src/skip.ts'],
        conflictedPaths: ['src/conflict.ts']
      }).success
    ).toBe(true)
    expect(
      localGitMutationResultSchema.safeParse({
        status: 'ok',
        appliedPaths: [],
        skippedPaths: [],
        conflictedPaths: []
      }).success
    ).toBe(false)
  })

  it('accepts only fixed review diff options and snapshot-bound apply-command requests', () => {
    const file = { path: 'src/index.ts', revision: 'rev-1' }
    expect(
      localGitGetFileDiffRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file,
        options: { ignoreWhitespace: true, fullFiles: true }
      }).success
    ).toBe(true)
    expect(
      localGitGetFileDiffRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file,
        options: { ignoreWhitespace: true, fullFiles: false, args: ['--binary'] }
      }).success
    ).toBe(false)

    expect(
      localGitGetReviewDiffFileContentsRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file
      }).success
    ).toBe(true)
    expect(
      localGitGetReviewDiffFileContentsRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file: { ...file, path: '../outside.ts' }
      }).success
    ).toBe(false)
    expect(
      localGitGetTurnDiffFileContentsRequestSchema.safeParse({
        target,
        turnId: 'turn-1',
        path: 'src/index.ts'
      }).success
    ).toBe(true)
    expect(
      localGitGetTurnDiffFileContentsRequestSchema.safeParse({
        target,
        turnId: 'turn-1',
        path: 'src/index.ts',
        diff: '@@ -1,0 +1,0 @@\n'
      }).success
    ).toBe(false)
    expect(
      localGitGetTurnDiffFileContentsRequestSchema.safeParse({
        target,
        turnId: 'turn-1',
        path: '../outside.ts'
      }).success
    ).toBe(false)
    expect(
      localGitReviewDiffFileContentsSchema.safeParse({
        status: 'text',
        before: 'before\n',
        after: 'after\n'
      }).success
    ).toBe(true)

    const request = { target, source, snapshotGeneration: 'generation-1' }
    expect(localGitGetReviewApplyCommandRequestSchema.safeParse(request).success).toBe(true)
    expect(
      localGitGetReviewApplyCommandRequestSchema.safeParse({ ...request, args: ['diff'] }).success
    ).toBe(false)
    expect(
      localGitReviewApplyCommandSchema.safeParse({
        snapshotGeneration: 'generation-1',
        source,
        command: "git apply - <<'PATCH'\ndiff --git a/a b/a\nPATCH"
      }).success
    ).toBe(true)
  })

  it('validates bounded review search requests and structured match results', () => {
    expect(
      localGitSearchReviewRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        query: 'needle'
      }).success
    ).toBe(true)
    expect(
      localGitSearchReviewRequestSchema.safeParse({
        target,
        source: { type: 'range', base: 'main' },
        snapshotGeneration: 'generation-1',
        query: 'needle',
        args: ['diff']
      }).success
    ).toBe(false)
    expect(
      localGitReviewSearchResultSchema.safeParse({
        snapshotGeneration: 'generation-1',
        source,
        items: [
          {
            path: 'src/index.ts',
            hunkId: '@@ -1 +1 @@',
            side: 'additions',
            lineStart: 1,
            lineEnd: 1,
            patchOffset: 42,
            snippet: { before: 'before', match: '+needle', after: 'after' }
          },
          {
            path: 'src/index.ts',
            hunkId: 'path',
            side: 'additions',
            lineStart: 0,
            lineEnd: 0,
            patchOffset: 0,
            snippet: { before: '', match: 'src/index.ts', after: '' }
          }
        ],
        totalMatches: 2,
        isCapped: false
      }).success
    ).toBe(true)
    expect(
      localGitReviewSearchResultSchema.safeParse({
        snapshotGeneration: 'generation-1',
        source,
        items: Array.from({ length: LOCAL_GIT_REVIEW_SEARCH_MAX_RESULTS + 1 }, (_, index) => ({
          path: `src/${index}.ts`,
          hunkId: 'path',
          side: 'additions',
          lineStart: 0,
          lineEnd: 0,
          patchOffset: index,
          snippet: { before: '', match: 'src', after: '' }
        })),
        totalMatches: LOCAL_GIT_REVIEW_SEARCH_MAX_RESULTS + 1,
        isCapped: true
      }).success
    ).toBe(false)
    expect(
      localGitReviewSearchResultSchema.safeParse({
        snapshotGeneration: 'generation-1',
        source,
        items: [
          {
            path: 'src/index.ts',
            hunkId: '@@ -1 +1 @@',
            lineStart: 1,
            lineEnd: 1,
            patchOffset: 0,
            snippet: { before: '', match: '+needle', after: '' }
          }
        ],
        totalMatches: 1,
        isCapped: false
      }).success
    ).toBe(false)
  })

  it('only permits snapshot-bound rich preview content requests', () => {
    expect(
      localGitGetReviewFileContentRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file: { path: 'docs/readme.md', revision: 'revision-1' },
        side: 'after'
      }).success
    ).toBe(true)
    expect(
      localGitGetReviewFileContentRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        file: { path: '../private.md', revision: 'revision-1' },
        side: 'after',
        ref: 'HEAD:private.md'
      }).success
    ).toBe(false)
    expect(
      localGitReviewFileContentSchema.safeParse({
        status: 'media',
        mimeType: 'image/png',
        base64: 'aGVsbG8='
      }).success
    ).toBe(true)
  })

  it('validates branch and subscription result contracts', () => {
    expect(
      localGitBranchSearchRequestSchema.safeParse({
        target,
        query: 'feature'
      }).success
    ).toBe(true)
    expect(
      localBranchCheckoutResultSchema.safeParse({
        status: 'error',
        errorCode: 'blocked-by-working-tree-changes',
        conflictedPaths: ['src/index.ts']
      }).success
    ).toBe(true)
    expect(
      localBranchCheckoutResultSchema.safeParse({
        status: 'error',
        errorCode: 'stash-failed',
        conflictedPaths: []
      }).success
    ).toBe(false)
    expect(
      localGitChangeEventSchema.safeParse({
        target,
        snapshotGeneration: 'generation-2',
        changeTypes: ['head', 'working-tree'],
        changedPaths: ['src/index.ts']
      }).success
    ).toBe(true)
  })

  it('limits a review refresh to distinct repository-relative paths', () => {
    expect(
      localGitRefreshReviewFilesRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        paths: ['src/index.ts', 'src/previous-index.ts']
      }).success
    ).toBe(true)
    expect(
      localGitRefreshReviewFilesRequestSchema.safeParse({
        target,
        source,
        snapshotGeneration: 'generation-1',
        paths: ['src/index.ts', 'src/index.ts']
      }).success
    ).toBe(false)
  })

  it('uses git IPC channel names', () => {
    expect(gitIpcChannels.resolveRepositoryTarget).toBe('git:resolve-repository-target')
    expect(Object.values(gitIpcChannels).every((channel) => channel.startsWith('git:'))).toBe(true)
  })
})
