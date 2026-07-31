import { createHash, randomUUID } from 'node:crypto'
import { posix, relative, resolve, win32 } from 'node:path'

import type { ProjectService } from '../projects/ProjectService'
import {
  LOCAL_GIT_PATCH_MAX_CHARACTERS,
  LOCAL_GIT_TURN_PATCH_MAX_BATCHES
} from '../../shared/localGitApi'
import { applyGitPatch } from './applyPatch'
import { isGitCliError, runCachedGitRead, runGit } from './gitCli'
import { GitManager, type WorktreeRepository } from './GitManager'
import { GitHostRegistry } from './GitHostRegistry'
import {
  GitRepositoryTargetResolver,
  type ResolvedGitRepository
} from './GitRepositoryTargetResolver'
import {
  computeFileRevision,
  computeWorkspaceStateHash,
  createReviewSnapshot,
  getDiffForSource,
  InMemorySnapshotGenerationStore,
  listReviewFiles,
  type SnapshotGenerationRecord,
  type SnapshotGenerationStore
} from './reviewSnapshot'
import {
  assertSafeRepoRelativePath,
  extractFilePatch,
  extractHunkPatch,
  validateGitPatch
} from './reviewPatch'
import type {
  LocalGitMutationResult,
  LocalGitCommitSummary,
  LocalGitRefreshReviewFilesRequest,
  LocalGitMergeBase,
  LocalGitReviewFile,
  LocalGitReviewFilesRefresh,
  LocalGitReviewMutationRequest,
  LocalGitReviewSnapshot,
  LocalGitSummary,
  LocalGitTarget,
  TurnPatchRequest
} from './types'
import type { LocalGitWatchState } from './LocalGitWatchBroker'
const maxTurnPatchBytes = LOCAL_GIT_PATCH_MAX_CHARACTERS

export class LocalGitService {
  private readonly snapshots: SnapshotGenerationStore
  private readonly targetResolver: GitRepositoryTargetResolver
  private readonly reviewGenerations = new Map<string, { hostId: string; generation: number }>()

  constructor(options: {
    projectService?: ProjectService
    targetResolver?: GitRepositoryTargetResolver
    snapshots?: SnapshotGenerationStore
  }) {
    this.snapshots = options.snapshots ?? new InMemorySnapshotGenerationStore()
    if (options.targetResolver) {
      this.targetResolver = options.targetResolver
    } else if (options.projectService) {
      this.targetResolver = new GitRepositoryTargetResolver({
        projectService: options.projectService,
        gitManager: new GitManager(),
        hosts: new GitHostRegistry()
      })
    } else {
      throw new Error('LocalGitService requires a Git repository target resolver')
    }
  }

  async getSummary(target: LocalGitTarget): Promise<LocalGitSummary> {
    const snapshotGeneration = randomUUID()
    try {
      const { repository } = await this.resolveTrustedRepository(target)
      const gitRoot = repository.root
      const [staged, unstaged, untracked, stats, branch, stateHash] = await Promise.all([
        countLines(repository, 'summary-staged-count', ['diff', '--cached', '--name-only']),
        countLines(repository, 'summary-unstaged-count', ['diff', '--name-only']),
        countUntracked(repository),
        combinedNumstat(repository),
        runCachedGitRead(
          repository,
          'summary-branch',
          [],
          ['branch', '--show-current'],
          {},
          { staleTime: Infinity, metadata: { gitReadInvalidation: ['head'] } }
        ).then((result) => result.stdout.trim() || null),
        computeWorkspaceStateHash(repository)
      ])
      this.snapshots.rememberState(snapshotGeneration, gitRoot, stateHash)
      return {
        snapshotGeneration,
        gitRoot,
        stagedFileCount: staged,
        unstagedFileCount: unstaged,
        untrackedFileCount: untracked,
        additions: stats.additions,
        deletions: stats.deletions,
        branch
      }
    } catch (error) {
      return {
        snapshotGeneration,
        stagedFileCount: 0,
        unstagedFileCount: 0,
        untrackedFileCount: 0,
        additions: 0,
        deletions: 0,
        branch: null,
        unavailableReason: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async getSnapshot(
    target: LocalGitTarget,
    source: LocalGitReviewSnapshot['source']
  ): Promise<LocalGitReviewSnapshot> {
    const { repository } = await this.resolveTrustedRepository(target)
    const reviewSnapshot = repository.reviewSnapshot
    const { snapshot, stateHash } = await reviewSnapshot.read(() =>
      createReviewSnapshot({ repository, source })
    )
    this.snapshots.remember(snapshot, stateHash)
    this.reviewGenerations.set(snapshot.snapshotGeneration, {
      hostId: repository.host.id,
      generation: reviewSnapshot.generation
    })
    return snapshot
  }

  async refreshReviewFiles(
    input: LocalGitRefreshReviewFilesRequest
  ): Promise<LocalGitReviewFilesRefresh> {
    if (input.source.type === 'last-turn') throw new Error('last-turn files cannot be refreshed')
    const { repository } = await this.resolveTrustedRepository(input.target)
    const record = this.snapshots.get(input.snapshotGeneration)
    if (
      !record ||
      record.gitRoot !== repository.root ||
      !sameReviewSource(record.source, input.source)
    ) {
      throw new Error('stale-snapshot')
    }

    repository.clearShortLivedGitReadCaches()
    const reviewSnapshot = repository.reviewSnapshot
    const files = await reviewSnapshot.read(() =>
      listReviewFiles(repository, input.source, input.paths)
    )
    const refreshedFiles = mergeRefreshedReviewFiles(record.files, input.paths, files)
    const refreshedSnapshot: LocalGitReviewSnapshot = {
      snapshotGeneration: randomUUID(),
      gitRoot: repository.root,
      source: input.source,
      files: refreshedFiles,
      stagedFileCount: record.stagedFileCount,
      unstagedFileCount: record.unstagedFileCount,
      largeDiff: record.largeDiff && refreshedFiles.length > 0
    }
    this.snapshots.remember(refreshedSnapshot, record.stateHash)
    this.reviewGenerations.set(refreshedSnapshot.snapshotGeneration, {
      hostId: repository.host.id,
      generation: reviewSnapshot.generation
    })
    return { snapshotGeneration: refreshedSnapshot.snapshotGeneration, files }
  }

  async listCommits(target: LocalGitTarget, limit = 30): Promise<LocalGitCommitSummary[]> {
    const { repository } = await this.resolveTrustedRepository(target)
    const output = (
      await runCachedGitRead(
        repository,
        'commit-list',
        [String(limit)],
        ['log', `--max-count=${String(limit)}`, '--format=%H%x00%s%x00%ct%x00'],
        {},
        { staleTime: Infinity, metadata: { gitReadInvalidation: ['head'] } }
      )
    ).stdout
    const values = output.split('\0').filter(Boolean)
    const commits: LocalGitCommitSummary[] = []
    for (let index = 0; index + 2 < values.length; index += 3) {
      const sha = values[index]
      const subject = values[index + 1]
      const committedAt = Number(values[index + 2])
      if (!sha || !subject || !Number.isSafeInteger(committedAt)) continue
      commits.push({ sha, subject, committedAt })
    }
    return commits
  }

  async resolveMergeBase(target: LocalGitTarget, baseBranch: string): Promise<LocalGitMergeBase> {
    const { repository } = await this.resolveTrustedRepository(target)
    const mergeBase = (
      await runCachedGitRead(
        repository,
        'merge-base',
        [baseBranch],
        ['merge-base', baseBranch, 'HEAD'],
        {},
        { staleTime: Infinity, metadata: { gitReadInvalidation: ['head', 'remote-refs'] } }
      )
    ).stdout.trim()
    if (!/^[a-f0-9]{7,64}$/iu.test(mergeBase)) {
      throw new Error('Unable to resolve a merge base for the selected branch')
    }
    return { baseBranch, mergeBase }
  }

  async getFileDiff(input: {
    target: LocalGitTarget
    source: LocalGitReviewSnapshot['source']
    snapshotGeneration: string
    file: { path: string; previousPath?: string; revision: string }
  }): Promise<{
    snapshotGeneration: string
    file: LocalGitReviewFile
    diff: string
    truncated: boolean
    binary: boolean
    conflicted: boolean
  }> {
    const { repository } = await this.resolveTrustedRepository(input.target)
    const gitRoot = repository.root
    const record = this.snapshots.get(input.snapshotGeneration)
    const reviewGeneration = this.reviewGenerations.get(input.snapshotGeneration)
    const file = record?.files.get(input.file.path)
    if (
      !record ||
      record.gitRoot !== gitRoot ||
      !reviewGeneration ||
      reviewGeneration.hostId !== repository.host.id ||
      !sameReviewSource(record.source, input.source) ||
      !file ||
      file.revision !== input.file.revision
    ) {
      throw new Error('stale-snapshot')
    }
    const snapshot = repository.requireReviewSnapshot(reviewGeneration.generation)
    const { currentRevision, diff } = await snapshot.read(async () => ({
      currentRevision: await computeFileRevision({
        gitRoot: repository,
        source: input.source,
        path: input.file.path
      }),
      diff: await getDiffForSource({
        gitRoot: repository,
        source: input.source,
        path: input.file.path
      })
    }))
    if (currentRevision !== input.file.revision) throw new Error('stale-snapshot')
    const truncated = diff.length > LOCAL_GIT_PATCH_MAX_CHARACTERS
    return {
      snapshotGeneration: input.snapshotGeneration,
      file,
      diff: truncated ? diff.slice(0, LOCAL_GIT_PATCH_MAX_CHARACTERS) : diff,
      truncated,
      binary: file.binary,
      conflicted: file.conflicted
    }
  }

  async mutateReview(input: LocalGitReviewMutationRequest): Promise<LocalGitMutationResult> {
    if (!reviewMutationIsAllowed(input.source.type, input.action)) {
      return unsupportedReviewMutationResult()
    }
    const { repository } = await this.resolveTrustedRepository(input.target)
    const gitRoot = repository.root
    const record = this.snapshots.get(input.snapshotGeneration)
    const reviewGeneration = this.reviewGenerations.get(input.snapshotGeneration)
    if (
      !record ||
      record.gitRoot !== gitRoot ||
      !reviewGeneration ||
      reviewGeneration.hostId !== repository.host.id ||
      !sameReviewSource(record.source, input.source)
    ) {
      return staleSnapshotResult()
    }
    try {
      repository.requireReviewSnapshot(reviewGeneration.generation)
    } catch {
      return staleSnapshotResult()
    }
    if (!hasExactSnapshotTargets(record, input)) return staleSnapshotResult()
    // A review snapshot can reuse its reads while it is rendered, but a write
    // must compare against the filesystem again immediately before applying.
    repository.clearShortLivedGitReadCaches()
    for (const file of input.files) {
      assertSafeRepoRelativePath(file.path)
      const currentRevision = await computeFileRevision({
        gitRoot: repository,
        source: input.source,
        path: file.path
      })
      if (currentRevision !== file.revision) return staleSnapshotResult()
    }

    const patch = await this.patchForMutation(repository, input)
    if (!patch) return emptyTurnPatchError('patch-too-large')
    const affectedPaths = validateGitPatch(patch).map((entry) => entry.path)
    if (affectedPaths.length === 0) {
      return { status: 'success', appliedPaths: [], skippedPaths: [], conflictedPaths: [] }
    }

    if (input.action === 'stage') {
      return this.applyReviewPatch(repository, { patch, cached: true })
    }
    if (input.action === 'unstage') {
      return this.applyReviewPatch(repository, { patch, reverse: true, cached: true })
    }

    if (input.source.type === 'staged' || input.patchTarget === 'staged-and-unstaged') {
      const indexResult = await applyGitPatch({
        repository,
        patch,
        reverse: true,
        cached: true
      })
      if (indexResult.status !== 'success') return indexResult
      const worktreeResult = await applyGitPatch({ repository, patch, reverse: true })
      if (worktreeResult.status === 'success') {
        repository.invalidateGitReadCachesForMutation()
        repository.invalidateUntrackedPathsCache()
        return worktreeResult
      }
      repository.invalidateGitReadCachesForMutation()
      repository.invalidateUntrackedPathsCache()
      return {
        status: 'partial-success',
        errorCode: worktreeResult.errorCode,
        appliedPaths: indexResult.appliedPaths,
        skippedPaths: [],
        conflictedPaths: worktreeResult.conflictedPaths
      }
    }

    return this.applyReviewPatch(repository, { patch, reverse: true })
  }

  async applyTurnPatch(input: TurnPatchRequest): Promise<LocalGitMutationResult> {
    if (input.batches.length > LOCAL_GIT_TURN_PATCH_MAX_BATCHES) {
      return emptyTurnPatchError('too-many-patch-batches')
    }
    if (input.batches.some((batch) => turnPatchBatchBytes(batch) > maxTurnPatchBytes)) {
      return emptyTurnPatchError('patch-too-large')
    }
    if (
      input.batches.reduce((total, batch) => total + turnPatchBatchBytes(batch), 0) >
      maxTurnPatchBytes
    ) {
      return emptyTurnPatchError('patch-too-large')
    }

    const { repository } = await this.resolveTrustedRepository(input.target)
    const validatedBatches = await Promise.all(
      input.batches.map(async (batch) => {
        validateGitPatch(batch.diff)
        const target = await this.resolveTrustedTurnRepository(repository, batch.cwd, batch.gitRoot)
        return { ...target, diff: batch.diff }
      })
    )
    const orderedBatches =
      input.action === 'undo' ? [...validatedBatches].reverse() : validatedBatches
    const aggregate: LocalGitMutationResult = {
      status: 'success',
      appliedPaths: [],
      skippedPaths: [],
      conflictedPaths: []
    }

    for (const batch of orderedBatches) {
      const result = await applyGitPatch({
        repository: batch.repository,
        cwd: batch.cwd,
        directory: batch.directory,
        patch: batch.diff,
        reverse: input.action === 'undo'
      })
      if (result.status === 'success') {
        batch.repository.invalidateGitReadCachesForMutation()
        batch.repository.invalidateUntrackedPathsCache()
      }
      aggregate.appliedPaths.push(...result.appliedPaths)
      aggregate.skippedPaths.push(...result.skippedPaths)
      aggregate.conflictedPaths.push(...result.conflictedPaths)
      if (result.status !== 'success')
        return { ...aggregate, status: result.status, errorCode: result.errorCode }
    }

    return aggregate
  }

  async getWatchState(target: LocalGitTarget): Promise<LocalGitWatchState> {
    const { repository } = await this.resolveTrustedRepository(target)
    const gitRoot = repository.root
    const [
      config,
      head,
      index,
      remoteRefs,
      syncedBranch,
      worktreeTopology,
      worktreeDiff,
      status,
      stateHash
    ] = await Promise.all([
      readWatchOutput(repository, ['config', '--local', '--list', '--show-origin']),
      readWatchOutput(repository, ['rev-parse', 'HEAD']),
      readWatchOutput(repository, ['diff', '--cached', '--raw', '-z']),
      readWatchOutput(repository, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)',
        'refs/remotes'
      ]),
      readWatchOutput(repository, ['status', '--branch', '--porcelain=v1', '-z']),
      readWatchOutput(repository, ['worktree', 'list', '--porcelain']),
      readWatchOutput(repository, ['diff', '--raw', '-z']),
      readWatchOutput(repository, ['status', '--porcelain=v1', '-z']),
      computeWorkspaceStateHash(repository)
    ])
    const snapshotGeneration = randomUUID()
    this.snapshots.rememberState(snapshotGeneration, gitRoot, stateHash)
    return {
      snapshotGeneration,
      fingerprint: {
        config: sha256(config),
        head: head.trim(),
        index: sha256(index),
        remoteRefs: sha256(remoteRefs),
        syncedBranch: sha256(syncedBranch),
        worktreeTopology: sha256(worktreeTopology),
        worktree: sha256([worktreeDiff, status].join('\0'))
      },
      workingTreePaths: pathsFromPorcelain(status)
    }
  }

  async resolveTrustedGitRoot(target: LocalGitTarget): Promise<string> {
    return (await this.resolveTrustedRepository(target)).repository.root
  }

  resolveTrustedRepository(target: LocalGitTarget): Promise<ResolvedGitRepository> {
    return this.targetResolver.assertRepository(target)
  }

  private async patchForMutation(
    repository: WorktreeRepository,
    input: LocalGitReviewMutationRequest
  ): Promise<string | undefined> {
    if (input.source.type === 'last-turn') {
      throw new Error('last-turn review mutations must use turn patch actions')
    }
    const patches: string[] = []
    let patchBytes = 0
    for (const file of input.files) {
      const sourcePatch = await getDiffForSource({
        gitRoot: repository,
        source: input.source,
        path: file.path
      })
      const patch =
        input.scope === 'section' || input.scope === 'file'
          ? extractFilePatch(sourcePatch, file.path)
          : extractHunkPatch(sourcePatch, file.path, input.hunkIndex ?? 0)
      patchBytes += Buffer.byteLength(patch)
      if (patchBytes > maxTurnPatchBytes) return undefined
      patches.push(patch)
    }
    return patches.join('\n')
  }

  private async resolveTrustedTurnRepository(
    repository: WorktreeRepository,
    cwd: string,
    assertedGitRoot?: string
  ): Promise<{ repository: WorktreeRepository; cwd: string; directory?: string }> {
    if (!isAbsolutePath(repository, cwd) || !isSameOrInside(repository, cwd, repository.root)) {
      throw new Error('turn patch cwd must stay inside the trusted repository')
    }
    if (assertedGitRoot && !samePath(repository, assertedGitRoot, repository.root)) {
      throw new Error('turn patch git root does not match trusted repository')
    }
    const gitRoot = await repository.host.runGit(['rev-parse', '--show-toplevel'], cwd)
    if (!gitRoot.success || !samePath(repository, gitRoot.stdout.trim(), repository.root)) {
      throw new Error('turn patch cwd git root does not match trusted repository')
    }
    const directory = repositoryRelativePath(repository, cwd)
    return { repository, cwd, ...(directory ? { directory } : {}) }
  }

  private async applyReviewPatch(
    repository: WorktreeRepository,
    options: { patch: string; reverse?: boolean; cached?: boolean }
  ): Promise<LocalGitMutationResult> {
    const result = await applyGitPatch({ repository, ...options })
    if (result.status === 'success' || result.status === 'partial-success') {
      repository.invalidateGitReadCachesForMutation()
      repository.invalidateUntrackedPathsCache()
    }
    return result
  }
}

function mergeRefreshedReviewFiles(
  previousFiles: ReadonlyMap<string, LocalGitReviewFile>,
  refreshedPaths: readonly string[],
  refreshedFiles: readonly LocalGitReviewFile[]
): LocalGitReviewFile[] {
  const paths = new Set(refreshedPaths)
  const nextFiles = new Map(previousFiles)
  for (const [path, file] of nextFiles) {
    if (paths.has(path) || (file.previousPath !== undefined && paths.has(file.previousPath))) {
      nextFiles.delete(path)
    }
  }
  for (const file of refreshedFiles) {
    if (file.previousPath !== undefined) nextFiles.delete(file.previousPath)
    nextFiles.set(file.path, file)
  }
  return [...nextFiles.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function sameReviewSource(
  left: LocalGitReviewSnapshot['source'],
  right: LocalGitReviewSnapshot['source']
): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'commit' && right.type === 'commit') {
    return left.commitSha === right.commitSha
  }
  if (left.type === 'branch' && right.type === 'branch') {
    return left.baseBranch === right.baseBranch
  }
  if (left.type === 'last-turn' && right.type === 'last-turn') {
    return left.turnId === right.turnId
  }
  return true
}

async function countLines(
  repository: WorktreeRepository,
  cacheType: string,
  args: string[]
): Promise<number> {
  const output = (
    await runCachedGitRead(
      repository,
      cacheType,
      [],
      args,
      {},
      {
        staleTime: 10_000,
        metadata: { gitReadInvalidation: 'short-lived' }
      }
    )
  ).stdout.trim()
  return output ? output.split(/\r?\n/u).length : 0
}

async function countUntracked(repository: WorktreeRepository): Promise<number> {
  return (await repository.listUntrackedPaths()).length
}

async function combinedNumstat(
  repository: WorktreeRepository
): Promise<{ additions: number; deletions: number }> {
  const trackedOutputs = await Promise.all([
    runCachedGitRead(
      repository,
      'summary-numstat',
      ['unstaged'],
      ['diff', '--numstat'],
      {},
      {
        staleTime: 10_000,
        metadata: { gitReadInvalidation: 'short-lived' }
      }
    ).then((result) => result.stdout),
    runCachedGitRead(
      repository,
      'summary-numstat',
      ['staged'],
      ['diff', '--cached', '--numstat'],
      {},
      {
        staleTime: 10_000,
        metadata: { gitReadInvalidation: 'short-lived' }
      }
    ).then((result) => result.stdout)
  ])
  const untrackedPaths = await repository.listUntrackedPaths()
  const untrackedOutputs = await Promise.all(
    untrackedPaths.map((path) => untrackedNumstat(repository, path))
  )
  let additions = 0
  let deletions = 0
  for (const line of [...trackedOutputs, ...untrackedOutputs].join('\n').split(/\r?\n/u)) {
    const [added, deleted] = line.split(/\s+/u)
    if (!added || !deleted || added === '-' || deleted === '-') continue
    additions += Number(added)
    deletions += Number(deleted)
  }
  return { additions, deletions }
}

async function untrackedNumstat(repository: WorktreeRepository, path: string): Promise<string> {
  try {
    return (
      await runCachedGitRead(
        repository,
        'summary-untracked-numstat',
        [path],
        ['diff', '--no-index', '--numstat', '/dev/null', path],
        {},
        {
          staleTime: 10_000,
          metadata: { gitReadInvalidation: 'short-lived', gitReadPaths: [path] }
        }
      )
    ).stdout
  } catch (error) {
    if (isGitCliError(error) && error.exitCode === 1) return error.stdout
    throw error
  }
}

function isSameOrInside(repository: WorktreeRepository, candidate: string, root: string): boolean {
  const path = repositoryPathModule(repository)
  const relativePath = path
    ? path.relative(path.resolve(root), path.resolve(candidate))
    : relative(resolve(root), resolve(candidate))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') &&
      !relativePath.startsWith('/') &&
      !relativePath.startsWith('\\'))
  )
}

function samePath(repository: WorktreeRepository, left: string, right: string): boolean {
  const path = repositoryPathModule(repository)
  const normalizedLeft = path ? path.resolve(left) : resolve(left)
  const normalizedRight = path ? path.resolve(right) : resolve(right)
  return repository.host.platformFamily === 'windows'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isAbsolutePath(repository: WorktreeRepository, value: string): boolean {
  const path = repositoryPathModule(repository)
  return path ? path.isAbsolute(value) : value.startsWith('/')
}

function repositoryRelativePath(repository: WorktreeRepository, cwd: string): string {
  const path = repositoryPathModule(repository)
  const value = path
    ? path.relative(path.resolve(repository.root), path.resolve(cwd))
    : relative(resolve(repository.root), resolve(cwd))
  return value.replaceAll('\\', '/')
}

function turnPatchBatchBytes(batch: TurnPatchRequest['batches'][number]): number {
  return (
    Buffer.byteLength(batch.cwd) +
    Buffer.byteLength(batch.gitRoot ?? '') +
    Buffer.byteLength(batch.diff)
  )
}

function emptyTurnPatchError(errorCode: string): LocalGitMutationResult {
  return {
    status: 'error',
    errorCode,
    appliedPaths: [],
    skippedPaths: [],
    conflictedPaths: []
  }
}

function repositoryPathModule(repository: WorktreeRepository): typeof win32 | typeof posix | null {
  if (repository.host.platformFamily === 'windows') return win32
  if (!repository.host.isLocal) return posix
  return null
}

async function readWatchOutput(
  repository: WorktreeRepository,
  args: readonly string[]
): Promise<string> {
  try {
    return (await runGit(repository, args)).stdout
  } catch {
    // Some repositories have no HEAD, upstream, or remotes. A missing optional
    // fingerprint is still a stable observable state for the watcher.
    return ''
  }
}

function pathsFromPorcelain(output: string): string[] {
  const fields = output.split('\0').filter(Boolean)
  const paths = new Set<string>()
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]
    const path = entry.slice(3)
    if (path) paths.add(path)
    // A rename/copy has an additional NUL-separated old path. Record its
    // parent too, so a directory-scoped cached read is invalidated correctly.
    if ((entry.startsWith('R') || entry.startsWith('C')) && fields[index + 1]) {
      paths.add(fields[index + 1])
      index += 1
    }
  }
  return [...paths]
}

function staleSnapshotResult(): LocalGitMutationResult {
  return {
    status: 'error',
    errorCode: 'stale-snapshot',
    appliedPaths: [],
    skippedPaths: [],
    conflictedPaths: []
  }
}

function hasExactSnapshotTargets(
  record: SnapshotGenerationRecord,
  input: LocalGitReviewMutationRequest
): boolean {
  if (input.scope === 'section') {
    if (input.files.length !== record.files.size) return false
  } else if (input.files.length !== 1) {
    return false
  }

  if (input.scope === 'hunk' ? input.hunkIndex === undefined : input.hunkIndex !== undefined) {
    return false
  }

  const requestedPaths = new Set<string>()
  for (const target of input.files) {
    if (requestedPaths.has(target.path)) return false
    requestedPaths.add(target.path)

    const signedFile = record.files.get(target.path)
    if (
      !signedFile ||
      signedFile.previousPath !== target.previousPath ||
      signedFile.revision !== target.revision
    ) {
      return false
    }
  }

  return input.scope !== 'section' || requestedPaths.size === record.files.size
}

function reviewMutationIsAllowed(
  sourceType: LocalGitReviewMutationRequest['source']['type'],
  action: LocalGitReviewMutationRequest['action']
): boolean {
  if (sourceType === 'unstaged') return action === 'stage' || action === 'revert'
  if (sourceType === 'staged') return action === 'unstage' || action === 'revert'
  return false
}

function unsupportedReviewMutationResult(): LocalGitMutationResult {
  return {
    status: 'error',
    errorCode: 'unsupported-review-source-action',
    appliedPaths: [],
    skippedPaths: [],
    conflictedPaths: []
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
