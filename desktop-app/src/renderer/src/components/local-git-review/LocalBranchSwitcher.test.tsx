// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  finishGitWorkflow,
  getGitWorkflow,
  notifyGitOperation,
  startGitWorkflow,
  updateGitWorkflow
} = vi.hoisted(() => ({
  finishGitWorkflow: vi.fn(),
  getGitWorkflow: vi.fn(),
  notifyGitOperation: vi.fn(),
  startGitWorkflow: vi.fn(),
  updateGitWorkflow: vi.fn()
}))

vi.mock('./LocalGitReviewProvider', () => ({
  useLocalGitReview: () => ({
    finishGitWorkflow,
    getGitWorkflow,
    notifyGitOperation,
    startGitWorkflow,
    updateGitWorkflow
  })
}))

import { BranchMenuContentForTarget, LocalBranchSwitcher } from './LocalBranchSwitcher'

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
  searchBranches: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
  checkoutBranch: ReturnType<typeof vi.fn>
  commitChanges: ReturnType<typeof vi.fn>
}

describe('LocalBranchSwitcher', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    git = {
      getPublishStatus: vi.fn(async () => ({
        branch: 'main',
        hasHead: true,
        staged: { fileCount: 1, additions: 1, deletions: 0 },
        unstaged: { fileCount: 1, additions: 1, deletions: 1 },
        selectedPushRemote: 'origin',
        commitsAhead: 0,
        pushBlockedReason: 'nothing-to-push'
      })),
      listBranches: vi.fn(async () => ({
        current: 'main',
        defaultBase: 'main',
        local: ['main', 'feature/a', 'feature/b'],
        recent: ['feature/a'],
        uncommittedFileCount: 2
      })),
      searchBranches: vi.fn(async () => [
        {
          branch: 'feature/a',
          isCurrent: false,
          isDefault: false,
          isRecent: true,
          uncommittedFileCount: 0
        }
      ]),
      createBranch: vi.fn(async () => ({ status: 'success', current: 'feature/new' })),
      checkoutBranch: vi.fn(async () => ({ status: 'success', current: 'feature/a' })),
      commitChanges: vi.fn(async () => ({ status: 'success', commitSha: 'abc1234' }))
    }
    finishGitWorkflow.mockReset()
    getGitWorkflow.mockReset()
    getGitWorkflow.mockReturnValue(undefined)
    notifyGitOperation.mockReset()
    startGitWorkflow.mockReset()
    startGitWorkflow.mockReturnValue(true)
    updateGitWorkflow.mockReset()
    window.desktopApp = { git } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('loads branches when opened and searches with the fixed local git API', async () => {
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()

    expect(git.listBranches).toHaveBeenCalledWith({ target })
    expect(document.body.textContent).toContain('feature/a')
    expect(document.body.textContent).toContain('Uncommitted: 2 files')

    await act(async () => setInputValue(inputByLabel('Search branches'), 'feature'))
    await flush()

    expect(git.searchBranches).toHaveBeenCalledWith({ target, query: 'feature' })
    expect(document.body.textContent).toContain('feature/a')
  })

  it('exposes reusable branch menu content for summary submenus', async () => {
    await act(async () => {
      root.render(
        <BranchMenuContentForTarget
          open
          target={target}
          role="dialog"
          ariaLabel="Summary branch switcher"
          className="w-80"
          searchPlaceholder="搜索 dasCowork 分支"
        />
      )
      await flush()
    })

    expect(git.listBranches).toHaveBeenCalledWith({ target })
    expect(document.body.querySelector('[aria-label="Summary branch switcher"]')).not.toBeNull()
    expect(inputByLabel('Search branches').placeholder).toBe('搜索 dasCowork 分支')
    expect(document.body.textContent).toContain('feature/a')
  })

  it('closes when focus or a pointer leaves the branch switcher', async () => {
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    const trigger = buttonWithText('Branch')
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    trigger?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('moves through branch options with arrow keys', async () => {
    await renderSwitcher()
    await act(async () => buttonWithText('Branch')?.click())
    await flush()

    const options = [...document.body.querySelectorAll<HTMLButtonElement>('button[role="option"]')]
    expect(options).toHaveLength(3)
    options[0]?.focus()
    await act(async () => {
      options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(options[1])
  })

  it('creates and checks out a branch from the create dialog', async () => {
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('Create and checkout new branch…')?.click())
    await act(async () => setInputValue(inputByLabel('Branch name'), 'feature/new'))
    await act(async () => buttonWithExactText('Create and checkout')?.click())
    await flush()

    expect(git.createBranch).toHaveBeenCalledWith({
      target,
      branch: 'feature/new',
      failIfExists: true
    })
    expect(startGitWorkflow).toHaveBeenCalledWith(target, {
      kind: 'branch-switch',
      phase: 'creating-branch'
    })
    expect(finishGitWorkflow).toHaveBeenCalledWith(target)
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'success',
      message: 'Created and switched to feature/new.'
    })
    expect(document.body.textContent).not.toContain('Create and checkout branch')
  })

  it('checks out existing branches under the shared Git workflow lock', async () => {
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('feature/a')?.click())
    await flush()

    expect(startGitWorkflow).toHaveBeenCalledWith(target, {
      kind: 'branch-switch',
      phase: 'switching-branch'
    })
    expect(git.checkoutBranch).toHaveBeenCalledWith({ target, branch: 'feature/a' })
    expect(finishGitWorkflow).toHaveBeenCalledWith(target)
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'success',
      message: 'Switched to feature/a.'
    })
  })

  it('does not checkout an existing branch when another Git workflow holds the repository lock', async () => {
    startGitWorkflow.mockReturnValue(false)
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('feature/a')?.click())
    await flush()

    expect(git.checkoutBranch).not.toHaveBeenCalled()
    expect(finishGitWorkflow).not.toHaveBeenCalled()
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'info',
      message: 'A Git operation is already in progress for this repository.'
    })
  })

  it('does not create a branch when another Git workflow holds the repository lock', async () => {
    startGitWorkflow.mockReturnValue(false)
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('Create and checkout new branch…')?.click())
    await act(async () => setInputValue(inputByLabel('Branch name'), 'feature/new'))
    await act(async () => buttonWithExactText('Create and checkout')?.click())
    await flush()

    expect(git.createBranch).not.toHaveBeenCalled()
    expect(finishGitWorkflow).not.toHaveBeenCalled()
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'info',
      message: 'A Git operation is already in progress for this repository.'
    })
  })

  it('P004-EDGE-11 blocks checkout, commits changes, and retries the saved checkout', async () => {
    git.checkoutBranch
      .mockResolvedValueOnce({
        status: 'error',
        errorCode: 'blocked-by-working-tree-changes',
        conflictedPaths: ['src/a.ts'],
        message: 'Working tree has changes'
      })
      .mockResolvedValueOnce({ status: 'success', current: 'feature/a' })
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('feature/a')?.click())
    await flush()

    expect(document.body.textContent).toContain('Commit changes to switch branch')
    expect(document.body.textContent).toContain('src/a.ts')

    await act(async () => buttonWithText('Commit and switch branch…')?.click())
    await flush()
    await act(async () => setTextAreaValue(textareaByLabel('提交信息'), 'Save work'))
    expect(document.body.querySelector('[data-action="commit-and-push"]')).toBeNull()
    expect(document.body.querySelector('[data-action="push"]')).toBeNull()
    await act(async () => actionButton('commit')?.click())
    await flush()

    expect(git.getPublishStatus).toHaveBeenCalledTimes(1)
    expect(git.commitChanges).toHaveBeenCalledWith({
      target,
      message: 'Save work',
      includeUnstaged: true
    })
    expect(git.checkoutBranch).toHaveBeenLastCalledWith({ target, branch: 'feature/a' })
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'info',
      message: 'Commit changes before switching to feature/a.'
    })
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'success',
      message: 'Committed changes and switched to feature/a.'
    })
    expect(startGitWorkflow).toHaveBeenCalledWith(target, {
      kind: 'commit-and-switch',
      phase: 'committing'
    })
    expect(updateGitWorkflow).toHaveBeenCalledWith(target, {
      kind: 'commit-and-switch',
      phase: 'switching-branch'
    })
    expect(finishGitWorkflow).toHaveBeenCalledWith(target)
  })

  it('reports branch failures through the shared feedback channel while keeping retry in place', async () => {
    git.checkoutBranch.mockResolvedValueOnce({
      status: 'error',
      errorCode: 'branch-not-found',
      conflictedPaths: [],
      message: 'Branch was removed'
    })
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('feature/a')?.click())
    await flush()

    expect(document.body.textContent).toContain('Branch was removed')
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'error',
      message: 'Branch was removed'
    })
  })

  it('prevents a second commit workflow for the same repository', async () => {
    startGitWorkflow.mockReturnValueOnce(true).mockReturnValueOnce(false)
    git.checkoutBranch.mockResolvedValueOnce({
      status: 'error',
      errorCode: 'blocked-by-working-tree-changes',
      conflictedPaths: ['src/a.ts'],
      message: 'Working tree has changes'
    })
    await renderSwitcher()

    await act(async () => buttonWithText('Branch')?.click())
    await flush()
    await act(async () => buttonWithText('feature/a')?.click())
    await flush()
    await act(async () => buttonWithText('Commit and switch branch…')?.click())
    await flush()
    await act(async () => actionButton('commit')?.click())
    await flush()

    expect(git.commitChanges).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      'A commit is already in progress for this repository.'
    )
    expect(notifyGitOperation).toHaveBeenCalledWith({
      id: 'branch-operation:local:/repo',
      tone: 'info',
      message: 'A commit is already in progress for this repository.'
    })
  })
})

async function renderSwitcher(): Promise<void> {
  await act(async () => {
    root.render(<LocalBranchSwitcher target={target} />)
    await flush()
  })
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes(text)
  )
}

function buttonWithExactText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text
  )
}

function actionButton(action: 'commit' | 'commit-and-push' | 'push'): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
}

function inputByLabel(label: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!input) throw new Error(`Missing input: ${label}`)
  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  setNativeValue(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function textareaByLabel(label: string): HTMLTextAreaElement {
  const textarea = document.body.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${label}"]`
  )
  if (!textarea) throw new Error(`Missing textarea: ${label}`)
  return textarea
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  setNativeValue(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
}
