// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalGitReviewDiffFileContents } from '../../../../../shared/localGitApi'
import { ReviewFileDiff } from './ReviewFileDiff'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type ProcessFileMockResult = {
  name: string
  isPartial: boolean
  additionLines: string[]
  deletionLines: string[]
  hunks: Array<{
    additionStart: number
    additionCount: number
    additionLineIndex: number
    deletionStart: number
    deletionCount: number
    deletionLineIndex: number
    noEOFCRAdditions?: boolean
    noEOFCRDeletions?: boolean
    hunkContent: Array<
      | {
          type: 'context'
          lines: number
          additionLineIndex: number
          deletionLineIndex: number
        }
      | {
          type: 'change'
          additions: number
          deletions: number
          additionLineIndex: number
          deletionLineIndex: number
        }
    >
  }>
}

const processFile = vi.hoisted(() =>
  vi.fn(
    (
      _diff: string,
      options?: {
        oldFile?: { contents: string }
        newFile?: { contents: string }
      }
    ): ProcessFileMockResult => {
      const isFull = options?.oldFile !== undefined && options.newFile !== undefined
      const splitLines = (contents: string): string[] => contents.match(/[^\n]*\n|[^\n]+/gu) ?? []
      const additionLines = isFull
        ? splitLines(options.newFile?.contents ?? '')
        : ['const value = 2\n']
      const deletionLines = isFull
        ? splitLines(options.oldFile?.contents ?? '')
        : ['const value = 1\n']
      return {
        name: 'src/example.ts',
        isPartial: !isFull,
        additionLines,
        deletionLines,
        hunks: [
          {
            additionStart: 1,
            additionCount: 1,
            additionLineIndex: 0,
            deletionStart: 1,
            deletionCount: 1,
            deletionLineIndex: 0,
            hunkContent: [
              {
                type: 'change',
                additions: 1,
                deletions: 1,
                additionLineIndex: 0,
                deletionLineIndex: 0
              }
            ]
          }
        ]
      }
    }
  )
)

vi.mock('@pierre/diffs', () => ({ processFile }))
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({
    className,
    fileDiff,
    lineAnnotations,
    renderAnnotation
  }: {
    className?: string
    fileDiff: { name: string; isPartial: boolean }
    lineAnnotations?: Array<{
      side: 'additions' | 'deletions'
      lineNumber: number
      metadata: { kind: 'hunk-actions'; hunkIndex: number }
    }>
    renderAnnotation?: (annotation: {
      side: 'additions' | 'deletions'
      lineNumber: number
      metadata: { kind: 'hunk-actions'; hunkIndex: number }
    }) => React.ReactNode
  }) =>
    createElement(
      'div',
      { 'data-testid': 'file-diff', 'data-partial': String(fileDiff.isPartial), className },
      fileDiff.name,
      lineAnnotations?.map((annotation, index) =>
        createElement(
          'div',
          {
            key: index,
            'data-annotation-hunk': annotation.metadata.hunkIndex,
            'data-annotation-line-number': annotation.lineNumber,
            'data-annotation-side': annotation.side
          },
          renderAnnotation?.(annotation)
        )
      )
    )
}))

const target = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

describe('ReviewFileDiff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    processFile.mockClear()
    window.desktopApp = {
      git: {
        getReviewDiffFileContents: vi.fn(async () => ({
          status: 'text',
          before: 'const value = 1\nconst stable = true\n',
          after: 'const value = 2\nconst stable = true\n'
        }))
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('loads snapshot-bound files and reparses the patch as expandable full content', async () => {
    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="section"
          diff={
            'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n'
          }
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          fullContentRequest={{
            kind: 'snapshot',
            target,
            source: { type: 'unstaged' },
            snapshotGeneration: 'generation',
            file: { path: 'src/example.ts', revision: 'revision' }
          }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.getReviewDiffFileContents).toHaveBeenCalledWith({
      target,
      source: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      file: { path: 'src/example.ts', revision: 'revision' }
    })
    expect(processFile).toHaveBeenLastCalledWith(
      expect.stringContaining('diff --git a/src/example.ts b/src/example.ts'),
      expect.objectContaining({
        cacheKey: 'section:full',
        oldFile: {
          name: 'src/example.ts',
          contents: 'const value = 1\nconst stable = true\n'
        },
        newFile: {
          name: 'src/example.ts',
          contents: 'const value = 2\nconst stable = true\n'
        }
      })
    )
  })

  it('shows a skeleton until complete snapshot content has loaded', async () => {
    let resolveContents: ((contents: LocalGitReviewDiffFileContents) => void) | undefined
    window.desktopApp.git.getReviewDiffFileContents = vi.fn(
      () =>
        new Promise<LocalGitReviewDiffFileContents>((resolve) => {
          resolveContents = resolve
        })
    ) as never

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="section"
          diff={
            'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n'
          }
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          fullContentRequest={{
            kind: 'snapshot',
            target,
            source: { type: 'unstaged' },
            snapshotGeneration: 'generation',
            file: { path: 'src/example.ts', revision: 'revision' }
          }}
        />
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[aria-label="正在加载差异"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)

    await act(async () => {
      resolveContents?.({
        status: 'text',
        before: 'const value = 1\nconst stable = true\n',
        after: 'const value = 2\nconst stable = true\n'
      })
      await Promise.resolve()
    })

    expect(container.querySelector('[aria-label="正在加载差异"]')).toBeNull()
    expect(container.querySelector('[data-testid="file-diff"]')).not.toBeNull()
  })

  it('falls back to the patch when complete contents do not match the loaded hunk', async () => {
    window.desktopApp.git.getReviewDiffFileContents = vi.fn(async () => ({
      status: 'text',
      before: 'different file contents\n',
      after: 'const value = 2\nconst stable = true\n'
    })) as never

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="section"
          diff={
            'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n'
          }
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          fullContentRequest={{
            kind: 'snapshot',
            target,
            source: { type: 'unstaged' },
            snapshotGeneration: 'generation',
            file: { path: 'src/example.ts', revision: 'revision' }
          }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="file-diff"]')?.getAttribute('data-partial')).toBe(
      'true'
    )
  })

  it('loads complete contents for a completed-turn patch', async () => {
    window.desktopApp.git.getTurnDiffFileContents = vi.fn(async () => ({
      status: 'text',
      before: 'const value = 1\nconst stable = true\n',
      after: 'const value = 2\nconst stable = true\n'
    })) as never

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="turn-section"
          diff={
            'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n'
          }
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          fullContentRequest={{
            kind: 'turn',
            target,
            turnId: 'turn-1',
            path: 'src/example.ts'
          }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.desktopApp.git.getTurnDiffFileContents).toHaveBeenCalledWith({
      target,
      turnId: 'turn-1',
      path: 'src/example.ts'
    })
    expect(processFile).toHaveBeenLastCalledWith(
      expect.stringContaining('diff --git a/src/example.ts b/src/example.ts'),
      expect.objectContaining({
        cacheKey: 'turn-section:full',
        oldFile: { name: 'src/example.ts', contents: 'const value = 1\nconst stable = true\n' },
        newFile: { name: 'src/example.ts', contents: 'const value = 2\nconst stable = true\n' }
      })
    )
  })

  it('renders each hunk action bar as hover-only icon buttons anchored to the diff', async () => {
    const onAction = vi.fn()
    const onRevert = vi.fn()

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="section"
          diff={
            'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n'
          }
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          hunkActions={{ action: 'unstage', onAction, onRevert }}
        />
      )
    })

    const diff = container.querySelector<HTMLElement>('[data-testid="file-diff"]')
    const actions = container.querySelector<HTMLElement>('[data-review-hunk-actions="0"]')
    expect(diff?.className).toContain('group/file-diff')
    expect(actions?.className).toContain('absolute')
    expect(actions?.className).toContain('opacity-0')
    expect(actions?.className).toContain('group-hover/file-diff:opacity-100')
    expect(actions?.querySelectorAll('button')).toHaveLength(2)
    expect(actions?.textContent).toBe('')

    await act(async () => {
      actions?.querySelector<HTMLButtonElement>('[aria-label="还原区块 1"]')?.click()
      actions?.querySelector<HTMLButtonElement>('[aria-label="取消暂存区块 1"]')?.click()
    })

    expect(onRevert).toHaveBeenCalledWith(0)
    expect(onAction).toHaveBeenCalledWith(0)
  })

  it('anchors hunk actions to the last changed line instead of trailing context', async () => {
    processFile.mockReturnValueOnce({
      name: 'src/example.ts',
      isPartial: true,
      additionLines: ['before\n', 'new value\n', 'after 1\n', 'after 2\n', 'after 3\n'],
      deletionLines: ['before\n', 'old value\n', 'after 1\n', 'after 2\n', 'after 3\n'],
      hunks: [
        {
          additionStart: 1,
          additionCount: 5,
          additionLineIndex: 0,
          deletionStart: 1,
          deletionCount: 5,
          deletionLineIndex: 0,
          noEOFCRAdditions: false,
          noEOFCRDeletions: false,
          hunkContent: [
            { type: 'context', lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
            {
              type: 'change',
              additions: 1,
              deletions: 1,
              additionLineIndex: 1,
              deletionLineIndex: 1
            },
            { type: 'context', lines: 3, additionLineIndex: 2, deletionLineIndex: 2 }
          ]
        }
      ]
    })

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="trailing-context"
          diff="patch"
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          hunkActions={{ action: 'unstage', onAction: vi.fn(), onRevert: vi.fn() }}
        />
      )
    })

    const annotation = container.querySelector<HTMLElement>('[data-annotation-hunk="0"]')
    expect(annotation?.dataset.annotationSide).toBe('additions')
    expect(annotation?.dataset.annotationLineNumber).toBe('2')
  })

  it('uses the deletion side and avoids a no-EOF marker when choosing hunk anchors', async () => {
    processFile.mockReturnValueOnce({
      name: 'src/example.ts',
      isPartial: true,
      additionLines: ['added 1\n', 'added 2'],
      deletionLines: ['deleted 1\n', 'deleted 2\n'],
      hunks: [
        {
          additionStart: 10,
          additionCount: 0,
          additionLineIndex: 0,
          deletionStart: 10,
          deletionCount: 2,
          deletionLineIndex: 0,
          noEOFCRAdditions: false,
          noEOFCRDeletions: false,
          hunkContent: [
            {
              type: 'change',
              additions: 0,
              deletions: 2,
              additionLineIndex: 0,
              deletionLineIndex: 0
            }
          ]
        },
        {
          additionStart: 20,
          additionCount: 2,
          additionLineIndex: 0,
          deletionStart: 20,
          deletionCount: 0,
          deletionLineIndex: 0,
          noEOFCRAdditions: true,
          noEOFCRDeletions: false,
          hunkContent: [
            {
              type: 'change',
              additions: 2,
              deletions: 0,
              additionLineIndex: 0,
              deletionLineIndex: 0
            }
          ]
        }
      ]
    })

    await act(async () => {
      root.render(
        <ReviewFileDiff
          cacheKey="anchor-edges"
          diff="patch"
          preferences={{ diffMode: 'unified', lineDiffType: 'word', wrap: false, fullFiles: false }}
          hunkActions={{ action: 'unstage', onAction: vi.fn(), onRevert: vi.fn() }}
        />
      )
    })

    const deletionAnnotation = container.querySelector<HTMLElement>('[data-annotation-hunk="0"]')
    expect(deletionAnnotation?.dataset.annotationSide).toBe('deletions')
    expect(deletionAnnotation?.dataset.annotationLineNumber).toBe('11')

    const noEofAnnotation = container.querySelector<HTMLElement>('[data-annotation-hunk="1"]')
    expect(noEofAnnotation?.dataset.annotationSide).toBe('additions')
    expect(noEofAnnotation?.dataset.annotationLineNumber).toBe('20')
  })
})
