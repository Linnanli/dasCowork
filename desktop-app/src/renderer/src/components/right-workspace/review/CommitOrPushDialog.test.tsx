// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CommitOrPushDialog,
  type CommitOrPushDialogActionInput,
  type CommitOrPushDialogStatus
} from './CommitOrPushDialog'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const status: CommitOrPushDialogStatus = {
  branch: 'main',
  hasHead: true,
  staged: { fileCount: 1, additions: 4, deletions: 2 },
  unstaged: { fileCount: 2, additions: 20, deletions: 36 },
  upstreamTrackingRef: 'refs/remotes/origin/main',
  upstreamRemote: 'origin',
  upstreamRemoteRef: 'refs/heads/main',
  selectedPushRemote: 'origin',
  commitsAhead: 1,
  pushBlockedReason: null
}

let container: HTMLDivElement
let root: Root
let onAction: ReturnType<typeof vi.fn<(input: CommitOrPushDialogActionInput) => Promise<void>>>
let onOpenChange: ReturnType<typeof vi.fn>

describe('CommitOrPushDialog', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onAction = vi.fn(async () => undefined)
    onOpenChange = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('renders the command-menu surface with selected working-tree stats and no close button', async () => {
    await render()

    const dialog = document.body.querySelector('[data-slot="commit-or-push-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.className).toContain('w-[420px]')
    expect(dialog?.className).toContain('max-w-[92vw]')
    expect(dialog?.textContent).toContain('main')
    expect(dialog?.textContent).toContain('+24')
    expect(dialog?.textContent).toContain('-38')
    expect(document.body.querySelector('[data-slot="dialog-close"]')).toBeNull()
    expect(actionButton('commit').disabled).toBe(false)
    expect(actionButton('commit-and-push').disabled).toBe(false)
    expect(actionButton('push').disabled).toBe(false)
  })

  it('uses the compact typography required by the design contract', async () => {
    await render()

    expect(branchTrigger().className).toContain('text-[13px]')
    expect(textarea().className).toContain('text-[13px]')
    expect(actionButton('commit').className).toContain('text-[13px]')
    expect(actionButton('commit').querySelector('kbd')?.className).toContain('text-[11px]')
  })

  it('uses staged-only stats when unstaged changes are excluded', async () => {
    await render()
    await act(async () => checkbox().click())

    expect(document.body.textContent).toContain('+4')
    expect(document.body.textContent).toContain('-2')
  })

  it('keeps action availability independent', async () => {
    await render({
      status: { ...status, commitsAhead: 0, pushBlockedReason: 'nothing-to-push' }
    })

    expect(actionButton('commit').disabled).toBe(false)
    expect(actionButton('commit-and-push').disabled).toBe(false)
    expect(actionButton('push').disabled).toBe(true)
    expect(actionButton('push').dataset.disabledReason).toBe('没有待推送的提交。')
  })

  it('allows publishing a new branch from detached HEAD when Main has selected a remote', async () => {
    await render({
      status: {
        ...status,
        branch: null,
        commitsAhead: 0,
        pushBlockedReason: 'branch-missing',
        selectedPushRemote: 'origin'
      }
    })
    await act(async () => branchTrigger('当前分支').click())
    await act(async () => buttonWithText('新分支')?.click())
    await act(async () => setTextValue(inputByLabel('新分支名称'), 'feature/publish-detached'))

    expect(actionButton('commit').disabled).toBe(false)
    expect(actionButton('commit-and-push').disabled).toBe(false)
    expect(actionButton('push').disabled).toBe(false)
  })

  it('validates a new branch and passes the selected action values through', async () => {
    await render()
    await act(async () => branchTrigger().click())
    await act(async () => buttonWithText('新分支')?.click())
    await act(async () => setTextValue(inputByLabel('新分支名称'), 'feature/publish'))
    await act(async () => setTextValue(textarea(), 'Publish review'))
    await act(async () => actionButton('commit-and-push').click())

    expect(onAction).toHaveBeenCalledWith({
      action: 'commit-and-push',
      message: 'Publish review',
      includeUnstaged: true,
      newBranch: 'feature/publish'
    })
  })

  it('cycles actions and runs only the highlighted action with Cmd/Ctrl+Enter', async () => {
    await render()
    const dialog = document.body.querySelector<HTMLElement>('[data-slot="commit-or-push-dialog"]')
    await act(async () => dialog?.dispatchEvent(keyDown('ArrowDown')))
    await act(async () => dialog?.dispatchEvent(keyDown('Enter', { ctrlKey: true })))

    expect(onAction).toHaveBeenCalledWith({
      action: 'commit-and-push',
      message: '',
      includeUnstaged: true,
      newBranch: undefined
    })
  })

  it('runs Cmd/Ctrl+Enter from the textarea exactly once without consuming normal Enter', async () => {
    await render()
    await act(async () => textarea().dispatchEvent(keyDown('Enter', { ctrlKey: true })))
    await flush()

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({
      action: 'commit',
      message: '',
      includeUnstaged: true,
      newBranch: undefined
    })
  })

  it('keeps the dialog open and reports an action failure', async () => {
    onAction.mockRejectedValueOnce(new Error('提交失败。'))
    await render()
    await act(async () => actionButton('commit').click())
    await flush()

    expect(document.body.querySelector('[data-slot="commit-or-push-dialog"]')).not.toBeNull()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('提交失败。')
  })

  it('does not show publish actions in commit-before-switch mode', async () => {
    await render({ mode: 'commit-before-switch' })

    expect(actionButton('commit')).not.toBeNull()
    expect(document.body.querySelector('[data-action="commit-and-push"]')).toBeNull()
    expect(document.body.querySelector('[data-action="push"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="新分支名称"]')).toBeNull()
  })
})

async function render(
  overrides: Partial<React.ComponentProps<typeof CommitOrPushDialog>> = {}
): Promise<void> {
  await act(async () => {
    root.render(
      <CommitOrPushDialog
        open
        status={status}
        branches={['main', 'feature/existing']}
        onAction={onAction}
        onOpenChange={onOpenChange as (open: boolean) => void}
        {...overrides}
      />
    )
    await flush()
  })
}

function actionButton(action: 'commit' | 'commit-and-push' | 'push'): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  if (!button) throw new Error(`Missing ${action} action`)
  return button
}

function branchTrigger(label = 'main'): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes(label)
  )
  if (!button) throw new Error('Missing branch trigger')
  return button
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes(text)
  )
}

function checkbox(): HTMLButtonElement {
  const element = document.body.querySelector<HTMLButtonElement>('[data-slot="checkbox"]')
  if (!element) throw new Error('Missing checkbox')
  return element
}

function textarea(): HTMLTextAreaElement {
  const element = document.body.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="提交信息"]'
  )
  if (!element) throw new Error('Missing textarea')
  return element
}

function inputByLabel(label: string): HTMLInputElement {
  const element = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing ${label}`)
  return element
}

function setTextValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function keyDown(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, key, ...options })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
