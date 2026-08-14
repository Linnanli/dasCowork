// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommitOrPushControlProvider } from '@/components/local-git-review/CommitOrPushControlProvider'
import { GitRepositoryProvider } from '@/components/local-git-review/GitRepositoryProvider'
import {
  LocalGitReviewProvider,
  useLocalGitReview
} from '@/components/local-git-review/LocalGitReviewProvider'
import { ConversationPinnedSummary } from './ConversationPinnedSummary'

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
  resolveRepositoryTarget: ReturnType<typeof vi.fn>
  getSummary: ReturnType<typeof vi.fn>
  getPublishStatus: ReturnType<typeof vi.fn>
  listBranches: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  searchBranches: ReturnType<typeof vi.fn>
  checkoutBranch: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
}

describe('ConversationPinnedSummary', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    git = {
      resolveRepositoryTarget: vi.fn(async () => ({ status: 'ready', target })),
      getSummary: vi.fn(async () => ({
        snapshotGeneration: 'summary',
        gitRoot: '/repo',
        stagedFileCount: 1,
        unstagedFileCount: 2,
        untrackedFileCount: 0,
        additions: 89,
        deletions: 222,
        branch: 'codex/conversationchangesrow'
      })),
      getPublishStatus: vi.fn(async () => publishStatus()),
      listBranches: vi.fn(async () => branchSummary()),
      subscribe: vi.fn(() => () => undefined),
      searchBranches: vi.fn(async () => []),
      checkoutBranch: vi.fn(),
      createBranch: vi.fn()
    }
    window.desktopApp = { git } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('opens the environment panel with real summary data and only four local entries', async () => {
    await render()
    await clickTrigger()
    await flush()

    expect(document.body.querySelector('[data-slot="conversation-pinned-summary"]')).not.toBeNull()
    expect(
      document.body.querySelector('[data-slot="conversation-pinned-summary-trigger"] .lucide-list')
    ).not.toBeNull()
    expect(document.body.textContent).toContain('环境信息')
    expect(document.body.querySelector('[aria-label="刷新环境信息"]')).toBeNull()
    expect(document.body.textContent).toContain('+89')
    expect(document.body.textContent).toContain('-222')
    expect(document.body.textContent).toContain('codex/conversationchangesrow')
    expect(git.getSummary).toHaveBeenCalledWith({ target })
    expect(document.body.textContent).not.toContain('无法获取拉取请求状态')
    expect(document.body.textContent).not.toContain('比较分支')
    expect(
      document.body.querySelector('[data-slot="conversation-pinned-summary-changes"]')
    ).not.toBeNull()
    expect(
      document.body.querySelector('[data-slot="conversation-pinned-summary-worktree"]')
    ).not.toBeNull()
    expect(
      document.body.querySelector('[data-slot="conversation-pinned-summary-branch"]')
    ).not.toBeNull()
    expect(
      document.body.querySelector('[data-slot="conversation-pinned-summary-commit"]')
    ).not.toBeNull()
  })

  it('uses the active conversation execution identity without selecting another project', async () => {
    await render({ selection: { projectKind: 'remote', projectId: 'remote', hostId: 'host' } })
    await clickTrigger()
    await flush()

    const worktree = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-pinned-summary-worktree"]'
    )
    if (!worktree) throw new Error('Missing worktree row')
    await act(async () => {
      worktree.focus()
      worktree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    expect(document.body.textContent).toContain('继续使用')
    expect(document.body.textContent).toContain('云端')
    expect(document.body.textContent).toContain('本地检出')
    const localOption = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-execution-target-local"]'
    )
    expect(localOption?.getAttribute('title')).toBe('当前任务没有可切换的对应执行位置。')
    expect(localOption?.getAttribute('data-disabled')).not.toBeNull()
    expect(
      document.body
        .querySelector('[data-slot="conversation-pinned-summary-worktree-submenu"]')
        ?.getAttribute('data-side')
    ).toBe('left')
  })

  it('explains both the missing counterpart and started-task restriction', async () => {
    await render({ taskStarted: true })
    await clickTrigger()
    await flush()

    const worktree = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-pinned-summary-worktree"]'
    )
    if (!worktree) throw new Error('Missing worktree row')
    await act(async () => {
      worktree.focus()
      worktree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    const remoteOption = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-execution-target-remote"]'
    )
    expect(remoteOption?.getAttribute('title')).toBe(
      '当前任务没有可切换的对应执行位置。已开始的任务暂不支持切换执行位置。'
    )
  })

  it('opens the shared uncommitted review intent and closes the panel from the changes row', async () => {
    await render({ showReviewIntent: true })
    await clickTrigger()
    await flush()

    const changes = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="conversation-pinned-summary-changes"]'
    )
    await act(async () => changes?.click())
    await flush()

    expect(document.body.querySelector('[data-slot="conversation-pinned-summary"]')).toBeNull()
    expect(document.body.textContent).toContain('review-source:unstaged')
    expect(document.body.textContent).toContain('review-intent:1')
  })

  it('opens the reusable branch menu on ArrowRight and keeps its submenu on the left', async () => {
    await render()
    await clickTrigger()
    await flush()

    const branch = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-pinned-summary-branch"]'
    )
    if (!branch) throw new Error('Missing branch row')
    await act(async () => {
      branch.focus()
      branch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    expect(git.listBranches).toHaveBeenCalledWith({ target })
    expect(document.body.textContent).toContain('Uncommitted: 3 files')
    expect(
      document.body
        .querySelector('[data-slot="conversation-pinned-summary-branch-submenu"]')
        ?.getAttribute('data-side')
    ).toBe('left')
  })

  it('closes on Escape or an outside press and restores focus to the trigger', async () => {
    await render()
    await clickTrigger()
    await flush()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(document.body.querySelector('[data-slot="conversation-pinned-summary"]')).toBeNull()
    expect(document.activeElement).toBe(
      document.body.querySelector('[data-slot="conversation-pinned-summary-trigger"]')
    )

    await clickTrigger()
    await flush()
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    await flush()
    expect(document.body.querySelector('[data-slot="conversation-pinned-summary"]')).toBeNull()
  })

  it('closes only the deepest submenu before closing the main panel on Escape', async () => {
    await render()
    await clickTrigger()
    await flush()

    const worktree = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-pinned-summary-worktree"]'
    )
    if (!worktree) throw new Error('Missing worktree row')
    await act(async () => {
      worktree.focus()
      worktree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    const submenu = document.body.querySelector<HTMLElement>(
      '[data-slot="conversation-pinned-summary-worktree-submenu"]'
    )
    await act(async () => {
      submenu?.focus()
      submenu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(document.body.querySelector('[data-slot="conversation-pinned-summary"]')).not.toBeNull()
    expect(
      document.body
        .querySelector('[data-slot="conversation-pinned-summary-worktree-submenu"]')
        ?.getAttribute('data-state')
    ).not.toBe('open')
    expect(document.activeElement).toBe(worktree)
  })

  it('refreshes summary for matching Git environment changes', async () => {
    let onChange:
      | ((event: import('../../../../shared/localGitApi').LocalGitChangeEvent) => void)
      | undefined
    git.subscribe.mockImplementation((callback) => {
      onChange = callback
      return () => undefined
    })
    await render()
    await clickTrigger()
    await flush()
    expect(git.getSummary).toHaveBeenCalledTimes(1)

    await act(async () =>
      onChange?.({ target, snapshotGeneration: 'event-1', changeTypes: ['remote-refs'] })
    )
    await flush()
    expect(git.getSummary).toHaveBeenCalledTimes(2)

    await act(async () =>
      onChange?.({ target, snapshotGeneration: 'event-2', changeTypes: ['config'] })
    )
    await flush()
    expect(git.getSummary).toHaveBeenCalledTimes(3)

    await act(async () =>
      onChange?.({ target, snapshotGeneration: 'event-3', changeTypes: ['working-tree'] })
    )
    await flush()
    expect(git.getSummary).toHaveBeenCalledTimes(4)
  })
})

async function render({
  selection = { projectKind: 'local', projectId: 'local' },
  showReviewIntent = false,
  taskStarted = false
}: {
  selection?: import('../../../../shared/projects/projectTypes').ProjectSelection
  showReviewIntent?: boolean
  taskStarted?: boolean
} = {}): Promise<void> {
  await act(async () => {
    root.render(
      <GitRepositoryProvider identity={{ conversationId: 'conversation', threadId: 'thread' }}>
        <LocalGitReviewProvider>
          <CommitOrPushControlProvider>
            <ConversationPinnedSummary selection={selection} taskStarted={taskStarted} />
            {showReviewIntent ? <ReviewIntentProbe /> : null}
          </CommitOrPushControlProvider>
        </LocalGitReviewProvider>
      </GitRepositoryProvider>
    )
    await flush()
  })
}

function ReviewIntentProbe(): React.JSX.Element {
  const { reviewOpenIntent, source } = useLocalGitReview()
  return (
    <output>
      review-source:{source.type};review-intent:{reviewOpenIntent?.token ?? 'none'}
    </output>
  )
}

async function clickTrigger(): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="conversation-pinned-summary-trigger"]'
  )
  if (!trigger) throw new Error('Missing summary trigger')
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    trigger.click()
  })
}

function publishStatus(): import('../../../../shared/localGitApi').LocalGitPublishStatus {
  return {
    branch: 'codex/conversationchangesrow',
    hasHead: true,
    staged: { fileCount: 1, additions: 1, deletions: 0 },
    unstaged: { fileCount: 2, additions: 88, deletions: 222 },
    upstreamTrackingRef: null,
    upstreamRemote: null,
    upstreamRemoteRef: null,
    selectedPushRemote: null,
    commitsAhead: 0,
    pushBlockedReason: 'nothing-to-push'
  }
}

function branchSummary(): import('../../../../shared/localGitApi').LocalBranchSummary {
  return {
    current: 'codex/conversationchangesrow',
    defaultBase: 'main',
    local: ['codex/conversationchangesrow', 'main'],
    recent: [],
    uncommittedFileCount: 3
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
