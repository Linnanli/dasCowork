import { runCachedGitRead, runGit, isGitCliError } from './gitCli'
import type { WorktreeRepository } from './GitManager'
import type { LocalGitService } from './LocalGitService'
import type {
  LocalBranchCheckoutResult,
  LocalBranchSearchResult,
  LocalBranchSummary,
  LocalGitTarget
} from './types'

export class LocalBranchService {
  constructor(private readonly localGit: LocalGitService) {}

  async list(target: LocalGitTarget): Promise<LocalBranchSummary> {
    const { repository } = await this.localGit.resolveTrustedRepository(target)
    const [current, branches, defaultBase, recent, uncommittedFileCount] = await Promise.all([
      this.currentBranch(repository),
      this.localBranches(repository),
      this.defaultBase(repository),
      this.recentBranches(repository),
      this.uncommittedFileCount(repository)
    ])
    return { current, defaultBase, local: branches, recent, uncommittedFileCount }
  }

  async search(target: LocalGitTarget, query: string): Promise<LocalBranchSearchResult[]> {
    const summary = await this.list(target)
    const normalizedQuery = query.trim().toLowerCase()
    return summary.local
      .filter((branch) => branch.toLowerCase().includes(normalizedQuery))
      .map((branch) => ({
        branch,
        isCurrent: branch === summary.current,
        isDefault: branch === summary.defaultBase,
        isRecent: summary.recent.includes(branch),
        uncommittedFileCount: summary.uncommittedFileCount
      }))
  }

  async checkout(target: LocalGitTarget, branch: string): Promise<LocalBranchCheckoutResult> {
    const { repository } = await this.localGit.resolveTrustedRepository(target)
    const validation = await this.validateExistingBranch(repository, branch)
    if (validation) return validation
    try {
      await runGit(repository, ['checkout', branch])
      repository.invalidateGitReadCachesForRepoChange('head')
      repository.invalidateGitReadCachesForRepoChange('working-tree')
      return { status: 'success', current: branch }
    } catch (error) {
      return checkoutErrorResult(error, await changedPaths(repository))
    }
  }

  async createAndCheckout(
    target: LocalGitTarget,
    branch: string
  ): Promise<LocalBranchCheckoutResult> {
    const { repository } = await this.localGit.resolveTrustedRepository(target)
    const validRef = await this.isValidBranchName(repository, branch)
    if (!validRef) {
      return { status: 'error', errorCode: 'invalid-branch', conflictedPaths: [] }
    }
    if (await this.branchExists(repository, branch)) {
      return { status: 'error', errorCode: 'invalid-branch', conflictedPaths: [] }
    }

    try {
      await runGit(repository, ['checkout', '-b', branch])
      repository.invalidateGitReadCachesForRepoChange('head')
      repository.invalidateGitReadCachesForRepoChange('working-tree')
      return { status: 'success', current: branch }
    } catch (error) {
      return checkoutErrorResult(error, await changedPaths(repository))
    }
  }

  private async currentBranch(repository: WorktreeRepository): Promise<string | null> {
    const result = await runCachedGitRead(
      repository,
      'current-branch',
      [],
      ['branch', '--show-current'],
      {},
      { staleTime: Infinity, metadata: { gitReadInvalidation: ['head'] } }
    )
    return result.stdout.trim() || null
  }

  private async localBranches(repository: WorktreeRepository): Promise<string[]> {
    const result = await runCachedGitRead(
      repository,
      'local-branches',
      [],
      ['branch', '--format=%(refname:short)'],
      {},
      { staleTime: Infinity, metadata: { gitReadInvalidation: ['head', 'remote-refs'] } }
    )
    return result.stdout
      .split(/\r?\n/u)
      .map((branch) => branch.trim())
      .filter(Boolean)
  }

  private async defaultBase(repository: WorktreeRepository): Promise<string | null> {
    const remoteHead = await runCachedGitRead(
      repository,
      'default-base',
      [],
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      {},
      { staleTime: Infinity, metadata: { gitReadInvalidation: ['remote-refs', 'head'] } }
    )
      .then((result) => result.stdout.trim().replace(/^origin\//u, ''))
      .catch(() => '')
    if (remoteHead) return remoteHead
    const branches = await this.localBranches(repository)
    if (branches.includes('main')) return 'main'
    if (branches.includes('master')) return 'master'
    return branches[0] ?? null
  }

  private async recentBranches(repository: WorktreeRepository): Promise<string[]> {
    const result = await runCachedGitRead(
      repository,
      'recent-branches',
      [],
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--count=10',
        '--format=%(refname:short)',
        'refs/heads'
      ],
      {},
      { staleTime: Infinity, metadata: { gitReadInvalidation: ['head'] } }
    )
    return result.stdout
      .split(/\r?\n/u)
      .map((branch) => branch.trim())
      .filter(Boolean)
  }

  private async uncommittedFileCount(repository: WorktreeRepository): Promise<number> {
    return changedPaths(repository).then((paths) => paths.length)
  }

  private async validateExistingBranch(
    repository: WorktreeRepository,
    branch: string
  ): Promise<LocalBranchCheckoutResult | null> {
    const validRef = await this.isValidBranchName(repository, branch)
    if (!validRef) return { status: 'error', errorCode: 'invalid-branch', conflictedPaths: [] }
    if (!(await this.branchExists(repository, branch))) {
      return { status: 'error', errorCode: 'branch-not-found', conflictedPaths: [] }
    }
    return null
  }

  private async isValidBranchName(
    repository: WorktreeRepository,
    branch: string
  ): Promise<boolean> {
    if (!branch.trim() || branch.endsWith('/')) return false
    return runGit(repository, ['check-ref-format', '--branch', branch])
      .then(() => true)
      .catch(() => false)
  }

  private async branchExists(repository: WorktreeRepository, branch: string): Promise<boolean> {
    return runGit(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      .then(() => true)
      .catch(() => false)
  }
}

async function changedPaths(repository: WorktreeRepository): Promise<string[]> {
  const result = await runCachedGitRead(
    repository,
    'changed-paths',
    [],
    ['status', '--porcelain=v1', '-z'],
    {},
    { staleTime: 10_000, metadata: { gitReadInvalidation: 'short-lived' } }
  )
  const entries = result.stdout.split('\0')
  const paths: string[] = []

  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index]
    const status = entry.slice(0, 2)
    paths.push(entry.slice(3))

    if (status.includes('R') || status.includes('C')) {
      const originalPath = entries[index + 1]
      if (originalPath !== undefined) paths.push(originalPath)
      index += 1
    }
  }

  return paths
}

function checkoutErrorResult(error: unknown, conflictedPaths: string[]): LocalBranchCheckoutResult {
  if (isGitCliError(error)) {
    const message = `${error.stderr}\n${error.stdout}`.trim()
    if (/would be overwritten|local changes|Please commit your changes/iu.test(message)) {
      return {
        status: 'error',
        errorCode: 'blocked-by-working-tree-changes',
        conflictedPaths,
        message
      }
    }
    return { status: 'error', errorCode: 'unknown', conflictedPaths, message }
  }
  return { status: 'error', errorCode: 'unknown', conflictedPaths, message: String(error) }
}
