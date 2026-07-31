import { runGit } from './gitCli'
import type { WorktreeRepository } from './GitManager'
import { assertSafeRepoRelativePath, pathsFromPatch, validateGitPatch } from './reviewPatch'
import type { LocalGitMutationResult } from './types'

export type ApplyPatchOptions = {
  gitRoot?: string
  repository?: WorktreeRepository
  cwd?: string
  directory?: string
  patch: string
  reverse?: boolean
  cached?: boolean
}

export async function applyGitPatch(options: ApplyPatchOptions): Promise<LocalGitMutationResult> {
  validateGitPatch(options.patch)
  const target = options.repository ?? options.gitRoot
  if (!target) throw new Error('Git repository is required')
  if (options.cwd && !options.repository) {
    throw new Error('A repository is required when applying from a custom cwd')
  }
  if (options.directory) assertSafeRepoRelativePath(options.directory)
  const args = ['apply', '--whitespace=nowarn']
  if (options.reverse) args.push('--reverse')
  if (options.cached) args.push('--cached')
  if (options.directory) args.push(`--directory=${options.directory}`)
  args.push('-')

  try {
    if (options.cwd && options.repository) {
      const result = await options.repository.host.runGit(args, options.cwd, {
        input: options.patch
      })
      if (!result.success) throw new Error('git apply failed')
    } else {
      await runGit(target, args, { input: options.patch })
    }
    return {
      status: 'success',
      appliedPaths: pathsFromPatch(options.patch),
      skippedPaths: [],
      conflictedPaths: []
    }
  } catch {
    return {
      status: 'error',
      errorCode: 'patch-apply-failed',
      appliedPaths: [],
      skippedPaths: [],
      conflictedPaths: pathsFromPatch(options.patch)
    }
  }
}
