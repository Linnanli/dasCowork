import { posix, relative, resolve, win32 } from 'node:path'

import type {
  GitConversationTarget,
  GitRepositoryTarget,
  GitResolveRepositoryTargetResult
} from '../../shared/localGitApi'
import type { ProjectService } from '../projects/ProjectService'
import type { GitHost, WorktreeRepository } from './GitManager'
import { GitManager } from './GitManager'
import { GitHostRegistry } from './GitHostRegistry'

export type ResolvedGitRepository = {
  target: GitRepositoryTarget
  repository: WorktreeRepository
}

export class GitRepositoryTargetResolver {
  constructor(
    private readonly options: {
      projectService: ProjectService
      gitManager: GitManager
      hosts: GitHostRegistry
    }
  ) {}

  async resolve(target: GitConversationTarget): Promise<GitResolveRepositoryTargetResult> {
    try {
      const resolved = await this.resolveTrustedRepository(target)
      if (!resolved) {
        return {
          status: 'unavailable',
          reason: '当前任务没有可用的 Git 工作目录。'
        }
      }
      return { status: 'ready', target: resolved.target }
    } catch (error) {
      return {
        status: 'unavailable',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async assertRepository(target: GitRepositoryTarget): Promise<ResolvedGitRepository> {
    const resolved = await this.resolveTrustedRepository(target)
    if (!resolved) throw new Error('Git repository is unavailable for this conversation')

    if (
      resolved.target.hostId !== target.hostId ||
      !sameHostPath(resolved.repository.host, resolved.target.cwd, target.cwd) ||
      !sameHostPath(resolved.repository.host, resolved.target.gitRoot, target.gitRoot)
    ) {
      throw new Error('Git repository target no longer matches the trusted conversation')
    }
    return resolved
  }

  private async resolveTrustedRepository(
    target: GitConversationTarget
  ): Promise<ResolvedGitRepository | null> {
    const executionTarget = await this.options.projectService.resolveExistingThreadTarget({
      conversationId: target.conversationId,
      threadId: target.threadId,
      // A pre-send composer has no thread assignment yet, so it can only use
      // the current project selection. Historical threads must remain bound to
      // their persisted assignment and never fall back to a different project.
      allowActiveProjectFallback: !target.threadId
    })
    if (!executionTarget?.cwd) return null
    const trustedCwd = executionTarget.cwd

    const host = this.options.hosts.get(executionTarget.hostId)
    const repository = await this.options.gitManager.getWorktreeRepository(trustedCwd, host)
    if (!repository) return null

    const trustedRoots =
      executionTarget.workspaceRoots.length > 0 ? executionTarget.workspaceRoots : [trustedCwd]
    if (
      executionTarget.projectAssignment &&
      !trustedRoots.some((root) => isSameOrInside(host, trustedCwd, root))
    ) {
      throw new Error('Conversation cwd is outside the trusted workspace roots')
    }
    // `getWorktreeRepository(trustedCwd, host)` has already asked Git from the
    // trusted cwd and returned this root. Do not repeat the containment check
    // lexically: a remote POSIX host can canonicalize `/var` to `/private/var`
    // in Git output, even though both paths name the same working directory.

    return {
      target: {
        conversationId: target.conversationId,
        ...(target.threadId ? { threadId: target.threadId } : {}),
        hostId: executionTarget.hostId,
        cwd: normalizeHostPath(host, trustedCwd),
        gitRoot: normalizeHostPath(host, repository.root)
      },
      repository
    }
  }
}

function isSameOrInside(host: GitHost, candidate: string, root: string): boolean {
  const path = hostPathModule(host)
  const relativePath = path
    ? path.relative(path.resolve(root), path.resolve(candidate))
    : relative(resolve(root), resolve(candidate))
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsoluteRelative(relativePath))
  )
}

function sameHostPath(host: GitHost, left: string, right: string): boolean {
  const normalizedLeft = normalizeHostPath(host, left)
  const normalizedRight = normalizeHostPath(host, right)
  return host.platformFamily === 'windows'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function normalizeHostPath(host: GitHost, value: string): string {
  if (host.platformFamily === 'windows') return win32.normalize(value)
  if (!host.isLocal) return posix.normalize(value)
  return resolve(value)
}

function hostPathModule(host: GitHost): typeof win32 | typeof posix | undefined {
  if (host.platformFamily === 'windows') return win32
  if (!host.isLocal) return posix
  return undefined
}

function isAbsoluteRelative(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\')
}
