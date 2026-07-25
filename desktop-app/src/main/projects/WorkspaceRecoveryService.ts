import { execFile as execFileCallback } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

import type {
  ManagedWorktreeMetadata,
  ProjectState,
  ThreadProjectAssignment,
  WorkspaceRecoveryStatus
} from '../../shared/projects/projectTypes'
import type { WorkspaceRecoveryPayload } from '../../shared/codexIpcApi'
import type { ProjectStore } from './ProjectStore'

const execFile = promisify(execFileCallback)

type GitResult = {
  stdout: string
  stderr: string
}

export type WorkspaceRecoveryServiceDependencies = {
  store: Pick<ProjectStore, 'getState' | 'setState'>
  lstat?: typeof lstat
  realpath?: typeof realpath
  runGit?: (cwd: string, args: readonly string[]) => Promise<GitResult>
}

type ManagedAssignment = Extract<ThreadProjectAssignment, { projectKind: 'local' }> & {
  managedWorktree: ManagedWorktreeMetadata
}

/**
 * Main-process authority for recovering an app-owned worktree.  The only
 * mutable command is constructed from persisted metadata; renderer payloads
 * identify an existing conversation but never carry a path, ref, or command.
 */
export class WorkspaceRecoveryService {
  private readonly lstat: typeof lstat
  private readonly realpath: typeof realpath
  private readonly runGit: (cwd: string, args: readonly string[]) => Promise<GitResult>
  private readonly restoreFailures = new Map<string, WorkspaceRecoveryStatus>()

  constructor(private readonly dependencies: WorkspaceRecoveryServiceDependencies) {
    this.lstat = dependencies.lstat ?? lstat
    this.realpath = dependencies.realpath ?? realpath
    this.runGit = dependencies.runGit ?? runGit
  }

  async inspect(input: WorkspaceRecoveryPayload): Promise<WorkspaceRecoveryStatus> {
    const state = await this.dependencies.store.getState()
    const resolved = this.resolveAssignment(state, input)
    if (!resolved) return { state: 'not-applicable' }

    const { key, assignment } = resolved
    if (assignment.projectKind === 'remote') {
      return { state: 'remote-unavailable', message: '远程工作区暂时不可用。' }
    }
    if (assignment.projectKind === 'projectless') return { state: 'not-applicable' }
    if (!assignment.managedWorktree) {
      const cwdState = await this.pathState(assignment.cwd)
      if (cwdState === 'directory') return { state: 'available' }
      if (cwdState === 'missing') {
        return { state: 'gone', message: '原工作区已不可用。请选择项目并新建任务继续。' }
      }
      return { state: 'checking-failed', message: '无法检查原工作区。请重试。' }
    }

    const failure = this.restoreFailures.get(key)
    const inspected = await this.inspectManagedWorktree(asManagedAssignment(assignment))
    if (inspected.state === 'restorable' && failure) return failure
    return inspected
  }

  async restore(input: WorkspaceRecoveryPayload): Promise<WorkspaceRecoveryStatus> {
    const state = await this.dependencies.store.getState()
    const resolved = this.resolveAssignment(state, input)
    if (!resolved || resolved.assignment.projectKind !== 'local' || !resolved.assignment.managedWorktree) {
      return { state: 'gone', message: '原工作区无法恢复。请选择项目并新建任务继续。' }
    }

    const assignment = asManagedAssignment(resolved.assignment)
    const beforeRestore = await this.inspectManagedWorktree(assignment)
    if (beforeRestore.state !== 'restorable') return beforeRestore

    const metadata = assignment.managedWorktree
    try {
      await this.runGit(metadata.repositoryRoot, [
        'worktree',
        'add',
        metadata.worktreePath,
        metadata.branch
      ])
      const recovered = await this.inspectManagedWorktree(assignment)
      if (recovered.state !== 'available') {
        throw new Error('The restored worktree did not pass verification')
      }
      await this.persistRestoredAssignment(state, resolved.key, assignment)
      this.restoreFailures.delete(resolved.key)
      return recovered
    } catch {
      const failed = {
        state: 'restore-failed' as const,
        message: '恢复工作区失败。请重试，或选择项目后新建任务。'
      }
      this.restoreFailures.set(resolved.key, failed)
      return failed
    }
  }

  private resolveAssignment(
    state: ProjectState,
    input: WorkspaceRecoveryPayload
  ): { key: string; assignment: ThreadProjectAssignment } | null {
    const key =
      (input.threadId && state.threadProjectAssignments[input.threadId] ? input.threadId : undefined) ??
      (state.threadProjectAssignments[input.conversationId] ? input.conversationId : undefined)
    if (!key) return null
    return { key, assignment: state.threadProjectAssignments[key] }
  }

  private async inspectManagedWorktree(
    assignment: ManagedAssignment
  ): Promise<WorkspaceRecoveryStatus> {
    const metadata = assignment.managedWorktree
    if (!hasSafeManagedWorktreeMetadata(metadata)) {
      return { state: 'checking-failed', message: '工作区恢复信息不完整，无法安全恢复。' }
    }

    const targetState = await this.pathState(metadata.worktreePath)
    if (targetState === 'directory') return this.verifyExistingWorktree(metadata)
    if (targetState !== 'missing') {
      return { state: 'checking-failed', message: '工作区路径不可用，无法安全恢复。' }
    }

    try {
      const repositoryRoot = await this.realpath(metadata.repositoryRoot)
      if (repositoryRoot !== metadata.repositoryRoot) {
        return { state: 'checking-failed', message: '工作区恢复信息与仓库不一致。' }
      }
      const actualRepositoryRoot = await this.gitOutput(repositoryRoot, ['rev-parse', '--show-toplevel'])
      if (actualRepositoryRoot !== repositoryRoot) {
        return { state: 'checking-failed', message: '工作区恢复信息与仓库不一致。' }
      }
      await this.gitOutput(repositoryRoot, ['show-ref', '--verify', `refs/heads/${metadata.branch}`])
      await this.gitOutput(repositoryRoot, ['rev-parse', '--verify', `${metadata.ref}^{commit}`])
      return { state: 'restorable' }
    } catch {
      return { state: 'checking-failed', message: '无法检查原工作区。请重试。' }
    }
  }

  private async verifyExistingWorktree(
    metadata: ManagedWorktreeMetadata
  ): Promise<WorkspaceRecoveryStatus> {
    try {
      const worktreePath = await this.realpath(metadata.worktreePath)
      if (worktreePath !== metadata.worktreePath) {
        return { state: 'checking-failed', message: '工作区路径与保存的信息不一致。' }
      }
      const actualRoot = await this.gitOutput(worktreePath, ['rev-parse', '--show-toplevel'])
      const actualBranch = await this.gitOutput(worktreePath, ['branch', '--show-current'])
      if (actualRoot !== worktreePath || actualBranch !== metadata.branch) {
        return { state: 'checking-failed', message: '工作区状态与保存的信息不一致。' }
      }
      const repositoryRoot = await this.realpath(metadata.repositoryRoot)
      const commonDirectory = await this.gitOutput(worktreePath, ['rev-parse', '--git-common-dir'])
      const commonDirectoryPath = await this.realpath(resolveGitPath(worktreePath, commonDirectory))
      const expectedCommonDirectory = await this.realpath(`${repositoryRoot}/.git`)
      if (commonDirectoryPath !== expectedCommonDirectory) {
        return { state: 'checking-failed', message: '工作区不属于保存的仓库。' }
      }
      return { state: 'available' }
    } catch {
      return { state: 'checking-failed', message: '无法检查原工作区。请重试。' }
    }
  }

  private async persistRestoredAssignment(
    state: ProjectState,
    key: string,
    assignment: ManagedAssignment
  ): Promise<void> {
    await this.dependencies.store.setState({
      ...state,
      threadProjectAssignments: {
        ...state.threadProjectAssignments,
        [key]: {
          ...assignment,
          cwd: assignment.managedWorktree.worktreePath,
          path: assignment.managedWorktree.worktreePath
        }
      }
    })
  }

  private async pathState(path: string | null): Promise<'directory' | 'missing' | 'unavailable'> {
    if (!path) return 'missing'
    try {
      return (await this.lstat(path)).isDirectory() ? 'directory' : 'unavailable'
    } catch (error) {
      return isMissingPathError(error) ? 'missing' : 'unavailable'
    }
  }

  private async gitOutput(cwd: string, args: readonly string[]): Promise<string> {
    const result = await this.runGit(cwd, args)
    return result.stdout.trim()
  }
}

function hasSafeManagedWorktreeMetadata(
  metadata: ManagedWorktreeMetadata
): metadata is ManagedWorktreeMetadata {
  return (
    metadata.workspaceKind === 'managed-worktree' &&
    metadata.managedByApp === true &&
    metadata.recoverable === true &&
    isAbsoluteNormalPath(metadata.repositoryRoot) &&
    isAbsoluteNormalPath(metadata.worktreePath) &&
    metadata.repositoryRoot !== metadata.worktreePath &&
    isSafeGitReference(metadata.branch) &&
    isSafeGitReference(metadata.ref)
  )
}

function isAbsoluteNormalPath(path: string): boolean {
  return path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0')
}

function isSafeGitReference(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    ![' ', '~', '^', ':', '?', '*', '\\', '[', ']', '@', '{', '}'].some((character) =>
      value.includes(character)
    )
  )
}

function resolveGitPath(cwd: string, gitPath: string): string {
  return gitPath.startsWith('/') ? gitPath : `${cwd}/${gitPath}`
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  const result = await execFile('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

function asManagedAssignment(
  assignment: Extract<ThreadProjectAssignment, { projectKind: 'local' }>
): ManagedAssignment {
  if (!assignment.managedWorktree) throw new Error('Managed worktree metadata is missing')
  return assignment as ManagedAssignment
}
