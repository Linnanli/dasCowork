// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalBranchSummary } from '../../../../shared/localGitApi'
import { ComposerCodeReviewCommandContent } from './composer-code-review-command-content'

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
    defaultBase: 'origin/main',
    recent: ['codex/review-ui'],
    local: ['origin/main', 'feature'],
    uncommittedFileCount: 2
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function clickButton(container: HTMLElement, text: string): void {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('ComposerCodeReviewCommandContent', () => {
  let container: HTMLDivElement
  let root: Root
  let listBranches: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    listBranches = vi.fn(async () => branchSummary())
    window.desktopApp = { git: { listBranches } } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('lists uncommitted changes and base branches in one secondary panel', async () => {
    const onSubmit = vi.fn()

    await act(async () => {
      root.render(<ComposerCodeReviewCommandContent target={target} onSubmit={onSubmit} />)
      await flushAsync()
    })

    expect(
      container.querySelector('[data-slot="composer-code-review-command-content"]')
    ).not.toBeNull()
    expect(
      (container.querySelector('[data-testid="composer-suggestion-panel"]') as HTMLElement).style
        .maxHeight
    ).toBe('96px')
    expect(listBranches).toHaveBeenCalledWith({ target })
    expect(container.textContent).toContain('审查未提交的更改')
    expect(container.textContent).toContain('基于基础分支进行审查')
    expect(container.textContent).toContain('origin/main')
    expect(container.textContent).toContain('codex/review-ui')

    await act(async () => {
      clickButton(container, '审查未提交的更改')
      await flushAsync()
    })
    expect(onSubmit).toHaveBeenCalledWith({ type: 'uncommitted' })

    await act(async () => {
      clickButton(container, 'codex/review-ui')
      await flushAsync()
    })
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'base-branch',
      sourceBranch: 'feature',
      baseBranch: 'codex/review-ui'
    })
  })

  it('retries a failed branch request without hiding the uncommitted option', async () => {
    listBranches
      .mockRejectedValueOnce(new Error('Git unavailable'))
      .mockResolvedValueOnce(branchSummary())

    await act(async () => {
      root.render(<ComposerCodeReviewCommandContent target={target} onSubmit={vi.fn()} />)
      await flushAsync()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Git unavailable')
    expect(container.textContent).toContain('审查未提交的更改')

    await act(async () => {
      container
        .querySelector('button[aria-label="重试加载 Git 分支"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushAsync()
    })

    expect(listBranches).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('origin/main')
  })
})
