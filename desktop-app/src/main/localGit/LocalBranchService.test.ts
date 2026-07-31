import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalBranchService } from './LocalBranchService'
import { LocalGitService } from './LocalGitService'
import { createGitFixture, git, gitTarget } from './testHelpers'

describe('LocalBranchService', () => {
  it('lists branches and creates a valid branch', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalBranchService(new LocalGitService({ projectService }))

    const created = await service.createAndCheckout(gitTarget(repo), 'feature/test')
    const summary = await service.list(gitTarget(repo))

    expect(created).toEqual({ status: 'success', current: 'feature/test' })
    expect(summary.current).toBe('feature/test')
    expect(summary.local).toContain('feature/test')
  })

  it('rejects invalid branch names before checkout', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalBranchService(new LocalGitService({ projectService }))

    await expect(service.checkout(gitTarget(repo), '../bad')).resolves.toMatchObject({
      status: 'error',
      errorCode: 'invalid-branch'
    })
  })

  it('P004-EDGE-11 reports checkout blocked by working tree changes', async () => {
    const { repo, projectService } = await createGitFixture()
    git(repo, ['checkout', '-b', 'other'])
    await writeFile(join(repo, 'tracked.txt'), 'branch\n')
    git(repo, ['commit', '-am', 'branch edit'])
    git(repo, ['checkout', 'master'])
    await writeFile(join(repo, 'tracked.txt'), 'local\n')
    const service = new LocalBranchService(new LocalGitService({ projectService }))

    await expect(service.checkout(gitTarget(repo), 'other')).resolves.toMatchObject({
      status: 'error',
      errorCode: 'blocked-by-working-tree-changes',
      conflictedPaths: ['tracked.txt']
    })
  })

  it('keeps leading and trailing spaces in blocked checkout paths', async () => {
    const { repo, projectService } = await createGitFixture()
    const spacedPath = '  a path with spaces  .txt'
    await writeFile(join(repo, spacedPath), 'base\n')
    git(repo, ['add', spacedPath])
    git(repo, ['commit', '-m', 'add spaced path'])
    git(repo, ['checkout', '-b', 'other'])
    await writeFile(join(repo, spacedPath), 'branch\n')
    git(repo, ['commit', '-am', 'branch edit'])
    git(repo, ['checkout', 'master'])
    await writeFile(join(repo, spacedPath), 'local\n')
    const service = new LocalBranchService(new LocalGitService({ projectService }))

    await expect(service.checkout(gitTarget(repo), 'other')).resolves.toMatchObject({
      status: 'error',
      errorCode: 'blocked-by-working-tree-changes',
      conflictedPaths: [spacedPath]
    })
  })
})
