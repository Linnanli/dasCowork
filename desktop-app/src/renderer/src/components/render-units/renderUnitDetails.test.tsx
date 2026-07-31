// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpecialEntryRenderer } from './renderUnitDetails'
import type { AssistantRenderUnit } from '@/lib/assistantRenderUnits'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const reviewTarget = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

const openReview = vi.fn()
const notifyGitOperation = vi.fn()

vi.mock('@/components/local-git-review/LocalGitReviewProvider', () => ({
  useLocalGitReview: () => ({
    target: reviewTarget,
    openReview,
    notifyGitOperation,
    closeReview: vi.fn()
  })
}))

describe('SpecialEntryRenderer turn diff patch actions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    openReview.mockClear()
    notifyGitOperation.mockClear()
    window.desktopApp = {
      git: {
        applyTurnPatch: vi.fn(async () => ({
          status: 'success',
          appliedPaths: ['notes.txt'],
          skippedPaths: [],
          conflictedPaths: []
        }))
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows reapply after undo succeeds', async () => {
    await renderTurnDiff()

    await clickPatchAction('撤销')

    expect(window.desktopApp.git.applyTurnPatch).toHaveBeenCalledWith({
      target: reviewTarget,
      action: 'undo',
      turnId: 'turn-history',
      batches: [
        {
          cwd: '/repo',
          gitRoot: '/repo',
          diff: 'diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n'
        }
      ]
    })
    expect(patchActionButton('重新应用')).toBeInstanceOf(HTMLButtonElement)
    expect(notifyGitOperation).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Changes reverted'
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows undo after reapply succeeds', async () => {
    await renderTurnDiff()
    await clickPatchAction('撤销')
    ;(window.desktopApp.git.applyTurnPatch as ReturnType<typeof vi.fn>).mockClear()

    await clickPatchAction('重新应用')

    expect(window.desktopApp.git.applyTurnPatch).toHaveBeenCalledWith({
      target: reviewTarget,
      action: 'reapply',
      turnId: 'turn-history',
      batches: [
        {
          cwd: '/repo',
          gitRoot: '/repo',
          diff: 'diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n'
        }
      ]
    })
    expect(patchActionButton('撤销')).toBeInstanceOf(HTMLButtonElement)
    expect(notifyGitOperation).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Changes reapplied'
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows failure feedback when undo is rejected', async () => {
    ;(window.desktopApp.git.applyTurnPatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'error',
      errorCode: 'patch-apply-failed',
      appliedPaths: [],
      skippedPaths: ['notes.txt'],
      conflictedPaths: []
    })

    await renderTurnDiff()
    await clickPatchAction('撤销')

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Failed to revert changes'
    )
    expect(notifyGitOperation).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Failed to revert changes'
    })
    expect(patchActionButton('撤销')).toBeInstanceOf(HTMLButtonElement)
  })

  it('shows partial-success feedback when undo only applies some paths', async () => {
    ;(window.desktopApp.git.applyTurnPatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'partial-success',
      errorCode: 'patch-apply-failed',
      appliedPaths: ['notes.txt'],
      skippedPaths: [],
      conflictedPaths: ['src/conflict.ts']
    })

    await renderTurnDiff()
    await clickPatchAction('撤销')

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Applied: notes.txt · Conflicts: src/conflict.ts'
    )
    expect(notifyGitOperation).toHaveBeenCalledWith({
      tone: 'info',
      message: 'Changes partially reverted'
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(patchActionButton('撤销')).toBeInstanceOf(HTMLButtonElement)
  })

  it('shows partial-success feedback when reapply only applies some paths', async () => {
    await renderTurnDiff()
    await clickPatchAction('撤销')
    ;(window.desktopApp.git.applyTurnPatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'partial-success',
      errorCode: 'patch-apply-failed',
      appliedPaths: ['notes.txt'],
      skippedPaths: ['src/skipped.ts'],
      conflictedPaths: []
    })
    notifyGitOperation.mockClear()

    await clickPatchAction('重新应用')

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Applied: notes.txt · Skipped: src/skipped.ts'
    )
    expect(notifyGitOperation).toHaveBeenCalledWith({
      tone: 'info',
      message: 'Changes partially reapplied'
    })
    expect(patchActionButton('重新应用')).toBeInstanceOf(HTMLButtonElement)
  })

  async function renderTurnDiff(): Promise<void> {
    await act(async () => {
      root.render(<SpecialEntryRenderer unit={turnDiffUnit()} />)
      await Promise.resolve()
    })
  }

  async function clickPatchAction(label: string): Promise<void> {
    await act(async () => {
      patchActionButton(label)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function patchActionButton(label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label
    )
  }
})

function turnDiffUnit(): Extract<AssistantRenderUnit, { type: 'entry' }> {
  return {
    type: 'entry',
    key: 'turn-diff:turn-history',
    target: { id: 'turn-history', itemIds: ['turn-history'] },
    partIndex: 0,
    partIndices: [0],
    part: {},
    itemType: 'turnDiff',
    renderMode: 'special',
    item: {
      id: 'turn-diff:turn-history',
      status: 'completed',
      cwd: '/repo',
      patchBatches: [
        {
          cwd: '/repo',
          gitRoot: '/repo',
          diff: 'diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n'
        }
      ],
      files: [{ path: 'notes.txt', diff: '--- a/notes.txt\n+++ b/notes.txt\n-old\n+new\n' }]
    }
  }
}
