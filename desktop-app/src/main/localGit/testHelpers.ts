import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { ProjectService } from '../projects/ProjectService'
import { ProjectStore, createDefaultProjectState } from '../projects/ProjectStore'
import type { GitRepositoryTarget } from '../../shared/localGitApi'

export async function createGitFixture(): Promise<{
  repo: string
  projectService: ProjectService
}> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'dascowork-local-git-')))
  git(repo, ['init'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  await writeFile(join(repo, 'tracked.txt'), 'one\n')
  git(repo, ['add', 'tracked.txt'])
  git(repo, ['commit', '-m', 'initial'])

  const store = ProjectStore.inMemory({
    ...createDefaultProjectState(),
    localProjects: {
      p1: {
        id: 'p1',
        kind: 'local',
        name: 'Repo',
        hostId: 'local',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        writableRoots: [repo],
        defaultCwd: repo
      }
    },
    threadProjectAssignments: {
      thread1: { projectKind: 'local', projectId: 'p1', cwd: repo }
    }
  })
  const projectService = new ProjectService({
    store,
    validateLocalRoot: async (path) => ({ realPath: path }),
    validateRemoteRoot: async () => undefined,
    createProjectlessWorkspace: async () => ({
      cwd: repo,
      workspaceRoot: repo,
      outputDirectory: repo
    })
  })

  return { repo, projectService }
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

export function gitTarget(
  repo: string,
  conversationId = 'thread1',
  threadId?: string
): GitRepositoryTarget {
  return {
    conversationId,
    ...(threadId ? { threadId } : {}),
    hostId: 'local',
    cwd: repo,
    gitRoot: repo
  }
}
