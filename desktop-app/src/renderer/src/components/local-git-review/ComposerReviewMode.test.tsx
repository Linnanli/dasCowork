// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalBranchSummary } from '../../../../shared/localGitApi'
import { ComposerReviewMode } from './ComposerReviewMode'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const target = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

function branchSummary(): LocalBranchSummary {
  return {
    current: 'feature',
    defaultBase: 'main',
    local: ['main', 'feature', 'release'],
    recent: ['release'],
    uncommittedFileCount: 2
  }
}

function clickButton(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label)
  )
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ComposerReviewMode', () => {
  let container: HTMLDivElement
  let root: Root
  let listBranches: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    listBranches = vi.fn(async () => branchSummary())
    window.desktopApp = {
      git: {
        listBranches
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('submits an uncommitted review target from the target picker', async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ComposerReviewMode target={target} onCancel={vi.fn()} onSubmit={onSubmit} />)
    })

    await act(async () => {
      clickButton(container, 'Review uncommitted changes')
      await flushAsync()
    })

    expect(onSubmit).toHaveBeenCalledWith({ type: 'uncommitted' })
    expect(listBranches).not.toHaveBeenCalled()
  })

  it('keeps delivery selection separate from the two review targets', async () => {
    const onDeliveryChange = vi.fn()
    await act(async () => {
      root.render(
        <ComposerReviewMode
          target={target}
          delivery="inline"
          onCancel={vi.fn()}
          onDeliveryChange={onDeliveryChange}
          onSubmit={vi.fn()}
        />
      )
    })

    await act(async () => {
      clickButton(container, 'Review in a new task')
    })

    expect(onDeliveryChange).toHaveBeenCalledWith('detached')
    expect(container.textContent).toContain('Review against a base branch')
    expect(container.textContent).toContain('Review uncommitted changes')
  })

  it('loads branches and submits the selected base branch', async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ComposerReviewMode target={target} onCancel={vi.fn()} onSubmit={onSubmit} />)
    })
    await act(async () => {
      clickButton(container, 'Review against a base branch')
      await flushAsync()
    })

    expect(listBranches).toHaveBeenCalledWith({ target })
    expect(container.textContent).toContain('main')
    expect(container.textContent).toContain('release')

    await act(async () => {
      clickButton(container, 'main')
      await flushAsync()
    })

    expect(onSubmit).toHaveBeenCalledWith({ type: 'base-branch', baseBranch: 'main' })
  })

  it('shows branch loading errors and retries listBranches', async () => {
    const onError = vi.fn()
    listBranches
      .mockRejectedValueOnce(new Error('Unable to load branches'))
      .mockResolvedValueOnce(branchSummary())

    await act(async () => {
      root.render(
        <ComposerReviewMode
          target={target}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          onError={onError}
        />
      )
    })
    await act(async () => {
      clickButton(container, 'Review against a base branch')
      await flushAsync()
    })

    expect(container.textContent).toContain('Unable to load branches')
    expect(onError).toHaveBeenCalledWith('Unable to load branches')

    await act(async () => {
      clickButton(container, 'Retry')
      await flushAsync()
    })

    expect(listBranches).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('main')
  })

  it('shows the Xcode license command and retries in place', async () => {
    listBranches
      .mockRejectedValueOnce(new Error('You have not agreed to the Xcode license agreements'))
      .mockResolvedValueOnce(branchSummary())

    await act(async () => {
      root.render(<ComposerReviewMode target={target} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    })
    await act(async () => {
      clickButton(container, 'Review against a base branch')
      await flushAsync()
    })

    expect(container.textContent).toContain('sudo xcodebuild -license')
    await act(async () => {
      clickButton(container, 'Try again')
      await flushAsync()
    })
    expect(listBranches).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('main')
  })

  it('keeps cancel paths accessible from the shell and base-branch step', async () => {
    const onCancel = vi.fn()

    await act(async () => {
      root.render(<ComposerReviewMode target={target} onCancel={onCancel} onSubmit={vi.fn()} />)
    })
    await act(async () => {
      clickButton(container, 'Review against a base branch')
      await flushAsync()
    })
    await act(async () => {
      clickButton(container, 'Cancel')
    })

    expect(container.textContent).toContain('Review uncommitted changes')

    await act(async () => {
      const close = container.querySelector('button[aria-label="Close Review Mode"]')
      close?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows pending state while submit is unresolved', async () => {
    let resolveSubmit: (() => void) | undefined
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        })
    )

    await act(async () => {
      root.render(<ComposerReviewMode target={target} onCancel={vi.fn()} onSubmit={onSubmit} />)
    })
    await act(async () => {
      clickButton(container, 'Review uncommitted changes')
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Starting review…')

    await act(async () => {
      resolveSubmit?.()
      await flushAsync()
    })

    expect(container.textContent).toContain('Review uncommitted changes')
  })
})
