import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { LocalCommitService } from './LocalCommitService'
import { LocalGitService } from './LocalGitService'
import { createGitFixture, git, gitTarget } from './testHelpers'

describe('LocalCommitService', () => {
  it('commits the current index without requiring a snapshot generation', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const localGit = new LocalGitService({ projectService })
    git(repo, ['add', 'tracked.txt'])

    const result = await new LocalCommitService(localGit).commit({
      target: gitTarget(repo),
      message: 'commit changes',
      includeUnstaged: false
    })

    expect(result.status).toBe('success')
    expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('commit changes')
  })

  it('reports a generation failure when no commit message generator is available', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const localGit = new LocalGitService({ projectService })
    await expect(
      new LocalCommitService(localGit).commit({
        target: gitTarget(repo),
        message: '',
        includeUnstaged: true
      })
    ).resolves.toMatchObject({ status: 'generation-failed' })
  })

  it('generates an empty commit message through the injected Codex generator', async () => {
    const { repo, projectService } = await createGitFixture()
    await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n')
    const localGit = new LocalGitService({ projectService })
    const generateMessage = vi.fn(async () => 'Update tracked content')

    const result = await new LocalCommitService(localGit, generateMessage).commit({
      target: gitTarget(repo),
      message: '',
      includeUnstaged: true
    })

    expect(result.status).toBe('success')
    expect(generateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: gitTarget(repo),
        changeSummary: expect.stringContaining('tracked.txt')
      })
    )
    expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('Update tracked content')
  })

  it('stages the latest worktree after asynchronous message generation', async () => {
    const { repo, projectService } = await createGitFixture()
    const localGit = new LocalGitService({ projectService })
    let resolveMessage!: (message: string) => void
    const generateMessage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveMessage = resolve
        })
    )

    const committing = new LocalCommitService(localGit, generateMessage).commit({
      target: gitTarget(repo),
      message: '',
      includeUnstaged: true
    })
    await vi.waitFor(() => expect(generateMessage).toHaveBeenCalledOnce())

    await writeFile(join(repo, 'tracked.txt'), 'latest tracked bytes\n')
    await writeFile(join(repo, 'added-during-generation.txt'), 'latest untracked bytes\n')
    resolveMessage('Commit latest changes')

    await expect(committing).resolves.toMatchObject({ status: 'success' })
    expect(git(repo, ['show', 'HEAD:tracked.txt'])).toBe('latest tracked bytes\n')
    expect(git(repo, ['show', 'HEAD:added-during-generation.txt'])).toBe('latest untracked bytes\n')
  })

  it('commits the index at execution time without staging later worktree changes', async () => {
    const { repo, projectService } = await createGitFixture()
    const localGit = new LocalGitService({ projectService })
    await writeFile(join(repo, 'tracked.txt'), 'staged version\n')
    git(repo, ['add', 'tracked.txt'])
    await writeFile(join(repo, 'tracked.txt'), 'unstaged version\n')

    await expect(
      new LocalCommitService(localGit).commit({
        target: gitTarget(repo),
        message: 'Commit staged version',
        includeUnstaged: false
      })
    ).resolves.toMatchObject({ status: 'success' })

    expect(git(repo, ['show', 'HEAD:tracked.txt'])).toBe('staged version\n')
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('unstaged version\n')
  })

  it('uses index changes made while an asynchronous message is generated', async () => {
    const { repo, projectService } = await createGitFixture()
    const localGit = new LocalGitService({ projectService })
    let resolveMessage!: (message: string) => void
    const generateMessage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveMessage = resolve
        })
    )

    const committing = new LocalCommitService(localGit, generateMessage).commit({
      target: gitTarget(repo),
      message: '',
      includeUnstaged: false
    })
    await vi.waitFor(() => expect(generateMessage).toHaveBeenCalledOnce())
    await writeFile(join(repo, 'tracked.txt'), 'staged during generation\n')
    git(repo, ['add', 'tracked.txt'])
    resolveMessage('Commit current index')

    await expect(committing).resolves.toMatchObject({ status: 'success' })
    expect(git(repo, ['show', 'HEAD:tracked.txt'])).toBe('staged during generation\n')
  })

  it('maps a git add failure to a structured commit failure', async () => {
    const { repo, projectService } = await createGitFixture()
    const localGit = new LocalGitService({ projectService })
    await writeFile(join(repo, 'tracked.txt'), 'change\n')
    await writeFile(join(repo, '.git', 'index.lock'), 'locked\n')

    await expect(
      new LocalCommitService(localGit).commit({
        target: gitTarget(repo),
        message: 'Commit change',
        includeUnstaged: true
      })
    ).resolves.toMatchObject({ status: 'commit-failed', message: expect.any(String) })
  })
})
