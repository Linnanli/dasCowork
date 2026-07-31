import { LOCAL_GIT_COMMIT_MESSAGE_MAX_CHARACTERS } from '../../shared/localGitApi'
import { runGit, isGitCliError } from './gitCli'
import type { WorktreeRepository } from './GitManager'
import type { LocalGitService } from './LocalGitService'
import type { LocalCommitRequest, LocalCommitResult, LocalGitTarget } from './types'

export type CommitMessageGenerator = (input: {
  target: LocalGitTarget
  changeSummary: string
}) => Promise<string>

export class LocalCommitService {
  constructor(
    private readonly localGit: LocalGitService,
    private readonly generateMessage?: CommitMessageGenerator
  ) {}

  async commit(input: LocalCommitRequest): Promise<LocalCommitResult> {
    const { repository } = await this.localGit.resolveTrustedRepository(input.target)

    let message = input.message.trim()
    if (!message) {
      if (!this.generateMessage) {
        return {
          status: 'generation-failed',
          message: 'Commit message generation is unavailable.'
        }
      }

      try {
        message = normalizeGeneratedCommitMessage(
          await this.generateMessage({
            target: input.target,
            changeSummary: await this.commitMessageSummary(repository)
          })
        )
      } catch (error) {
        return {
          status: 'generation-failed',
          message: error instanceof Error ? error.message : 'Unable to generate a commit message.'
        }
      }
    }

    if (input.includeUnstaged) {
      try {
        await runGit(repository, ['add', '--all'])
        repository.invalidateGitReadCachesForMutation()
        repository.invalidateUntrackedPathsCache()
      } catch (error) {
        return commitFailureResult(error)
      }
    }

    const stagedFiles = (
      await runGit(repository, ['diff', '--cached', '--name-only'])
    ).stdout.trim()
    if (!stagedFiles) return { status: 'nothing-to-commit' }

    try {
      await runGit(repository, ['commit', '-m', message])
      const commitSha = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim()
      repository.invalidateGitReadCachesForRepoChange('head')
      repository.invalidateGitReadCachesForRepoChange('index')
      repository.invalidateGitReadCachesForRepoChange('working-tree')
      repository.invalidateUntrackedPathsCache()
      return { status: 'success', commitSha }
    } catch (error) {
      return commitFailureResult(error)
    }
  }

  private async commitMessageSummary(repository: WorktreeRepository): Promise<string> {
    const [staged, unstaged, untracked] = await Promise.all([
      runGit(repository, ['diff', '--cached', '--stat']),
      runGit(repository, ['diff', '--stat']),
      runGit(repository, ['ls-files', '--others', '--exclude-standard'])
    ])
    const summary = [
      'Staged changes:',
      staged.stdout.trim() || '(none)',
      'Unstaged changes:',
      unstaged.stdout.trim() || '(none)',
      'Untracked files:',
      untracked.stdout.trim() || '(none)'
    ].join('\n')

    return summary.slice(0, 12_000)
  }
}

function commitFailureResult(error: unknown): LocalCommitResult {
  return {
    status: 'commit-failed',
    message: isGitCliError(error) ? `${error.stderr}\n${error.stdout}`.trim() : String(error)
  }
}

function normalizeGeneratedCommitMessage(value: string): string {
  const firstLine = value
    .trim()
    .replace(/^`+|`+$/gu, '')
    .split(/\r?\n/u, 1)[0]
    ?.trim()

  if (!firstLine) throw new Error('Commit message generation returned an empty response.')
  if (firstLine.length > LOCAL_GIT_COMMIT_MESSAGE_MAX_CHARACTERS) {
    throw new Error('Generated commit message is too long.')
  }
  return firstLine
}
