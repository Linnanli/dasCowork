import { createHash, randomUUID } from 'node:crypto'

import {
  createGitDiffArgs,
  isGitCliError,
  runCachedGitRead,
  runGit,
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
  const [files, stagedFileCount, unstagedFileCount, stateHash] = await Promise.all([
    listReviewFiles(executionTarget, source),
    countChangedFiles(executionTarget, ['diff', '--cached', '--name-only']),
    countUnstagedFiles(executionTarget),
    computeWorkspaceStateHash(executionTarget)
  ])
  const patchSize = await diffSize(executionTarget, source)
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
  const [diff, status] = await Promise.all([
    getDiffForSource({ gitRoot, source, path }).catch(() => ({ stdout: '', stderr: '' })),
    runReviewRead(
      gitRoot,
      'file-status',
      [path],
      ['status', '--porcelain=v1', '-z', '--', path],
      [path]
    ).catch(() => ({
      stdout: '',
      stderr: ''
    }))
  ])
  return sha256(`${JSON.stringify(source)}\0${path}\0${diff}\0${status.stdout}`)
}

export async function getDiffForSource({
  gitRoot,
  source,
  path
}: {
  gitRoot: GitExecutionTarget
  source: LocalGitReviewSource
  path?: string
}): Promise<string> {
  const pathArgs = path ? ['--', path] : []
  const diffArgs = diffArgsForSource(source, ['--binary', ...pathArgs])
  const trackedDiff = (
    await runSourceDiff(
      gitRoot,
      'diff',
      [JSON.stringify(source), path ?? 'all'],
      diffArgs,
      path ? [path] : undefined
    )
  ).stdout
  if (source.type !== 'unstaged') return trackedDiff

  const untrackedPaths = path ? [path] : await listUntrackedPaths(gitRoot)
  const untrackedDiffs = await Promise.all(
    untrackedPaths.map(async (untrackedPath) => {
      if (!(await isUntrackedPath(gitRoot, untrackedPath))) return ''
      return untrackedDiff(gitRoot, untrackedPath, ['--binary'])
    })
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
  const pathArgs = paths && paths.length > 0 ? ['--', ...paths] : []
  const numstatArgs = diffArgsForSource(source, ['--numstat', '-z', ...pathArgs])
  const nameStatusArgs = diffArgsForSource(source, ['--name-status', '-z', ...pathArgs])
  const [numstat, nameStatus] = await Promise.all([
    runSourceDiff(
      gitRoot,
      'numstat',
      [JSON.stringify(source), ...(paths ?? [])],
      numstatArgs,
      paths
    ),
    runSourceDiff(
      gitRoot,
      'name-status',
      [JSON.stringify(source), ...(paths ?? [])],
      nameStatusArgs,
      paths
    )
  ])
  const stats = parseNumstat(numstat.stdout)
  const statusEntries = parseNameStatus(nameStatus.stdout)

  const trackedFiles = await Promise.all(
    statusEntries.map(async (entry) => {
      const stat = stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false }
      return {
        path: entry.path,
        previousPath: entry.previousPath,
        changeKind: entry.changeKind,
        revision: await computeFileRevision({ gitRoot, source, path: entry.path }),
        additions: stat.additions,
        deletions: stat.deletions,
        binary: stat.binary,
        conflicted: entry.changeKind === 'unmerged'
      }
    })
  )
  if (source.type !== 'unstaged') return trackedFiles

  const untrackedFiles = await Promise.all(
    (await listUntrackedPaths(gitRoot))
      .filter((path) => paths === undefined || paths.includes(path))
      .map(async (path) => {
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
          revision: await computeFileRevision({ gitRoot, source, path }),
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
  source: LocalGitReviewSource
): Promise<number> {
  if (source.type === 'last-turn') return 0
  const diff = await getDiffForSource({ gitRoot, source })
  return Buffer.byteLength(diff)
}

function parseNumstat(
  output: string
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const values = output.split('\0').filter(Boolean)
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (let index = 0; index < values.length; index += 1) {
    const columns = values[index].split('\t')
    if (columns.length < 3) continue
    const [additionsText, deletionsText, pathMarker] = columns
    const path = pathMarker === '' ? values[index + 2] : pathMarker
    if (pathMarker === '') index += 2
    stats.set(path, {
      additions: additionsText === '-' ? 0 : Number(additionsText),
      deletions: deletionsText === '-' ? 0 : Number(deletionsText),
      binary: additionsText === '-' || deletionsText === '-'
    })
  }
  return stats
}

function parseNameStatus(output: string): Array<{
  path: string
  previousPath?: string
  changeKind: LocalGitChangeKind
}> {
  const values = output.split('\0').filter(Boolean)
  const entries: Array<{ path: string; previousPath?: string; changeKind: LocalGitChangeKind }> = []
  for (let index = 0; index < values.length; index += 1) {
    const status = values[index]
    const code = status[0]
    if (code === 'R' || code === 'C') {
      const previousPath = values[index + 1]
      const path = values[index + 2]
      index += 2
      entries.push({ path, previousPath, changeKind: code === 'R' ? 'renamed' : 'copied' })
      continue
    }
    const path = values[index + 1]
    index += 1
    entries.push({ path, changeKind: changeKindFromStatus(code) })
  }
  return entries
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
  options: readonly string[]
): Promise<string> {
  try {
    return (
      await runReviewDiff(
        gitRoot,
        'untracked-diff',
        [path, ...options],
        ['--no-index', ...options, '/dev/null', path],
        [path]
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
  paths?: readonly string[]
): Promise<GitCliResult> {
  if (typeof target === 'string') return runGit(target, args)
  return runCachedGitRead(
    target,
    type,
    ['review', String(target.reviewSnapshot.generation), ...parts],
    args,
    {},
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
  paths?: readonly string[]
): Promise<GitCliResult> {
  const diffArgs = args[0] === 'diff' ? args.slice(1) : args
  return runReviewRead(target, type, parts, createGitDiffArgs(diffArgs), paths)
}

function runSourceDiff(
  target: GitExecutionTarget,
  type: string,
  parts: readonly string[],
  args: readonly string[],
  paths?: readonly string[]
): Promise<GitCliResult> {
  return args[0] === 'diff'
    ? runReviewDiff(target, type, parts, args, paths)
    : runReviewRead(target, type, parts, args, paths)
}

function rootOf(target: GitExecutionTarget): string {
  return typeof target === 'string' ? target : target.root
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
