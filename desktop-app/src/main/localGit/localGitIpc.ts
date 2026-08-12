import {
  gitResolveRepositoryTargetRequestSchema,
  localCommitRequestSchema,
  localGitBranchRequestSchema,
  localGitBranchSearchRequestSchema,
  localGitCheckoutBranchRequestSchema,
  localGitCreateBranchRequestSchema,
  localGitGetFileDiffRequestSchema,
  localGitGetReviewApplyCommandRequestSchema,
  localGitGetReviewDiffFileContentsRequestSchema,
  localGitGetReviewFileContentRequestSchema,
  localGitGetTurnDiffFileContentsRequestSchema,
  localGitGetReviewSnapshotRequestSchema,
  localGitRefreshReviewFilesRequestSchema,
  localGitListCommitsRequestSchema,
  localGitGetSummaryRequestSchema,
  localGitReviewMutationRequestSchema,
  localGitResolveMergeBaseRequestSchema,
  localGitSearchReviewRequestSchema,
  turnPatchRequestSchema
} from '../../shared/localGitApi'
import { LocalBranchService } from './LocalBranchService'
import { LocalCommitService } from './LocalCommitService'
import { LocalGitService } from './LocalGitService'
import type { GitRepositoryTargetResolver } from './GitRepositoryTargetResolver'
import type { LocalGitWatchBroker } from './LocalGitWatchBroker'
import type { LocalGitTarget } from './types'

export type LocalGitIpcHandlers = {
  resolveRepositoryTarget(_event: unknown, payload: unknown): Promise<unknown>
  getSummary(_event: unknown, payload: unknown): Promise<unknown>
  listCommits(_event: unknown, payload: unknown): Promise<unknown>
  getReviewSnapshot(_event: unknown, payload: unknown): Promise<unknown>
  refreshReviewFiles(_event: unknown, payload: unknown): Promise<unknown>
  getFileDiff(_event: unknown, payload: unknown): Promise<unknown>
  getReviewApplyCommand(_event: unknown, payload: unknown): Promise<unknown>
  getReviewDiffFileContents(_event: unknown, payload: unknown): Promise<unknown>
  getTurnDiffFileContents(_event: unknown, payload: unknown): Promise<unknown>
  getReviewFileContent(_event: unknown, payload: unknown): Promise<unknown>
  searchReview(_event: unknown, payload: unknown): Promise<unknown>
  applyReviewAction(_event: unknown, payload: unknown): Promise<unknown>
  applyTurnPatch(_event: unknown, payload: unknown): Promise<unknown>
  listBranches(_event: unknown, payload: unknown): Promise<unknown>
  searchBranches(_event: unknown, payload: unknown): Promise<unknown>
  resolveMergeBase(_event: unknown, payload: unknown): Promise<unknown>
  createBranch(_event: unknown, payload: unknown): Promise<unknown>
  checkoutBranch(_event: unknown, payload: unknown): Promise<unknown>
  commitChanges(_event: unknown, payload: unknown): Promise<unknown>
}

export function createLocalGitIpcHandlers({
  localGit,
  targetResolver,
  branches = new LocalBranchService(localGit),
  commits = new LocalCommitService(localGit),
  watchBroker
}: {
  localGit: LocalGitService
  targetResolver?: GitRepositoryTargetResolver
  branches?: LocalBranchService
  commits?: LocalCommitService
  watchBroker?: Pick<LocalGitWatchBroker, 'observeTarget'>
}): LocalGitIpcHandlers {
  const observeTarget = (target: LocalGitTarget): void => watchBroker?.observeTarget(target)

  return {
    resolveRepositoryTarget: async (_event, payload) => {
      const request = gitResolveRepositoryTargetRequestSchema.parse(payload)
      if (!targetResolver) throw new Error('Git repository target resolver is unavailable')
      return targetResolver.resolve(request.target)
    },
    getSummary: async (_event, payload) => {
      const request = localGitGetSummaryRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getSummary(request.target)
    },
    listCommits: async (_event, payload) => {
      const request = localGitListCommitsRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.listCommits(request.target, request.limit)
    },
    getReviewSnapshot: async (_event, payload) => {
      const request = localGitGetReviewSnapshotRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getSnapshot(request.target, request.source)
    },
    refreshReviewFiles: async (_event, payload) => {
      const request = localGitRefreshReviewFilesRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.refreshReviewFiles(request)
    },
    getFileDiff: async (_event, payload) => {
      const request = localGitGetFileDiffRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getFileDiff(request)
    },
    getReviewApplyCommand: async (_event, payload) => {
      const request = localGitGetReviewApplyCommandRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getReviewApplyCommand(request)
    },
    getReviewDiffFileContents: async (_event, payload) => {
      const request = localGitGetReviewDiffFileContentsRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getReviewDiffFileContents(request)
    },
    getTurnDiffFileContents: async (_event, payload) => {
      const request = localGitGetTurnDiffFileContentsRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getTurnDiffFileContents(request)
    },
    getReviewFileContent: async (_event, payload) => {
      const request = localGitGetReviewFileContentRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.getReviewFileContent(request)
    },
    searchReview: async (_event, payload) => {
      const request = localGitSearchReviewRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.searchReview(request)
    },
    applyReviewAction: async (_event, payload) => {
      const request = localGitReviewMutationRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.mutateReview(request)
    },
    applyTurnPatch: async (_event, payload) => {
      const request = turnPatchRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.applyTurnPatch(request)
    },
    listBranches: async (_event, payload) => {
      const request = localGitBranchRequestSchema.parse(payload)
      observeTarget(request.target)
      return branches.list(request.target)
    },
    searchBranches: async (_event, payload) => {
      const request = localGitBranchSearchRequestSchema.parse(payload)
      observeTarget(request.target)
      return branches.search(request.target, request.query)
    },
    resolveMergeBase: async (_event, payload) => {
      const request = localGitResolveMergeBaseRequestSchema.parse(payload)
      observeTarget(request.target)
      return localGit.resolveMergeBase(request.target, request.baseBranch)
    },
    createBranch: async (_event, payload) => {
      const request = localGitCreateBranchRequestSchema.parse(payload)
      observeTarget(request.target)
      return branches.createAndCheckout(request.target, request.branch)
    },
    checkoutBranch: async (_event, payload) => {
      const request = localGitCheckoutBranchRequestSchema.parse(payload)
      observeTarget(request.target)
      return branches.checkout(request.target, request.branch)
    },
    commitChanges: async (_event, payload) => {
      const request = localCommitRequestSchema.parse(payload)
      observeTarget(request.target)
      return commits.commit(request)
    }
  }
}
