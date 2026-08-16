import { createHash, randomUUID } from 'node:crypto'

import {
  createGitDiffArgs,
  gitDiffOutputLimitBytes,
  isGitCliError,
  isGitOutputLimitError,
  runCachedGitRead,
  runGit,
  type GitCliOptions,
  type GitCliResult
} from './gitCli'
import type { WorktreeRepository } from './GitManager'
import type {
  LocalGitChangeKind,
  LocalGitReviewFile,
  LocalGitReviewSnapshot,
  LocalGitReviewSource
} from './types'

export type SnapshotGenerationRecord = {
  gitRoot: string
  hostId?: string
  reviewGeneration?: number
  source: LocalGitReviewSource
  fileRevisions: Map<string, string>
  files: Map<string, LocalGitReviewFile>
  stagedFileCount: number
  unstagedFileCount: number
  largeDiff: boolean
  stateHash: string
}

export type SnapshotGenerationStore = {
  remember(snapshot: LocalGitReviewSnapshot, stateHash: string): void
  rememberState(snapshotGeneration: string, gitRoot: string, stateHash: string): void
  get(snapshotGeneration: string): SnapshotGenerationRecord | undefined
}

export class InMemorySnapshotGenerationStore implements SnapshotGenerationStore {
  private readonly records = new Map<string, SnapshotGenerationRecord>()

  remember(snapshot: LocalGitReviewSnapshot, stateHash: string): void {
    this.records.set(snapshot.snapshotGeneration, {
      gitRoot: snapshot.gitRoot,
      source: snapshot.source,
      stateHash,
      fileRevisions: new Map(snapshot.files.map((file) => [file.path, file.revision])),
      files: new Map(snapshot.files.map((file) => [file.path, file])),
      stagedFileCount: snapshot.stagedFileCount,
      unstagedFileCount: snapshot.unstagedFileCount,
      largeDiff: snapshot.largeDiff
    })
  }

  rememberState(snapshotGeneration: string, gitRoot: string, stateHash: string): void {
    this.records.set(snapshotGeneration, {
      gitRoot,
      source: { type: 'unstaged' },
      stateHash,
      fileRevisions: new Map(),
      files: new Map(),
      stagedFileCount: 0,
      unstagedFileCount: 0,
      largeDiff: false
    })
  }

  get(snapshotGeneration: string): SnapshotGenerationRecord | undefined {
    return this.records.get(snapshotGeneration)
  }
}

export async function createReviewSnapshot({
  repository,
  gitRoot: legacyGitRoot,
  source,
  maxPatchBytes = 2 * 1024 * 1024
}: {
  repository?: GitExecutionTarget
  gitRoot?: GitExecutionTarget
  source: LocalGitReviewSource
  maxPatchBytes?: number
}): Promise<{ snapshot: LocalGitReviewSnapshot; stateHash: string }> {
  const executionTarget = repository ?? legacyGitRoot
  if (!executionTarget) throw new Error('Git repository is required')
  const gitRoot = rootOf(executionTarget)
  const patchSizePromise = diffSize(executionTarget, source, maxPatchBytes)
  const [files, stagedFileCount, unstagedFileCount, stateHash, patchSize] = await Promise.all([
    listReviewFiles(executionTarget, source),
    countChangedFiles(executionTarget, ['diff', '--cached', '--name-only']),
    countUnstagedFiles(executionTarget),
    computeWorkspaceStateHash(executionTarget),
    patchSizePromise
  ])
  const snapshot: LocalGitReviewSnapshot = {
    snapshotGeneration: randomUUID(),
    gitRoot,
    source,
    files,
    stagedFileCount,
    unstagedFileCount,
    largeDiff: patchSize > maxPatchBytes
  }

  return { snapshot, stateHash }
}

export async function computeWorkspaceStateHash(gitRoot: GitExecutionTarget): Promise<string> {
  const compute = async (): Promise<string> => {
    const [untracked, unstaged, staged, head] = await Promise.all([
      listUntrackedPaths(gitRoot).then((paths) => paths.join('\0')),
      runGit(gitRoot, ['diff', '--raw', '-z']),
      runGit(gitRoot, ['diff', '--cached', '--raw', '-z']),
      runGit(gitRoot, ['rev-parse', 'HEAD']).catch(() => ({ stdout: '', stderr: '' }))
    ])
    return sha256([untracked, unstaged.stdout, staged.stdout, head.stdout].join('\0'))
  }

  if (typeof gitRoot === 'string') return compute()
  return gitRoot.readCached('workspace-state-hash', [], compute, {
    staleTime: 10_000,
    metadata: { gitReadInvalidation: 'short-lived' }
  })
}

export async function computeFileRevision({
  gitRoot,
  source,
  path
}: {
  gitRoot: GitExecutionTarget
  source: LocalGitReviewSource
  path: string
}): Promise<string> {
  const [inputs, untracked] = await Promise.all([
    computeTrackedFileRevisionInputs({
      gitRoot,
      source,
      paths: [path],
      worktreeHashPaths: source.type === 'unstaged' ? [path] : []
    }),
    source.type === 'unstaged' ? isUntrackedPath(gitRoot, path) : false
  ])
  const input = inputs.get(path) ?? emptyRevisionPathInput()
  return revisionFromPathInput(source, path, untracked ? { ...input, status: 'untracked' } : input)
}

export async function getDiffForSource({
  gitRoot,
  source,
  path,
  options
}: {
  gitRoot: GitExecutionTarget
  source: LocalGitReviewSource
  path?: string
  options?: { ignoreWhitespace: boolean; fullFiles: boolean }
}): Promise<string> {
  const displayArgs = reviewDiffDisplayArgs(options)
  const pathArgs = path ? ['--', path] : []
  const diffArgs = diffArgsForSource(source, ['--binary', ...displayArgs, ...pathArgs])
  const trackedDiff = (
    await runSourceDiff(
      gitRoot,
      'diff',
      [JSON.stringify(source), path ?? 'all', ...displayArgs],
      diffArgs,
      path ? [path] : undefined
    )
  ).stdout
  if (source.type !== 'unstaged') return trackedDiff

  const untrackedPaths = path ? [path] : await listUntrackedPaths(gitRoot)
  const untrackedDiffs = await Promise.all(
    untrackedPaths.map(async (untrackedPath) => {
      if (!(await isUntrackedPath(gitRoot, untrackedPath))) return ''
      return untrackedDiff(gitRoot, untrackedPath, ['--binary', ...displayArgs])
    })
  )
  return [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n')
}

function reviewDiffDisplayArgs(
  options: { ignoreWhitespace: boolean; fullFiles: boolean } | undefined
): string[] {
  if (!options) return []
  return [
    ...(options.ignoreWhitespace ? ['--ignore-all-space'] : []),
    ...(options.fullFiles ? ['--unified=2147483647'] : [])
  ]
}

export async function getSearchDiffForSource({
  gitRoot,
  source
}: {
  gitRoot: GitExecutionTarget
  source: LocalGitReviewSource
}): Promise<string> {
  if (source.type === 'last-turn') return ''
  const trackedDiff = (
    await runSourceDiff(
      gitRoot,
      'search-diff',
      [JSON.stringify(source)],
      diffArgsForSource(source, ['--unified=3'])
    )
  ).stdout
  if (source.type !== 'unstaged') return trackedDiff

  const untrackedDiffs = await Promise.all(
    (await listUntrackedPaths(gitRoot)).map((untrackedPath) =>
      untrackedDiff(gitRoot, untrackedPath, ['--unified=3'])
    )
  )
  return [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n')
}

function diffArgsForSource(source: LocalGitReviewSource, suffix: string[] = []): string[] {
  // Copy detection needs --find-copies-harder because an unmodified source file is
  // otherwise not considered as a copy candidate. This preserves the source path
  // needed by review actions and the file-tree status label.
  const renameAndCopyDetection = ['--find-renames', '--find-copies-harder']
  switch (source.type) {
    case 'unstaged':
      return ['diff', ...renameAndCopyDetection, ...suffix]
    case 'staged':
      return ['diff', '--cached', ...renameAndCopyDetection, ...suffix]
    case 'commit':
      return [
        'show',
        '--format=',
        '--no-ext-diff',
        ...renameAndCopyDetection,
        source.commitSha,
        ...suffix
      ]
    case 'branch':
      return ['diff', ...renameAndCopyDetection, `${source.baseBranch}...HEAD`, ...suffix]
    case 'last-turn':
      throw new Error('last-turn source requires explicit turn patch data')
  }
}

export async function listReviewFiles(
  gitRoot: GitExecutionTarget,
  source: LocalGitReviewSource,
  paths?: readonly string[]
): Promise<LocalGitReviewFile[]> {
  if (source.type === 'last-turn') return []
  const requestedPaths = paths ? new Set(paths) : undefined
  const pathArgs = paths && gitPathspecFitsArguments(paths) ? ['--', ...paths] : []
  const metadata = await runSourceDiff(
    gitRoot,
    'metadata',
    [JSON.stringify(source), ...pathArgs],
    diffArgsForSource(source, ['--raw', '--numstat', '-z', ...pathArgs]),
    pathArgs.length > 0 ? paths : undefined
  )
  const stats = parseNumstat(metadata.stdout)
  const statusEntries = parseRawEntries(metadata.stdout).filter(
    (entry) => requestedPaths === undefined || requestedPaths.has(entry.path)
  )
  const trackedRevisionInputs = await computeTrackedFileRevisionInputs({
    gitRoot,
    source,
    paths: statusEntries.map((entry) => entry.path),
    rawByPath: new Map(statusEntries.map((entry) => [entry.path, entry.raw])),
    worktreeHashPaths:
      source.type === 'unstaged'
        ? statusEntries.filter((entry) => entry.changeKind !== 'deleted').map((entry) => entry.path)
        : []
  })

  const trackedFiles = statusEntries.map((entry) => {
    const stat = stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false }
    return {
      path: entry.path,
      previousPath: entry.previousPath,
      changeKind: entry.changeKind,
      revision: revisionFromPathInput(
        source,
        entry.path,
        trackedRevisionInputs.get(entry.path) ?? emptyRevisionPathInput()
      ),
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary,
      conflicted: entry.changeKind === 'unmerged'
    }
  })
  if (source.type !== 'unstaged') return trackedFiles

  const untrackedPaths = (await listUntrackedPaths(gitRoot)).filter(
    (path) => requestedPaths === undefined || requestedPaths.has(path)
  )
  const untrackedRevisionInputs = await computeUntrackedRevisionInputs(gitRoot, untrackedPaths)
  const untrackedFiles = await Promise.all(
    untrackedPaths.map(async (path) => {
      const stat = parseNumstat(await untrackedDiff(gitRoot, path, ['--numstat', '-z'])).get(
        path
      ) ?? {
        additions: 0,
        deletions: 0,
        binary: false
      }
      return {
        path,
        changeKind: 'added' as const,
        revision: revisionFromPathInput(
          source,
          path,
          untrackedRevisionInputs.get(path) ?? emptyRevisionPathInput()
        ),
        additions: stat.additions,
        deletions: stat.deletions,
        binary: stat.binary,
        conflicted: false
      }
    })
  )
  return [...trackedFiles, ...untrackedFiles]
}

async function countChangedFiles(gitRoot: GitExecutionTarget, args: string[]): Promise<number> {
  const output = (await runReviewRead(gitRoot, 'changed-file-count', args, args)).stdout.trim()
  return output ? output.split(/\r?\n/u).length : 0
}

async function countUnstagedFiles(gitRoot: GitExecutionTarget): Promise<number> {
  const [tracked, untracked] = await Promise.all([
    countChangedFiles(gitRoot, ['diff', '--name-only']),
    listUntrackedPaths(gitRoot)
  ])
  return tracked + untracked.length
}

async function diffSize(
  gitRoot: GitExecutionTarget,
  source: LocalGitReviewSource,
  maxPatchBytes: number
): Promise<number> {
  if (source.type === 'last-turn') return 0
  const limit = maxPatchBytes + 1
  const trackedSize = await boundedTrackedDiffSize(gitRoot, source, limit)
  if (trackedSize > maxPatchBytes || source.type !== 'unstaged') return trackedSize

  let size = trackedSize
  for (const path of await listUntrackedPaths(gitRoot)) {
    size += await boundedUntrackedDiffSize(gitRoot, path, Math.max(1, limit - size))
    if (size > maxPatchBytes) return size
  }
  return size
}

async function boundedTrackedDiffSize(
  gitRoot: GitExecutionTarget,
  source: LocalGitReviewSource,
  limit: number
): Promise<number> {
  try {
    const diff = await runSourceDiff(
      gitRoot,
      'diff-size',
      [JSON.stringify(source), String(limit)],
      diffArgsForSource(source, ['--binary']),
      undefined,
      { maxOutputBytes: limit }
    )
    return Buffer.byteLength(diff.stdout)
  } catch (error) {
    if (isOutputLimitError(error)) return limit
    throw error
  }
}

async function boundedUntrackedDiffSize(
  gitRoot: GitExecutionTarget,
  path: string,
  limit: number
): Promise<number> {
  try {
    const diff = await untrackedDiff(gitRoot, path, ['--binary'], { maxOutputBytes: limit })
    return Buffer.byteLength(diff)
  } catch (error) {
    if (isOutputLimitError(error)) return limit
    throw error
  }
}

type RevisionPathInput = {
  raw: string
  status: string
  worktreeHash: string
}

async function computeTrackedFileRevisionInputs({
  gitRoot,
  source,
  paths,
  rawByPath,
  worktreeHashPaths
}: {
  gitRoot: GitExecutionTarget
  source: LocalGitReviewSource
  paths: readonly string[]
  rawByPath?: ReadonlyMap<string, string>
  worktreeHashPaths: readonly string[]
}): Promise<Map<string, RevisionPathInput>> {
  const inputs = createRevisionInputMap(paths)
  if (paths.length === 0) return inputs
  const [raw, worktreeHashes] = await Promise.all([
    rawByPath
      ? Promise.resolve(rawByPath)
      : runSourceDiffFresh(gitRoot, diffArgsForSource(source, ['--raw', '-z', '--', ...paths]))
          .then((result) => parseRawByPath(result.stdout))
          .catch(() => new Map<string, string>()),
    hashObjectByPath(gitRoot, worktreeHashPaths)
  ])

  mergeRevisionField(inputs, raw, 'raw')
  mergeRevisionField(inputs, worktreeHashes, 'worktreeHash')
  return inputs
}

async function computeUntrackedRevisionInputs(
  gitRoot: GitExecutionTarget,
  paths: readonly string[]
): Promise<Map<string, RevisionPathInput>> {
  const inputs = createRevisionInputMap(paths)
  mergeRevisionField(inputs, await hashObjectByPath(gitRoot, paths), 'worktreeHash')
  mergeRevisionField(inputs, new Map(paths.map((path) => [path, 'untracked'])), 'status')
  return inputs
}

function createRevisionInputMap(paths: readonly string[]): Map<string, RevisionPathInput> {
  return new Map(paths.map((path) => [path, emptyRevisionPathInput()]))
}

function emptyRevisionPathInput(): RevisionPathInput {
  return { raw: '', status: '', worktreeHash: '' }
}

function mergeRevisionField(
  inputs: Map<string, RevisionPathInput>,
  values: ReadonlyMap<string, string>,
  field: keyof RevisionPathInput
): void {
  for (const [path, value] of values) {
    inputs.set(path, { ...(inputs.get(path) ?? emptyRevisionPathInput()), [field]: value })
  }
}

async function hashObjectByPath(
  gitRoot: GitExecutionTarget,
  paths: readonly string[]
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const stdinPaths = paths.filter((path) => !path.includes('\n'))
  const newlinePaths = paths.filter((path) => path.includes('\n'))
  const output =
    stdinPaths.length === 0
      ? { stdout: '', stderr: '' }
      : await runReviewReadFresh(gitRoot, ['hash-object', '--stdin-paths'], {
          input: `${stdinPaths.join('\n')}\n`
        }).catch(() => ({ stdout: '', stderr: '' }))
  const hashes = output.stdout.split(/\r?\n/u).filter(Boolean)
  const result = new Map(stdinPaths.map((path, index) => [path, hashes[index] ?? '']))
  await Promise.all(
    newlinePaths.map(async (path) => {
      const hash = await runReviewReadFresh(gitRoot, ['hash-object', '--', path])
        .then((entry) => entry.stdout.trim())
        .catch(() => '')
      result.set(path, hash)
    })
  )
  return result
}

function parseRawByPath(output: string): Map<string, string> {
  return new Map(parseRawEntries(output).map((entry) => [entry.path, entry.raw]))
}

function parseRawEntries(output: string): Array<{
  path: string
  previousPath?: string
  changeKind: LocalGitChangeKind
  raw: string
}> {
  const values = output.split('\0').filter(Boolean)
  const entries: Array<{
    path: string
    previousPath?: string
    changeKind: LocalGitChangeKind
    raw: string
  }> = []
  for (let index = 0; index < values.length; index += 1) {
    const header = values[index]
    const match = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([A-Z])(?:\d+)?$/u.exec(header)
    const code = match?.[1]
    if (!code) continue
    if (code === 'R' || code === 'C') {
      const previousPath = values[index + 1]
      const path = values[index + 2]
      index += 2
      if (!previousPath || !path) continue
      entries.push({
        path,
        previousPath,
        changeKind: code === 'R' ? 'renamed' : 'copied',
        raw: `${header}\0${previousPath}\0${path}`
      })
      continue
    }
    const path = values[index + 1]
    index += 1
    if (!path) continue
    entries.push({ path, changeKind: changeKindFromStatus(code), raw: `${header}\0${path}` })
  }
  return entries
}

function revisionFromPathInput(
  source: LocalGitReviewSource,
  path: string,
  input: RevisionPathInput
): string {
  return sha256(
    `${JSON.stringify(source)}\0${path}\0${input.raw}\0${input.status}\0${input.worktreeHash}`
  )
}

function parseNumstat(
  output: string
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const values = output.split('\0').filter(Boolean)
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (let index = 0; index < values.length; index += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/su.exec(values[index])
    if (!match) continue
    const [, additionsText, deletionsText, pathMarker] = match
    const path = pathMarker === '' ? values[index + 2] : pathMarker
    if (pathMarker === '') index += 2
    if (!path) continue
    stats.set(path, {
      additions: additionsText === '-' ? 0 : Number(additionsText),
      deletions: deletionsText === '-' ? 0 : Number(deletionsText),
      binary: additionsText === '-' || deletionsText === '-'
    })
  }
  return stats
}

function gitPathspecFitsArguments(paths: readonly string[]): boolean {
  const windowsSafeCommandBytes = 16 * 1024
  return (
    paths.reduce((total, path) => total + Buffer.byteLength(path) + 1, 0) <= windowsSafeCommandBytes
  )
}

function changeKindFromStatus(code: string | undefined): LocalGitChangeKind {
  switch (code) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'T':
      return 'type-change'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

async function listUntrackedPaths(gitRoot: GitExecutionTarget): Promise<string[]> {
  if (typeof gitRoot !== 'string') return [...(await gitRoot.listUntrackedPaths())]
  const output = (await runGit(gitRoot, ['ls-files', '--others', '--exclude-standard', '-z']))
    .stdout
  return output.split('\0').filter(Boolean)
}

async function isUntrackedPath(gitRoot: GitExecutionTarget, path: string): Promise<boolean> {
  return (await listUntrackedPaths(gitRoot)).includes(path)
}

async function untrackedDiff(
  gitRoot: GitExecutionTarget,
  path: string,
  options: readonly string[],
  gitOptions?: GitCliOptions
): Promise<string> {
  try {
    return (
      await runReviewDiff(
        gitRoot,
        'untracked-diff',
        [path, ...options],
        ['--no-index', ...options, '/dev/null', path],
        [path],
        gitOptions
      )
    ).stdout
  } catch (error) {
    if (isGitCliError(error) && error.exitCode === 1) return error.stdout
    throw error
  }
}

type GitExecutionTarget = string | WorktreeRepository

function runReviewRead(
  target: GitExecutionTarget,
  type: string,
  parts: readonly string[],
  args: readonly string[],
  paths?: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  if (typeof target === 'string') return runGit(target, args, options)
  return runCachedGitRead(
    target,
    type,
    ['review', String(target.reviewSnapshot.generation), ...parts],
    args,
    options,
    {
      staleTime: Infinity,
      metadata: { gitReadInvalidation: 'short-lived', ...(paths ? { gitReadPaths: paths } : {}) }
    }
  )
}

function runReviewDiff(
  target: GitExecutionTarget,
  type: string,
  parts: readonly string[],
  args: readonly string[],
  paths?: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  const diffArgs = args[0] === 'diff' ? args.slice(1) : args
  return runReviewRead(target, type, parts, createGitDiffArgs(diffArgs), paths, {
    ...options,
    maxOutputBytes: Math.min(
      options?.maxOutputBytes ?? gitDiffOutputLimitBytes,
      gitDiffOutputLimitBytes
    )
  })
}

function runSourceDiff(
  target: GitExecutionTarget,
  type: string,
  parts: readonly string[],
  args: readonly string[],
  paths?: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  return args[0] === 'diff'
    ? runReviewDiff(target, type, parts, args, paths, options)
    : runReviewRead(target, type, parts, args, paths, options)
}

function runReviewReadFresh(
  target: GitExecutionTarget,
  args: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  return runGit(target, args, options)
}

function runReviewDiffFresh(
  target: GitExecutionTarget,
  args: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  const diffArgs = args[0] === 'diff' ? args.slice(1) : args
  return runReviewReadFresh(target, createGitDiffArgs(diffArgs), options)
}

function runSourceDiffFresh(
  target: GitExecutionTarget,
  args: readonly string[],
  options?: GitCliOptions
): Promise<GitCliResult> {
  return args[0] === 'diff'
    ? runReviewDiffFresh(target, args, options)
    : runReviewReadFresh(target, args, options)
}

function isOutputLimitError(error: unknown): boolean {
  return isGitOutputLimitError(error)
}

function rootOf(target: GitExecutionTarget): string {
  return typeof target === 'string' ? target : target.root
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
