import type { LocalGitChangeEvent } from '../../shared/localGitApi'
import type { GitHostRegistry } from './GitHostRegistry'
import type { GitManager } from './GitManager'
import type { LocalGitTarget } from './types'

type LocalGitWatchInvalidationManager = Pick<
  GitManager,
  'getWorktreeRepositoryForRoot' | 'invalidateStableMetadata'
>

type LocalGitWatchInvalidationHosts = Pick<GitHostRegistry, 'get'>

/**
 * Applies one typed watcher event without discarding a path-scoped untracked
 * cache update when Git reports both an index and a working-tree change.
 */
export function invalidateLocalGitWatchCaches(
  manager: LocalGitWatchInvalidationManager,
  hosts: LocalGitWatchInvalidationHosts,
  target: LocalGitTarget,
  event: Pick<LocalGitChangeEvent, 'changeTypes' | 'changedPaths'>
): void {
  const repository = manager.getWorktreeRepositoryForRoot(target.gitRoot, hosts.get(target.hostId))
  const hasWorkingTreeChange = event.changeTypes.includes('working-tree')

  for (const changeType of event.changeTypes) {
    switch (changeType) {
      case 'config':
        repository.invalidateGitReadCachesForRepoChange('config')
        break
      case 'head':
        repository.invalidateGitReadCachesForRepoChange('head')
        break
      case 'index':
        repository.invalidateGitReadCachesForRepoChange('index')
        if (!hasWorkingTreeChange) repository.invalidateUntrackedPathsCache()
        break
      case 'remote-refs':
        repository.invalidateGitReadCachesForRepoChange('remote-refs')
        break
      case 'synced-branch':
        repository.invalidateGitReadCachesForRepoChange('head')
        break
      case 'worktree-topology':
        manager.invalidateStableMetadata()
        repository.invalidateGitReadCachesForRepoChange('config')
        break
      case 'working-tree':
        repository.invalidateGitReadCachesForRepoChange('working-tree', event.changedPaths)
        break
    }
  }
}
