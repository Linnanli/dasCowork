// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

const { finishGitWorkflow, getGitWorkflow, startGitWorkflow, updateGitWorkflow } = vi.hoisted(
  () => ({
    finishGitWorkflow: vi.fn(),
    getGitWorkflow: vi.fn(),
    startGitWorkflow: vi.fn(),
    updateGitWorkflow: vi.fn()
  })
)

vi.mock('@/components/local-git-review/LocalGitReviewProvider', () => ({
  useLocalGitReview: () => ({
    finishGitWorkflow,
    getGitWorkflow,
    startGitWorkflow,
    updateGitWorkflow
  })
}))

import { ReviewCommitControl } from './ReviewCommitControl'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const target = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

let container: HTMLDivElement
let root: Root
let git: {
  getPublishStatus: ReturnType<typeof vi.fn>
  listBranches: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  commitChanges: ReturnType<typeof vi.fn>
  pushChanges: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
}
let controller: ReviewWorkspaceController
let onFeedback: ReturnType<typeof vi.fn>

describe('ReviewCommitControl', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    git = {
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
    finishGitWorkflow.mockReset()
    getGitWorkflow.mockReset()
    getGitWorkflow.mockReturnValue(undefined)
    startGitWorkflow.mockReset()
    startGitWorkflow.mockReturnValue(true)
    updateGitWorkflow.mockReset()
    controller = createController()
    onFeedback = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('uses working-tree publish status instead of the displayed review groups', async () => {
    controller = createController({ groups: [] })
    await render()
    await act(flush)

    expect(git.getPublishStatus).toHaveBeenCalledWith({ target })
    expect(button().disabled).toBe(false)
    await act(async () => button().click())
    await act(flush)

    expect(git.listBranches).toHaveBeenCalledWith({ target })
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).not.toBeNull()
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
    expect(onFeedback).toHaveBeenCalledWith({
      id: 'publish-operation:local:/repo',
      tone: 'success',
      message: '已推送 main。'
    })
    expect(controller.refresh).toHaveBeenCalled()
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

  it('opens from a clean detached HEAD when a remote can publish a new branch', async () => {
    git.getPublishStatus.mockResolvedValue(
      publishStatus({ stagedFiles: 0, branch: null, commitsAhead: 0 })
    )
    await render()
    await act(flush)

    expect(button().disabled).toBe(false)
    await act(async () => button().click())
    await act(flush)
    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).not.toBeNull()
  })

  it('publishes a clean detached HEAD after creating a new branch', async () => {
    git.getPublishStatus.mockResolvedValue(
      publishStatus({ stagedFiles: 0, branch: null, commitsAhead: 0 })
    )
    git.createBranch.mockResolvedValue({ status: 'success', current: 'feature/publish-detached' })
    await render()
    await act(flush)
    await act(async () => button().click())
    await act(flush)

    await act(async () => branchTargetButton().click())
    await act(async () => newBranchButton().click())
    await act(async () => setInputValue(newBranchInput(), 'feature/publish-detached'))
    await act(async () => actionButton('push').click())
    await act(flush)

    expect(git.createBranch).toHaveBeenCalledWith({
      target,
      branch: 'feature/publish-detached',
      failIfExists: true
    })
    expect(git.commitChanges).not.toHaveBeenCalled()
    expect(git.pushChanges).toHaveBeenCalledWith({ target })
  })

  it.each([
    ['branch-missing', '当前不在可推送的分支上，请先创建或切换分支。'],
    ['remote-missing', '未配置可用的远端。'],
    ['remote-ambiguous', '无法确定要推送到哪个远端。'],
    ['nothing-to-push', '没有待推送的提交。'],
    ['status-unavailable', '无法读取推送状态。\nstatus detail'],
    ['push-failed', '推送失败。\npush detail']
  ] as const)('shows a useful %s push failure reason', async (status, expectedMessage) => {
    git.getPublishStatus.mockResolvedValue(publishStatus({ stagedFiles: 0, commitsAhead: 1 }))
    git.pushChanges.mockResolvedValue({
      status,
      ...(status === 'status-unavailable'
        ? { message: 'status detail' }
        : status === 'push-failed'
          ? { message: 'push detail' }
          : {})
    })
    await render()
    await act(flush)
    await act(async () => button().click())
    await act(flush)
    await act(async () => actionButton('push').click())
    await act(flush)

    expect(onFeedback).toHaveBeenCalledWith({
      id: 'publish-operation:local:/repo',
      tone: 'error',
      message: expectedMessage
    })
  })

  it('retains a successful commit when the following push fails', async () => {
    git.pushChanges.mockResolvedValue({ status: 'remote-missing' })
    await render()
    await act(flush)
    await act(async () => button().click())
    await act(flush)
    await act(async () => actionButton('commit-and-push').click())
    await act(flush)

    expect(onFeedback).toHaveBeenCalledWith({
      id: 'publish-operation:local:/repo',
      tone: 'error',
      message: '提交成功，但推送失败：未配置可用的远端。'
    })
  })

  it('does not execute when another workflow already holds the repository lock', async () => {
    startGitWorkflow.mockReturnValue(false)
    await render()
    await act(flush)
    await act(async () => button().click())
    await act(flush)
    await act(async () => actionButton('commit').click())
    await act(flush)

    expect(git.commitChanges).not.toHaveBeenCalled()
    expect(onFeedback).toHaveBeenCalledWith({
      id: 'publish-operation:local:/repo',
      tone: 'info',
      message: '当前仓库已有 Git 操作进行中。'
    })
  })
})

function createController({
  groups = [{ path: 'review-only.ts' }]
}: { groups?: unknown[] } = {}): ReviewWorkspaceController {
  return {
    target,
    displaySource: { type: 'commit', commitSha: 'abcdef1' },
    loadState: {
      status: 'ready',
      groups: groups as never,
      snapshots: [],
      partialErrors: [],
      largeDiff: false
    },
    selectedPath: undefined,
    activePath: undefined,
    treeVisible: false,
    refreshing: false,
    mutationStale: false,
    canCopyApplyCommand: false,
    canLoadMoreSearchMatches: false,
    preferences: {
      source: { type: 'unstaged' },
      diffMode: 'unified',
      lineDiffType: 'none',
      wrap: false,
      ignoreWhitespace: false,
      fullFiles: false,
      richPreview: false,
      skipRevertConfirmation: false,
      treeVisible: false,
      treeWidth: 240,
      treeFilter: '',
      collapsedKeys: []
    },
    search: {
      open: false,
      query: '',
      status: 'idle',
      matches: [],
      totalMatches: 0,
      isCapped: false,
      partialErrors: [],
      currentIndex: 0
    },
    setDisplaySource: vi.fn(),
    setSelectedPath: vi.fn(),
    setActivePath: vi.fn(),
    setTreeFilter: vi.fn(),
    setTreeVisible: vi.fn(),
    setTreeWidth: vi.fn(),
    setDiffMode: vi.fn(),
    setLineDiffType: vi.fn(),
    setWrap: vi.fn(),
    setIgnoreWhitespace: vi.fn(),
    setFullFiles: vi.fn(),
    setRichPreview: vi.fn(),
    setSkipRevertConfirmation: vi.fn(),
    setCollapsed: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    isViewed: vi.fn(),
    setViewed: vi.fn(),
    refresh: vi.fn(),
    retryPartialSource: vi.fn(),
    setSearchOpen: vi.fn(),
    setSearchQuery: vi.fn(),
    moveSearchMatch: vi.fn(),
    selectSearchMatch: vi.fn(),
    loadMoreSearchMatches: vi.fn(),
    copyReviewApplyCommand: vi.fn(),
    loadSectionDiff: vi.fn(),
    isMutationDisabled: vi.fn(),
    applyHunkAction: vi.fn(),
    applySectionAction: vi.fn(),
    applyFileAction: vi.fn()
  }
}

function publishStatus({
  stagedFiles,
  commitsAhead = 0,
  branch = 'main'
}: {
  stagedFiles: number
  commitsAhead?: number
  branch?: string | null
}): import('../../../../../shared/localGitApi').LocalGitPublishStatus {
  return {
    branch,
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

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <ReviewCommitControl
        controller={controller}
        onFeedback={
          onFeedback as (feedback: { tone: 'success' | 'info' | 'error'; message: string }) => void
        }
      />
    )
    await flush()
  })
}

function button(): HTMLButtonElement {
  const element = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes('提交或推送')
  )
  if (!element) throw new Error('Missing commit or push control')
  return element
}

function actionButton(action: 'commit' | 'commit-and-push' | 'push'): HTMLButtonElement {
  const element = document.body.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  if (!element) throw new Error(`Missing ${action} action`)
  return element
}

function branchTargetButton(): HTMLButtonElement {
  const element = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes('当前分支')
  )
  if (!element) throw new Error('Missing current branch target button')
  return element
}

function newBranchButton(): HTMLButtonElement {
  const element = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === '新分支'
  )
  if (!element) throw new Error('Missing new branch choice')
  return element
}

function newBranchInput(): HTMLInputElement {
  const element = document.body.querySelector<HTMLInputElement>('input[aria-label="新分支名称"]')
  if (!element) throw new Error('Missing new branch input')
  return element
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
