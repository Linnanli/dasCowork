import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, onTestFinished } from 'vitest'

import { LocalGitService } from './LocalGitService'
import { LocalPushService } from './LocalPushService'
import { createGitFixture, git, gitTarget } from './testHelpers'

describe('LocalPushService', () => {
  it('publishes a branch for the first time and sets its upstream', async () => {
    const { repo, projectService } = await createGitFixture()
    const remote = await createBareRemote()
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['commit', '--allow-empty', '-m', 'publish me'])
    const service = new LocalPushService(new LocalGitService({ projectService }))

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      branch: 'master',
      selectedPushRemote: 'origin',
      commitsAhead: 2,
      pushBlockedReason: null
    })
    await expect(service.push(gitTarget(repo))).resolves.toMatchObject({
      status: 'success',
      branch: 'master',
      upstreamRemote: 'origin',
      upstreamRemoteRef: 'refs/heads/master'
    })
    expect(
      git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim()
    ).toBe('origin/master')
    expect(git(remote, ['show-ref', '--verify', 'refs/heads/master']).trim()).not.toBe('')
  }, 30_000)

  it('reuses a nonstandard configured upstream remote and ref', async () => {
    const { repo, projectService } = await createGitFixture()
    const remote = await createBareRemote()
    git(repo, ['remote', 'add', 'upstream-host', remote])
    git(repo, ['push', '--set-upstream', 'upstream-host', 'HEAD:refs/heads/review/base'])
    git(repo, ['commit', '--allow-empty', '-m', 'follow up'])
    const service = new LocalPushService(new LocalGitService({ projectService }))

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      upstreamTrackingRef: 'refs/remotes/upstream-host/review/base',
      upstreamRemote: 'upstream-host',
      upstreamRemoteRef: 'refs/heads/review/base',
      selectedPushRemote: 'upstream-host',
      commitsAhead: 1,
      pushBlockedReason: null
    })
    await expect(service.push(gitTarget(repo))).resolves.toMatchObject({
      status: 'success',
      upstreamRemote: 'upstream-host',
      upstreamRemoteRef: 'refs/heads/review/base'
    })
    expect(git(remote, ['log', '-1', '--format=%s', 'refs/heads/review/base']).trim()).toBe(
      'follow up'
    )
  }, 30_000)

  it('reports nothing-to-push without invoking a push', async () => {
    const { repo, projectService } = await createGitFixture()
    const remote = await createBareRemote()
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['push', '--set-upstream', 'origin', 'HEAD'])
    const service = new LocalPushService(new LocalGitService({ projectService }))

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      commitsAhead: 0,
      pushBlockedReason: 'nothing-to-push'
    })
    await expect(service.push(gitTarget(repo))).resolves.toEqual({ status: 'nothing-to-push' })
  }, 30_000)

  it('does not pick a remote when none exists or more than one is ambiguous', async () => {
    const { repo, projectService } = await createGitFixture()
    const service = new LocalPushService(new LocalGitService({ projectService }))

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      selectedPushRemote: null,
      pushBlockedReason: 'remote-missing'
    })
    await expect(service.push(gitTarget(repo))).resolves.toEqual({ status: 'remote-missing' })

    const first = await createBareRemote()
    const second = await createBareRemote()
    git(repo, ['remote', 'add', 'first', first])
    git(repo, ['remote', 'add', 'second', second])

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      selectedPushRemote: null,
      pushBlockedReason: 'remote-ambiguous'
    })
    await expect(service.push(gitTarget(repo))).resolves.toEqual({ status: 'remote-ambiguous' })
  }, 30_000)

  it('does not publish from detached HEAD', async () => {
    const { repo, projectService } = await createGitFixture()
    const remote = await createBareRemote()
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['checkout', '--detach'])
    const service = new LocalPushService(new LocalGitService({ projectService }))

    await expect(service.getStatus(gitTarget(repo))).resolves.toMatchObject({
      branch: null,
      selectedPushRemote: 'origin',
      pushBlockedReason: 'branch-missing'
    })
    await expect(service.push(gitTarget(repo))).resolves.toEqual({ status: 'branch-missing' })
  }, 30_000)
})

async function createBareRemote(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dascowork-local-git-remote-'))
  onTestFinished(() => rm(parent, { recursive: true, force: true }))
  const remote = join(parent, 'remote.git')
  execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' })
  return remote
}
