// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  GitRepositoryTarget,
  LocalBranchSummary,
  LocalGitPublishStatus
} from '../../../../../shared/localGitApi'
import { CommitOrPushControlProvider } from '@/components/local-git-review/CommitOrPushControlProvider'
import { GitRepositoryProvider } from '@/components/local-git-review/GitRepositoryProvider'
import { LocalGitReviewProvider } from '@/components/local-git-review/LocalGitReviewProvider'
import { ReviewCommitControl } from './ReviewCommitControl'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const target: GitRepositoryTarget = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}
const otherTarget: GitRepositoryTarget = {
  conversationId: 'other-conversation',
  threadId: 'other-thread',
  hostId: 'local',
  cwd: '/other-repo',
  gitRoot: '/other-repo'
}

let container: HTMLDivElement
let root: Root
let git: {
  resolveRepositoryTarget: ReturnType<typeof vi.fn>
  getPublishStatus: ReturnType<typeof vi.fn>
  listBranches: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  commitChanges: ReturnType<typeof vi.fn>
  pushChanges: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
}

describe('ReviewCommitControl', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    git = {
      resolveRepositoryTarget: vi.fn(async ({ target: identity }) => ({
        status: 'ready',
        target: identity.conversationId === otherTarget.conversationId ? otherTarget : target
      })),
      getPublishStatus: vi.fn(async () => publishStatus({ stagedFiles: 1 })),
      listBranches: vi.fn(async () => ({
        current: 'main',
        defaultBase: 'main',
        local: ['main'],
        recent: [],
        uncommittedFileCount: 0
      })),
      subscribe: vi.fn(() => () => undefined),
      commitChanges: vi.fn(async () => ({ status: 'success', commitSha: 'abc1234' })),
      pushChanges: vi.fn(async () => ({
        status: 'success',
        branch: 'main',
        upstreamTrackingRef: 'refs/remotes/origin/main',
        upstreamRemote: 'origin',
        upstreamRemoteRef: 'refs/heads/main'
      })),
      createBranch: vi.fn()
    }
    window.desktopApp = { git } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('loads shared working-tree publish status only after a toolbar trigger opens the dialog', async () => {
    await render()
    await act(flush)

    expect(button().disabled).toBe(false)
    await act(async () => button().click())
    await act(flush)

    expect(git.getPublishStatus).toHaveBeenCalledWith({ target })
    expect(git.listBranches).toHaveBeenCalledWith({ target })
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).not.toBeNull()
  })

  it('renders one shared dialog for multiple toolbar triggers', async () => {
    await render({ controlCount: 2 })
    await act(flush)

    expect(git.subscribe).toHaveBeenCalledTimes(1)
    expect(buttons()).toHaveLength(2)
    await act(async () => buttons()[1]?.click())
    await flush()

    expect(document.body.querySelectorAll('[data-slot="commit-or-push-dialog"]')).toHaveLength(1)
  })

  it('commits before pushing for commit-and-push and reports the pushed branch', async () => {
    await render()
    await act(flush)
    await act(async () => button().click())
    await flush()
    await act(async () => actionButton('commit-and-push').click())
    await flush()

    expect(git.commitChanges).toHaveBeenCalledWith({ target, message: '', includeUnstaged: true })
    expect(git.pushChanges).toHaveBeenCalledWith({ target })
    expect(git.commitChanges.mock.invocationCallOrder[0]).toBeLessThan(
      git.pushChanges.mock.invocationCallOrder[0]!
    )
    expect(document.body.textContent).toContain('已推送 main。')
  })

  it('push-only does not create a commit', async () => {
    git.getPublishStatus.mockResolvedValue(publishStatus({ stagedFiles: 0, commitsAhead: 1 }))
    await render()
    await act(flush)
    await act(async () => button().click())
    await flush()
    await act(async () => actionButton('push').click())
    await flush()

    expect(git.commitChanges).not.toHaveBeenCalled()
    expect(git.pushChanges).toHaveBeenCalledWith({ target })
  })

  it('closes and invalidates a dialog when the conversation target changes', async () => {
    const initialStatus = deferred<LocalGitPublishStatus>()
    const initialBranches = deferred<LocalBranchSummary>()
    git.getPublishStatus.mockImplementation(({ target: requestedTarget }) =>
      requestedTarget.conversationId === target.conversationId
        ? initialStatus.promise
        : Promise.resolve(publishStatus({ stagedFiles: 1 }))
    )
    git.listBranches.mockImplementation(({ target: requestedTarget }) =>
      requestedTarget.conversationId === target.conversationId
        ? initialBranches.promise
        : Promise.resolve(branchSummary())
    )

    await render()
    await act(flush)
    await act(async () => button().click())
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).not.toBeNull()

    await render({ identity: otherTarget })
    await act(flush)
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).toBeNull()

    await act(async () => {
      initialStatus.resolve(publishStatus({ stagedFiles: 1 }))
      initialBranches.resolve(branchSummary())
    })
    await act(flush)
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).toBeNull()

    await act(async () => button().click())
    await act(flush)
    expect(git.getPublishStatus).toHaveBeenLastCalledWith({ target: otherTarget })
    expect(git.listBranches).toHaveBeenLastCalledWith({ target: otherTarget })

    await act(async () => actionButton('commit').click())
    await act(flush)
    expect(git.commitChanges).toHaveBeenCalledWith({
      target: otherTarget,
      message: '',
      includeUnstaged: true
    })
  })
})

function publishStatus({
  stagedFiles,
  commitsAhead = 0
}: {
  stagedFiles: number
  commitsAhead?: number
}): import('../../../../../shared/localGitApi').LocalGitPublishStatus {
  return {
    branch: 'main',
    hasHead: true,
    staged: { fileCount: stagedFiles, additions: stagedFiles, deletions: 0 },
    unstaged: { fileCount: 0, additions: 0, deletions: 0 },
    upstreamTrackingRef: 'refs/remotes/origin/main',
    upstreamRemote: 'origin',
    upstreamRemoteRef: 'refs/heads/main',
    selectedPushRemote: 'origin',
    commitsAhead,
    pushBlockedReason: commitsAhead > 0 ? null : 'nothing-to-push'
  }
}

function branchSummary(): LocalBranchSummary {
  return {
    current: 'main',
    defaultBase: 'main',
    local: ['main'],
    recent: [],
    uncommittedFileCount: 0
  }
}

async function render({
  controlCount = 1,
  identity = target
}: {
  controlCount?: number
  identity?: Pick<GitRepositoryTarget, 'conversationId' | 'threadId'>
} = {}): Promise<void> {
  await act(async () => {
    root.render(
      <GitRepositoryProvider identity={identity}>
        <LocalGitReviewProvider>
          <CommitOrPushControlProvider>
            {Array.from({ length: controlCount }, (_, index) => (
              <ReviewCommitControl key={index} />
            ))}
          </CommitOrPushControlProvider>
        </LocalGitReviewProvider>
      </GitRepositoryProvider>
    )
    await flush()
  })
}

function button(): HTMLButtonElement {
  const [element] = buttons()
  if (!element) throw new Error('Missing commit or push control')
  return element
}

function buttons(): HTMLButtonElement[] {
  const element = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes('提交或推送')
  )
  const elements = [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(
    (candidate) => candidate.textContent?.includes('提交或推送')
  )
  if (!element) throw new Error('Missing commit or push control')
  return elements
}

function actionButton(action: 'commit' | 'commit-and-push' | 'push'): HTMLButtonElement {
  const element = document.body.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  if (!element) throw new Error(`Missing ${action} action`)
  return element
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
