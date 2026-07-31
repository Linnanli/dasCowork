// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalGitChangeEvent } from '../../../../shared/localGitApi'
import { LocalGitReviewPanel } from './LocalGitReviewPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const target = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

describe('LocalGitReviewPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    window.desktopApp = {
      git: {
        getReviewSnapshot: vi.fn(async () => ({
          snapshotGeneration: 'generation',
          gitRoot: '/repo',
          source: { type: 'unstaged' },
          files: [
            {
              path: 'src/a.ts',
              changeKind: 'modified',
              revision: 'revision',
              additions: 2,
              deletions: 1,
              binary: false,
              conflicted: false
            }
          ],
          stagedFileCount: 0,
          unstagedFileCount: 1,
          largeDiff: false
        })),
        refreshReviewFiles: vi.fn(async () => ({
          snapshotGeneration: 'refreshed-generation',
          files: [
            {
              path: 'src/a.ts',
              changeKind: 'modified',
              revision: 'refreshed-revision',
              additions: 1,
              deletions: 1,
              binary: false,
              conflicted: false
            }
          ]
        })),
        listCommits: vi.fn(async () => [
          { sha: 'a'.repeat(40), subject: 'Fix review picker', committedAt: 1_700_000_000 }
        ]),
        listBranches: vi.fn(async () => ({
          current: 'feature/review',
          defaultBase: 'main',
          local: ['main', 'feature/review'],
          recent: ['feature/review'],
          uncommittedFileCount: 0
        })),
        getFileDiff: vi.fn(async () => ({
          snapshotGeneration: 'generation',
          file: {},
          diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-before\n+after\n',
          truncated: false,
          binary: false,
          conflicted: false
        })),
        applyReviewAction: vi.fn(async () => ({
          status: 'success',
          appliedPaths: ['src/a.ts'],
          skippedPaths: [],
          conflictedPaths: []
        }))
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
  })

  it('loads an unstaged snapshot, file diff, and exposes the scoped actions', async () => {
    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-slot="local-git-review-panel"]')).not.toBeNull()
    expect(container.textContent).toContain('src/a.ts')
    expect(container.textContent).toContain('Stage')
    expect(container.textContent).toContain('Revert')
    expect(container.textContent).toContain('Review options')
    expect(container.querySelector('[data-slot="diff-viewer"]')).not.toBeNull()

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage hunk 1')
        ?.click()
      await Promise.resolve()
    })
    expect(window.desktopApp.git.applyReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stage', scope: 'hunk', hunkIndex: 0 })
    )

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Revert hunk 1')
        ?.click()
      await Promise.resolve()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll('button')]
        .filter((button) => button.textContent === 'Revert')
        .at(-1)
        ?.click()
      await Promise.resolve()
    })
    expect(window.desktopApp.git.applyReviewAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'revert', scope: 'hunk', hunkIndex: 0 })
    )
  })

  it('P004-EDGE-02 renders an empty repository snapshot and keeps review controls available', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    const onSourceChange = vi.fn()
    getReviewSnapshot.mockResolvedValueOnce({
      snapshotGeneration: 'empty-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [],
      stagedFileCount: 0,
      unstagedFileCount: 0,
      largeDiff: false
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={onSourceChange}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('No unstaged changes')
    const staged = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Staged'
    )
    expect(staged).toBeDefined()
    const refresh = container.querySelector<HTMLButtonElement>('[aria-label="Refresh changes"]')
    expect(refresh?.disabled).toBe(false)
    await act(async () => staged?.click())
    expect(onSourceChange).toHaveBeenCalledWith({ type: 'staged' })
  })

  it('freezes the selected file target when revert confirmation opens', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValue({
      snapshotGeneration: 'frozen-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [
        {
          path: 'src/a.ts',
          previousPath: 'src/previous-a.ts',
          changeKind: 'renamed',
          revision: 'revision-a',
          additions: 2,
          deletions: 1,
          binary: false,
          conflicted: false
        },
        {
          path: 'src/b.ts',
          changeKind: 'modified',
          revision: 'revision-b',
          additions: 1,
          deletions: 1,
          binary: false,
          conflicted: false
        }
      ],
      stagedFileCount: 0,
      unstagedFileCount: 2,
      largeDiff: false
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Revert hunk 1')
        ?.click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain('Revert changes?')

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('src/b.ts'))
        ?.click()
      ;[...document.body.querySelectorAll('button')]
        .filter((button) => button.textContent === 'Revert')
        .at(-1)
        ?.click()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.applyReviewAction).toHaveBeenLastCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'frozen-generation',
      action: 'revert',
      scope: 'hunk',
      hunkIndex: 0,
      files: [{ path: 'src/a.ts', previousPath: 'src/previous-a.ts', revision: 'revision-a' }]
    })
  })

  it('sends the complete signed snapshot file set for a section action', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValue({
      snapshotGeneration: 'section-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [
        {
          path: 'src/selected.ts',
          changeKind: 'modified',
          revision: 'selected-revision',
          additions: 1,
          deletions: 1,
          binary: false,
          conflicted: false
        },
        {
          path: 'src/renamed.ts',
          previousPath: 'src/previous.ts',
          changeKind: 'renamed',
          revision: 'renamed-revision',
          additions: 2,
          deletions: 1,
          binary: false,
          conflicted: false
        }
      ],
      stagedFileCount: 0,
      unstagedFileCount: 2,
      largeDiff: false
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('src/renamed.ts'))
        ?.click()
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage section')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.applyReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stage',
        scope: 'section',
        files: [
          { path: 'src/selected.ts', revision: 'selected-revision' },
          {
            path: 'src/renamed.ts',
            previousPath: 'src/previous.ts',
            revision: 'renamed-revision'
          }
        ]
      })
    )
  })

  it('disables section actions that exceed the signed IPC file limit', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValue({
      snapshotGeneration: 'too-many-files',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: Array.from({ length: 501 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        changeKind: 'modified' as const,
        revision: `revision-${index}`,
        additions: 1,
        deletions: 0,
        binary: false,
        conflicted: false
      })),
      stagedFileCount: 0,
      unstagedFileCount: 501,
      largeDiff: true
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const sectionAction = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stage section'
    )
    expect(sectionAction?.disabled).toBe(true)
    expect(sectionAction?.getAttribute('title')).toBe(
      'A section can contain at most 500 files. Select individual files instead.'
    )
  })

  it('keeps the common source picker affordances visible', async () => {
    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'staged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Unstaged')
    expect(container.textContent).toContain('Staged')
    expect(container.textContent).toContain('Commit')
    expect(container.textContent).toContain('Branch')
    expect(container.textContent).toContain('Last turn')
    expect(container.textContent).toContain('Collapse all diffs')

    const unstaged = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Unstaged'
    )
    const staged = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Staged'
    )
    unstaged?.focus()
    await act(async () => {
      unstaged?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement).toBe(staged)
  })

  it('keeps a large diff as a file summary until the user selects a file', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValueOnce({
      snapshotGeneration: 'large-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [
        {
          path: 'large.txt',
          changeKind: 'modified',
          revision: 'large-revision',
          additions: 1,
          deletions: 1,
          binary: false,
          conflicted: false
        }
      ],
      stagedFileCount: 0,
      unstagedFileCount: 1,
      largeDiff: true
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Diff too large to display. Select a file.')
    expect(container.querySelector('[data-slot="diff-viewer"]')).toBeNull()
    expect(container.textContent).toContain('Stage section')
    expect(container.textContent).toContain('Revert section')
  })

  it('P004-EDGE-04/P004-EDGE-05/P004-EDGE-06/P004-EDGE-07/P004-EDGE-08/P004-EDGE-12 identifies renamed, copied, type-changed, binary, gitlink, and conflicted files', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValueOnce({
      snapshotGeneration: 'status-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [
        {
          path: 'renamed.txt',
          previousPath: 'original.txt',
          changeKind: 'renamed',
          revision: 'rename-revision',
          additions: 0,
          deletions: 0,
          binary: false,
          conflicted: false
        },
        {
          path: 'image.bin',
          changeKind: 'modified',
          revision: 'binary-revision',
          additions: 0,
          deletions: 0,
          binary: true,
          conflicted: false
        },
        {
          path: 'copied.txt',
          previousPath: 'original.txt',
          changeKind: 'copied',
          revision: 'copy-revision',
          additions: 1,
          deletions: 0,
          binary: false,
          conflicted: false
        },
        {
          path: 'typed.txt',
          changeKind: 'type-change',
          revision: 'type-revision',
          additions: 0,
          deletions: 0,
          binary: false,
          conflicted: false
        },
        {
          path: 'vendor/submodule',
          changeKind: 'added',
          revision: 'gitlink-revision',
          additions: 1,
          deletions: 0,
          binary: false,
          conflicted: false
        },
        {
          path: 'conflicted.txt',
          changeKind: 'unmerged',
          revision: 'conflict-revision',
          additions: 0,
          deletions: 0,
          binary: false,
          conflicted: true
        }
      ],
      stagedFileCount: 0,
      unstagedFileCount: 2,
      largeDiff: false
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Renamed from original.txt')
    expect(container.textContent).toContain('Copied from original.txt')
    expect(container.textContent).toContain('type change')
    expect(container.textContent).toContain('Binary')
    expect(container.textContent).toContain('vendor/submodule')
    expect(container.textContent).toContain('Conflicted')

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('image.bin'))
        ?.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Binary file cannot be displayed.')
  })

  it('P004-EDGE-09/P004-EDGE-10 rejects a stale mutation, refreshes the panel, and does not retry the write', async () => {
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    const refreshReviewFiles = window.desktopApp.git.refreshReviewFiles as ReturnType<typeof vi.fn>
    applyReviewAction.mockResolvedValueOnce({
      status: 'error',
      errorCode: 'stale-snapshot',
      appliedPaths: [],
      skippedPaths: [],
      conflictedPaths: []
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(applyReviewAction).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Failed to stage')
    expect(refreshReviewFiles).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      paths: ['src/a.ts']
    })
  })

  it('P004-EDGE-13 keeps partial-success feedback and conflict paths visible after refreshing the snapshot', async () => {
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValue({
      snapshotGeneration: 'generation',
      gitRoot: '/repo',
      source: { type: 'staged' },
      files: [
        {
          path: 'src/a.ts',
          changeKind: 'modified',
          revision: 'revision',
          additions: 2,
          deletions: 1,
          binary: false,
          conflicted: false
        }
      ],
      stagedFileCount: 1,
      unstagedFileCount: 0,
      largeDiff: false
    })
    applyReviewAction.mockResolvedValueOnce({
      status: 'partial-success',
      errorCode: 'patch-apply-failed',
      appliedPaths: ['src/a.ts'],
      skippedPaths: [],
      conflictedPaths: ['src/a.ts']
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'staged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Revert')
        ?.click()
      await Promise.resolve()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll('button')]
        .filter((button) => button.textContent === 'Revert')
        .at(-1)
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Applied: src/a.ts · Conflicts: src/a.ts')
  })

  it('shows success feedback after applying a review action', async () => {
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    const onGitOperationFeedback = vi.fn()
    applyReviewAction.mockResolvedValueOnce({
      status: 'success',
      appliedPaths: ['src/a.ts'],
      skippedPaths: [],
      conflictedPaths: []
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
          onGitOperationFeedback={onGitOperationFeedback}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onGitOperationFeedback).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Staged successfully'
    })
  })

  it('refreshes the union of paths reported by a review mutation', async () => {
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    applyReviewAction.mockResolvedValueOnce({
      status: 'partial-success',
      appliedPaths: ['src/a.ts'],
      skippedPaths: ['src/skipped.ts'],
      conflictedPaths: ['src/conflicted.ts']
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.refreshReviewFiles).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      paths: ['src/a.ts', 'src/conflicted.ts', 'src/skipped.ts']
    })
  })

  it('falls back to the frozen new and previous paths when a mutation has no result', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    getReviewSnapshot.mockResolvedValue({
      snapshotGeneration: 'renamed-generation',
      gitRoot: '/repo',
      source: { type: 'unstaged' },
      files: [
        {
          path: 'src/a.ts',
          previousPath: 'src/previous-a.ts',
          changeKind: 'renamed',
          revision: 'renamed-revision',
          additions: 1,
          deletions: 1,
          binary: false,
          conflicted: false
        }
      ],
      stagedFileCount: 0,
      unstagedFileCount: 1,
      largeDiff: false
    })
    applyReviewAction.mockRejectedValueOnce(new Error('Git write failed'))

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.refreshReviewFiles).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'renamed-generation',
      paths: ['src/a.ts', 'src/previous-a.ts']
    })
  })

  it('shows failure feedback after a review action is rejected', async () => {
    const applyReviewAction = window.desktopApp.git.applyReviewAction as ReturnType<typeof vi.fn>
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    const onGitOperationFeedback = vi.fn()
    applyReviewAction.mockResolvedValueOnce({
      status: 'error',
      errorCode: 'patch-apply-failed',
      appliedPaths: [],
      skippedPaths: ['src/a.ts'],
      conflictedPaths: []
    })

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
          onGitOperationFeedback={onGitOperationFeedback}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Stage')
        ?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onGitOperationFeedback).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Failed to stage'
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Failed to stage')
    expect(getReviewSnapshot).toHaveBeenCalledTimes(1)
    expect(window.desktopApp.git.refreshReviewFiles).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      paths: ['src/a.ts']
    })
  })

  it('refreshes only paths reported by repository change events', async () => {
    let notify: ((event: LocalGitChangeEvent) => void) | undefined
    window.desktopApp.git.subscribe = vi.fn((callback) => {
      notify = callback
      return vi.fn()
    })
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>

    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      notify?.({
        target,
        snapshotGeneration: 'watch-generation',
        changeTypes: ['working-tree'],
        changedPaths: ['src/a.ts']
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getReviewSnapshot).toHaveBeenCalledTimes(1)
    expect(window.desktopApp.git.refreshReviewFiles).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      paths: ['src/a.ts']
    })
  })

  it('loads commit and branch choices from the local Git bridge instead of accepting free text', async () => {
    const onSourceChange = vi.fn()
    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          target={target}
          source={{ type: 'unstaged' }}
          onClose={vi.fn()}
          onSourceChange={onSourceChange}
        />
      )
      await Promise.resolve()
    })

    const click = async (label: string): Promise<void> => {
      await act(async () => {
        ;[...container.querySelectorAll('button')]
          .find((button) => button.textContent?.trim().startsWith(label))
          ?.click()
        await Promise.resolve()
      })
    }

    await click('Commit')
    expect(container.textContent).toContain('Fix review picker')
    await click('Fix review picker')
    expect(onSourceChange).toHaveBeenLastCalledWith({ type: 'commit', commitSha: 'a'.repeat(40) })

    await click('Branch')
    expect(container.textContent).toContain('feature/review')
    await click('main')
    expect(onSourceChange).toHaveBeenLastCalledWith({ type: 'branch', baseBranch: 'main' })
    expect(container.querySelector('input[aria-label="Commit SHA"]')).toBeNull()
  })

  it('renders a completed turn from its recorded patch without requesting a Git snapshot', async () => {
    const getReviewSnapshot = window.desktopApp.git.getReviewSnapshot as ReturnType<typeof vi.fn>
    await act(async () => {
      root.render(
        <LocalGitReviewPanel
          open
          source={{ type: 'last-turn', turnId: 'turn-1' }}
          lastTurn={{
            turnId: 'turn-1',
            files: [
              {
                path: 'src/changed.ts',
                diff: 'diff --git a/src/changed.ts b/src/changed.ts\n--- a/src/changed.ts\n+++ b/src/changed.ts\n@@ -1 +1 @@\n-before\n+after\n',
                additions: 1,
                deletions: 1
              }
            ]
          }}
          onClose={vi.fn()}
          onSourceChange={vi.fn()}
        />
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('src/changed.ts')
    expect(container.querySelector('[data-slot="diff-viewer"]')).not.toBeNull()
    expect(getReviewSnapshot).not.toHaveBeenCalled()
  })
})
