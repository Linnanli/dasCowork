import { z } from 'zod'

export const LOCAL_GIT_PATCH_MAX_CHARACTERS = 2 * 1024 * 1024
export const LOCAL_GIT_TURN_PATCH_MAX_BATCHES = 100
export const LOCAL_GIT_REVIEW_MUTATION_MAX_FILES = 500
export const LOCAL_GIT_REVIEW_REFRESH_MAX_FILES = LOCAL_GIT_REVIEW_MUTATION_MAX_FILES * 2
export const LOCAL_GIT_COMMIT_MESSAGE_MAX_CHARACTERS = 16_000
export const LOCAL_GIT_REVIEW_SEARCH_MAX_RESULTS = 250
export const LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES = 5 * 1024 * 1024

const textEncoder = new TextEncoder()

const nonEmptyIdSchema = z.string().min(1).max(256)
const snapshotGenerationSchema = z.string().min(1).max(512)
const gitShaSchema = z.string().regex(/^[a-f0-9]{7,64}$/iu, 'commit sha must be hex')

const gitRefNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .superRefine((value, context) => {
    if (
      value.startsWith('/') ||
      value.endsWith('/') ||
      value.endsWith('.') ||
      value.includes('//') ||
      value.includes('..') ||
      value.includes('@{') ||
      value.includes('\\') ||
      value.includes('\0') ||
      /[\s~^:?*[\]]/u.test(value) ||
      value.split('/').some((part) => part.length === 0 || part.endsWith('.lock'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'branch name must be a safe git ref'
      })
    }
  })

const repoRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .superRefine((value, context) => {
    if (
      value.includes('\0') ||
      value.startsWith('/') ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      value.startsWith('..') ||
      value.includes('/../') ||
      value.includes('\\') ||
      value.split('/').some((part) => part.length === 0) ||
      value !== normalizeRepoPath(value)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'path must be a normalized repository-relative path'
      })
    }
  })

const absoluteLocalPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .superRefine((value, context) => {
    if (
      value.includes('\0') ||
      value.startsWith('//') ||
      value.startsWith('\\\\') ||
      (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'path must be an absolute local path'
      })
    }
  })

export const gitConversationTargetSchema = z
  .object({
    conversationId: nonEmptyIdSchema,
    threadId: nonEmptyIdSchema.optional()
  })
  .strict()
export type GitConversationTarget = z.infer<typeof gitConversationTargetSchema>

export const gitRepositoryTargetSchema = gitConversationTargetSchema
  .extend({
    hostId: nonEmptyIdSchema,
    cwd: absoluteLocalPathSchema,
    gitRoot: absoluteLocalPathSchema
  })
  .strict()
export type GitRepositoryTarget = z.infer<typeof gitRepositoryTargetSchema>

export type LocalGitTarget = GitRepositoryTarget

export const gitResolveRepositoryTargetRequestSchema = z
  .object({ target: gitConversationTargetSchema })
  .strict()
export type GitResolveRepositoryTargetRequest = z.infer<
  typeof gitResolveRepositoryTargetRequestSchema
>

export const gitResolveRepositoryTargetResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), target: gitRepositoryTargetSchema }).strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.string().min(1).max(2000)
    })
    .strict()
])
export type GitResolveRepositoryTargetResult = z.infer<
  typeof gitResolveRepositoryTargetResultSchema
>

export const localGitReviewSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unstaged') }).strict(),
  z.object({ type: z.literal('staged') }).strict(),
  z.object({ type: z.literal('commit'), commitSha: gitShaSchema }).strict(),
  z.object({ type: z.literal('branch'), baseBranch: gitRefNameSchema }).strict(),
  z.object({ type: z.literal('last-turn'), turnId: nonEmptyIdSchema }).strict()
])
export type LocalGitReviewSource = z.infer<typeof localGitReviewSourceSchema>

export const localGitChangeKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-change',
  'unmerged',
  'unknown'
])
export type LocalGitChangeKind = z.infer<typeof localGitChangeKindSchema>

export const localGitReviewFileSchema = z
  .object({
    path: repoRelativePathSchema,
    previousPath: repoRelativePathSchema.optional(),
    changeKind: localGitChangeKindSchema,
    revision: z.string().min(1).max(1024),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
    conflicted: z.boolean()
  })
  .strict()
export type LocalGitReviewFile = z.infer<typeof localGitReviewFileSchema>

export const localGitReviewSnapshotSchema = z
  .object({
    snapshotGeneration: snapshotGenerationSchema,
    gitRoot: absoluteLocalPathSchema,
    source: localGitReviewSourceSchema,
    files: z.array(localGitReviewFileSchema).max(10_000),
    stagedFileCount: z.number().int().nonnegative(),
    unstagedFileCount: z.number().int().nonnegative(),
    largeDiff: z.boolean()
  })
  .strict()
export type LocalGitReviewSnapshot = z.infer<typeof localGitReviewSnapshotSchema>

export const localGitSummarySchema = z
  .object({
    snapshotGeneration: snapshotGenerationSchema,
    gitRoot: absoluteLocalPathSchema.optional(),
    stagedFileCount: z.number().int().nonnegative(),
    unstagedFileCount: z.number().int().nonnegative(),
    untrackedFileCount: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    branch: z.string().min(1).max(255).nullable(),
    unavailableReason: z.string().min(1).max(2000).optional()
  })
  .strict()
export type LocalGitSummary = z.infer<typeof localGitSummarySchema>

export const localGitGetSummaryRequestSchema = z
  .object({ target: gitRepositoryTargetSchema })
  .strict()
export type LocalGitGetSummaryRequest = z.infer<typeof localGitGetSummaryRequestSchema>

export const localGitCommitSummarySchema = z
  .object({
    sha: gitShaSchema,
    subject: z.string().min(1).max(2_000),
    committedAt: z.number().int().nonnegative()
  })
  .strict()
export type LocalGitCommitSummary = z.infer<typeof localGitCommitSummarySchema>

export const localGitListCommitsRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict()
export type LocalGitListCommitsRequest = z.infer<typeof localGitListCommitsRequestSchema>

export const localGitGetReviewSnapshotRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema
  })
  .strict()
export type LocalGitGetReviewSnapshotRequest = z.infer<
  typeof localGitGetReviewSnapshotRequestSchema
>

export const localGitGetFileDiffRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    file: localGitReviewFileSchema.pick({
      path: true,
      previousPath: true,
      revision: true
    }),
    options: z
      .object({
        ignoreWhitespace: z.boolean(),
        fullFiles: z.boolean()
      })
      .strict()
      .optional()
  })
  .strict()
export type LocalGitGetFileDiffRequest = z.infer<typeof localGitGetFileDiffRequestSchema>

export const localGitGetReviewApplyCommandRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema
  })
  .strict()
export type LocalGitGetReviewApplyCommandRequest = z.infer<
  typeof localGitGetReviewApplyCommandRequestSchema
>

export const localGitReviewApplyCommandSchema = z
  .object({
    snapshotGeneration: snapshotGenerationSchema,
    source: localGitReviewSourceSchema,
    command: z
      .string()
      .min(1)
      .max(LOCAL_GIT_PATCH_MAX_CHARACTERS + 2048)
  })
  .strict()
export type LocalGitReviewApplyCommand = z.infer<typeof localGitReviewApplyCommandSchema>

export const localGitSearchReviewRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    query: z.string().trim().max(255)
  })
  .strict()
export type LocalGitSearchReviewRequest = z.infer<typeof localGitSearchReviewRequestSchema>

export const localGitReviewSearchItemSchema = z
  .object({
    path: repoRelativePathSchema,
    hunkId: z.union([z.literal('path'), z.string().min(1).max(2_000)]),
    side: z.enum(['deletions', 'additions']),
    lineStart: z.number().int().nonnegative(),
    lineEnd: z.number().int().nonnegative(),
    patchOffset: z.number().int().nonnegative(),
    snippet: z
      .object({
        before: z.string().max(1_000),
        match: z.string().max(1_000),
        after: z.string().max(1_000)
      })
      .strict()
  })
  .strict()
export type LocalGitReviewSearchItem = z.infer<typeof localGitReviewSearchItemSchema>

export const localGitReviewSearchResultSchema = z
  .object({
    snapshotGeneration: snapshotGenerationSchema,
    source: localGitReviewSourceSchema,
    items: z.array(localGitReviewSearchItemSchema).max(LOCAL_GIT_REVIEW_SEARCH_MAX_RESULTS),
    totalMatches: z.number().int().nonnegative(),
    isCapped: z.boolean()
  })
  .strict()
export type LocalGitReviewSearchResult = z.infer<typeof localGitReviewSearchResultSchema>

export const localGitReviewContentSideSchema = z.enum(['before', 'after'])
export type LocalGitReviewContentSide = z.infer<typeof localGitReviewContentSideSchema>

export const localGitGetReviewFileContentRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    file: localGitReviewFileSchema.pick({
      path: true,
      previousPath: true,
      revision: true
    }),
    side: localGitReviewContentSideSchema
  })
  .strict()
export type LocalGitGetReviewFileContentRequest = z.infer<
  typeof localGitGetReviewFileContentRequestSchema
>

/**
 * Requests both sides of a snapshot-bound text diff.  The renderer uses these
 * complete files to expose collapsed unchanged regions without trusting a
 * mutable working tree read.
 */
export const localGitGetReviewDiffFileContentsRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    file: localGitReviewFileSchema.pick({
      path: true,
      previousPath: true,
      revision: true
    })
  })
  .strict()
export type LocalGitGetReviewDiffFileContentsRequest = z.infer<
  typeof localGitGetReviewDiffFileContentsRequestSchema
>

/**
 * Reconstructs the full before/after text for one persisted completed-turn
 * patch. Main resolves the authoritative diff by thread and turn id; the
 * renderer only selects a file from that trusted patch.
 */
export const localGitGetTurnDiffFileContentsRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    turnId: nonEmptyIdSchema,
    path: repoRelativePathSchema
  })
  .strict()
export type LocalGitGetTurnDiffFileContentsRequest = z.infer<
  typeof localGitGetTurnDiffFileContentsRequestSchema
>

export const localGitReviewFileContentSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('text'),
      mimeType: z.string().min(1).max(255),
      text: z.string().max(LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES)
    })
    .strict(),
  z
    .object({
      status: z.literal('media'),
      mimeType: z.string().min(1).max(255),
      base64: z
        .string()
        .min(1)
        .max(Math.ceil((LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES * 4) / 3))
    })
    .strict(),
  z
    .object({
      status: z.literal('too-large'),
      maxBytes: z.number().int().positive(),
      size: z.number().int().nonnegative().optional()
    })
    .strict(),
  z.object({ status: z.literal('unsupported'), reason: z.string().min(1).max(500) }).strict(),
  z.object({ status: z.literal('stale') }).strict()
])
export type LocalGitReviewFileContent = z.infer<typeof localGitReviewFileContentSchema>

export const localGitReviewDiffFileContentsSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('text'),
      before: z.string().max(LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES),
      after: z.string().max(LOCAL_GIT_REVIEW_CONTENT_MAX_BYTES)
    })
    .strict(),
  z
    .object({
      status: z.literal('too-large'),
      maxBytes: z.number().int().positive(),
      size: z.number().int().nonnegative().optional()
    })
    .strict(),
  z.object({ status: z.literal('unsupported'), reason: z.string().min(1).max(500) }).strict(),
  z.object({ status: z.literal('stale') }).strict()
])
export type LocalGitReviewDiffFileContents = z.infer<typeof localGitReviewDiffFileContentsSchema>

export const localGitFileDiffResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      snapshotGeneration: snapshotGenerationSchema,
      file: localGitReviewFileSchema,
      diff: z.string().max(LOCAL_GIT_PATCH_MAX_CHARACTERS),
      truncated: z.boolean(),
      binary: z.boolean(),
      conflicted: z.boolean()
    })
    .strict(),
  z.object({ status: z.literal('stale') }).strict()
])
export type LocalGitFileDiffResult = z.infer<typeof localGitFileDiffResultSchema>
export type LocalGitFileDiff = Extract<LocalGitFileDiffResult, { status: 'ready' }>

export const localGitReviewActionSchema = z.enum(['stage', 'unstage', 'revert'])
export type LocalGitReviewAction = z.infer<typeof localGitReviewActionSchema>

export const localGitReviewScopeSchema = z.enum(['section', 'file', 'hunk'])
export type LocalGitReviewScope = z.infer<typeof localGitReviewScopeSchema>

export const localGitPatchTargetSchema = z.enum(['staged', 'unstaged', 'staged-and-unstaged'])
export type LocalGitPatchTarget = z.infer<typeof localGitPatchTargetSchema>

export const localGitReviewFileTargetSchema = z
  .object({
    path: repoRelativePathSchema,
    previousPath: repoRelativePathSchema.optional(),
    revision: z.string().min(1).max(1024)
  })
  .strict()
export type LocalGitReviewFileTarget = z.infer<typeof localGitReviewFileTargetSchema>

export const localGitReviewMutationRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    action: localGitReviewActionSchema,
    scope: localGitReviewScopeSchema,
    patchTarget: localGitPatchTargetSchema.optional(),
    files: z.array(localGitReviewFileTargetSchema).min(1).max(LOCAL_GIT_REVIEW_MUTATION_MAX_FILES),
    hunkIndex: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope !== 'section' && value.files.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'file and hunk actions require exactly one file'
      })
    }
    if (value.scope === 'hunk' && value.hunkIndex === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['hunkIndex'],
        message: 'hunk actions require a hunk index'
      })
    }
    if (value.scope !== 'hunk' && value.hunkIndex !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['hunkIndex'],
        message: 'only hunk actions may include a hunk index'
      })
    }
    const paths = new Set<string>()
    for (const [index, file] of value.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'review files must not contain duplicate paths'
        })
      }
      paths.add(file.path)
    }
  })
export type LocalGitReviewMutationRequest = z.infer<typeof localGitReviewMutationRequestSchema>

export const localGitRefreshReviewFilesRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    source: localGitReviewSourceSchema,
    snapshotGeneration: snapshotGenerationSchema,
    paths: z.array(repoRelativePathSchema).min(1).max(LOCAL_GIT_REVIEW_REFRESH_MAX_FILES)
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>()
    for (const [index, path] of value.paths.entries()) {
      if (paths.has(path)) {
        context.addIssue({
          code: 'custom',
          path: ['paths', index],
          message: 'review refresh paths must not contain duplicates'
        })
      }
      paths.add(path)
    }
  })
export type LocalGitRefreshReviewFilesRequest = z.infer<
  typeof localGitRefreshReviewFilesRequestSchema
>

export const localGitReviewFilesRefreshSchema = z
  .object({
    snapshotGeneration: snapshotGenerationSchema,
    files: z.array(localGitReviewFileSchema).max(LOCAL_GIT_REVIEW_REFRESH_MAX_FILES)
  })
  .strict()
export type LocalGitReviewFilesRefresh = z.infer<typeof localGitReviewFilesRefreshSchema>

export const localGitMutationResultSchema = z
  .object({
    status: z.enum(['success', 'partial-success', 'error']),
    errorCode: z.string().min(1).max(256).optional(),
    appliedPaths: z.array(repoRelativePathSchema).max(10_000),
    skippedPaths: z.array(repoRelativePathSchema).max(10_000),
    conflictedPaths: z.array(repoRelativePathSchema).max(10_000)
  })
  .strict()
export type LocalGitMutationResult = z.infer<typeof localGitMutationResultSchema>

export const turnPatchActionSchema = z.enum(['undo', 'reapply'])
export type TurnPatchAction = z.infer<typeof turnPatchActionSchema>

export const turnPatchBatchSchema = z
  .object({
    cwd: absoluteLocalPathSchema,
    gitRoot: absoluteLocalPathSchema.optional(),
    diff: z.string().min(1).max(LOCAL_GIT_PATCH_MAX_CHARACTERS)
  })
  .strict()
export type TurnPatchBatch = z.infer<typeof turnPatchBatchSchema>

export const turnPatchRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    action: turnPatchActionSchema,
    turnId: nonEmptyIdSchema,
    batches: z.array(turnPatchBatchSchema).min(1).max(LOCAL_GIT_TURN_PATCH_MAX_BATCHES)
  })
  .strict()
  .superRefine((value, context) => {
    const totalBytes = value.batches.reduce((total, batch) => total + turnPatchBatchBytes(batch), 0)
    if (totalBytes > LOCAL_GIT_PATCH_MAX_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        path: ['batches'],
        message: 'turn patch batches exceed the total patch size limit'
      })
    }
  })
export type TurnPatchRequest = z.infer<typeof turnPatchRequestSchema>

function turnPatchBatchBytes(batch: TurnPatchBatch): number {
  return (
    textEncoder.encode(batch.cwd).byteLength +
    textEncoder.encode(batch.gitRoot ?? '').byteLength +
    textEncoder.encode(batch.diff).byteLength
  )
}

export const localBranchSummarySchema = z
  .object({
    current: z.string().min(1).max(255).nullable(),
    defaultBase: z.string().min(1).max(255).nullable(),
    local: z.array(z.string().min(1).max(255)).max(5000),
    recent: z.array(z.string().min(1).max(255)).max(100),
    uncommittedFileCount: z.number().int().nonnegative()
  })
  .strict()
export type LocalBranchSummary = z.infer<typeof localBranchSummarySchema>

export const localBranchSearchResultSchema = z
  .object({
    branch: z.string().min(1).max(255),
    isCurrent: z.boolean(),
    isDefault: z.boolean(),
    isRecent: z.boolean(),
    uncommittedFileCount: z.number().int().nonnegative()
  })
  .strict()
export type LocalBranchSearchResult = z.infer<typeof localBranchSearchResultSchema>

export const localGitBranchRequestSchema = z.object({ target: gitRepositoryTargetSchema }).strict()
export type LocalGitBranchRequest = z.infer<typeof localGitBranchRequestSchema>

export const localGitBranchSearchRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    query: z.string().trim().max(255)
  })
  .strict()
export type LocalGitBranchSearchRequest = z.infer<typeof localGitBranchSearchRequestSchema>

/** Resolve a fixed merge base in Main before a branch review starts. */
export const localGitResolveMergeBaseRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    baseBranch: gitRefNameSchema
  })
  .strict()
export type LocalGitResolveMergeBaseRequest = z.infer<typeof localGitResolveMergeBaseRequestSchema>

export const localGitMergeBaseSchema = z
  .object({
    baseBranch: gitRefNameSchema,
    mergeBase: gitShaSchema
  })
  .strict()
export type LocalGitMergeBase = z.infer<typeof localGitMergeBaseSchema>

export const localGitCreateBranchRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    branch: gitRefNameSchema,
    failIfExists: z.literal(true)
  })
  .strict()
export type LocalGitCreateBranchRequest = z.infer<typeof localGitCreateBranchRequestSchema>

export const localGitCheckoutBranchRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    branch: gitRefNameSchema
  })
  .strict()
export type LocalGitCheckoutBranchRequest = z.infer<typeof localGitCheckoutBranchRequestSchema>

export const localBranchCheckoutResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), current: z.string().min(1).max(255) }).strict(),
  z
    .object({
      status: z.literal('error'),
      errorCode: z.enum([
        'blocked-by-working-tree-changes',
        'invalid-branch',
        'branch-not-found',
        'not-git-repo',
        'unknown'
      ]),
      conflictedPaths: z.array(repoRelativePathSchema).max(10_000),
      message: z.string().min(1).max(2000).optional()
    })
    .strict()
])
export type LocalBranchCheckoutResult = z.infer<typeof localBranchCheckoutResultSchema>

export const localCommitRequestSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    message: z.string().max(LOCAL_GIT_COMMIT_MESSAGE_MAX_CHARACTERS),
    includeUnstaged: z.boolean()
  })
  .strict()
export type LocalCommitRequest = z.infer<typeof localCommitRequestSchema>

export const localCommitResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), commitSha: gitShaSchema }).strict(),
  z
    .object({
      status: z.enum(['nothing-to-commit', 'generation-failed', 'commit-failed']),
      message: z.string().min(1).max(2000).optional()
    })
    .strict()
])
export type LocalCommitResult = z.infer<typeof localCommitResultSchema>

/** A bounded working-tree selection summary used by the commit/publish menu. */
export const localGitSelectionSummarySchema = z
  .object({
    fileCount: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative()
  })
  .strict()
export type LocalGitSelectionSummary = z.infer<typeof localGitSelectionSummarySchema>

export const localGitPushBlockedReasonSchema = z.enum([
  'branch-missing',
  'remote-missing',
  'remote-ambiguous',
  'nothing-to-push',
  'status-unavailable'
])
export type LocalGitPushBlockedReason = z.infer<typeof localGitPushBlockedReasonSchema>

/**
 * Renderer-safe state for the fixed commit/push workflow. Remote names and
 * refs are informational only: only Main turns this state into Git commands.
 */
export const localGitPublishStatusSchema = z
  .object({
    branch: z.string().min(1).max(255).nullable(),
    hasHead: z.boolean(),
    staged: localGitSelectionSummarySchema,
    unstaged: localGitSelectionSummarySchema,
    upstreamTrackingRef: z.string().min(1).max(1024).nullable(),
    upstreamRemote: z.string().min(1).max(255).nullable(),
    upstreamRemoteRef: z.string().min(1).max(1024).nullable(),
    selectedPushRemote: z.string().min(1).max(255).nullable(),
    commitsAhead: z.number().int().nonnegative(),
    pushBlockedReason: localGitPushBlockedReasonSchema.nullable(),
    unavailableReason: z.string().min(1).max(2000).optional()
  })
  .strict()
export type LocalGitPublishStatus = z.infer<typeof localGitPublishStatusSchema>

export const localGitGetPublishStatusRequestSchema = z
  .object({ target: gitRepositoryTargetSchema })
  .strict()
export type LocalGitGetPublishStatusRequest = z.infer<typeof localGitGetPublishStatusRequestSchema>

/** Push has no renderer-controlled remote, refspec, flags, or shell input. */
export const localPushRequestSchema = z.object({ target: gitRepositoryTargetSchema }).strict()
export type LocalPushRequest = z.infer<typeof localPushRequestSchema>

export const localPushResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('success'),
      branch: z.string().min(1).max(255),
      upstreamTrackingRef: z.string().min(1).max(1024),
      upstreamRemote: z.string().min(1).max(255),
      upstreamRemoteRef: z.string().min(1).max(1024)
    })
    .strict(),
  z
    .object({
      status: z.enum([
        'branch-missing',
        'remote-missing',
        'remote-ambiguous',
        'nothing-to-push',
        'status-unavailable',
        'push-failed'
      ]),
      message: z.string().min(1).max(2000).optional()
    })
    .strict()
])
export type LocalPushResult = z.infer<typeof localPushResultSchema>

export const localGitChangeTypeSchema = z.enum([
  'config',
  'head',
  'index',
  'remote-refs',
  'synced-branch',
  'worktree-topology',
  'working-tree'
])
export type LocalGitChangeType = z.infer<typeof localGitChangeTypeSchema>

export const localGitChangeEventSchema = z
  .object({
    target: gitRepositoryTargetSchema,
    snapshotGeneration: snapshotGenerationSchema,
    changeTypes: z.array(localGitChangeTypeSchema).min(1).max(7),
    changedPaths: z.array(repoRelativePathSchema).max(64).optional()
  })
  .strict()
export type LocalGitChangeEvent = z.infer<typeof localGitChangeEventSchema>

export const gitIpcChannels = {
  resolveRepositoryTarget: 'git:resolve-repository-target',
  getSummary: 'git:get-summary',
  listCommits: 'git:list-commits',
  getReviewSnapshot: 'git:get-review-snapshot',
  refreshReviewFiles: 'git:refresh-review-files',
  getFileDiff: 'git:get-file-diff',
  getReviewApplyCommand: 'git:get-review-apply-command',
  getReviewFileContent: 'git:get-review-file-content',
  getReviewDiffFileContents: 'git:get-review-diff-file-contents',
  getTurnDiffFileContents: 'git:get-turn-diff-file-contents',
  searchReview: 'git:search-review',
  applyReviewAction: 'git:apply-review-action',
  applyTurnPatch: 'git:apply-turn-patch',
  listBranches: 'git:list-branches',
  searchBranches: 'git:search-branches',
  resolveMergeBase: 'git:resolve-merge-base',
  createBranch: 'git:create-branch',
  checkoutBranch: 'git:checkout-branch',
  commitChanges: 'git:commit-changes',
  getPublishStatus: 'git:get-publish-status',
  pushChanges: 'git:push-changes',
  changed: 'git:changed'
} as const

function normalizeRepoPath(value: string): string {
  return value.split('/').filter(Boolean).join('/')
}
