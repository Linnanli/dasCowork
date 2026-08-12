// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReviewFileGroup, ReviewWorkspaceController } from './reviewWorkspaceTypes'
import { ReviewFileBlock } from './ReviewFileBlock'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ReviewFileBlock', () => {
  let container: HTMLDivElement
  let copyPath: ReturnType<typeof vi.fn>
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    copyPath = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copyPath }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders a shadcn skeleton while a section diff is loading', async () => {
    await act(async () => {
      root.render(<ReviewFileBlock controller={loadingController()} group={loadingGroup} />)
    })

    const skeleton = container.querySelector<HTMLElement>('[aria-label="正在加载差异"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('Loading diff...')
  })

  it('keeps hover actions beside file statistics and shows icon-only file operations at the far end', async () => {
    const controller = loadingController()
    await act(async () => {
      root.render(<ReviewFileBlock controller={controller} group={loadingGroup} />)
    })

    const fileName = container.querySelector<HTMLElement>('[data-review-file-name]')
    const hoverActions = container.querySelector<HTMLElement>('[data-review-file-header-actions]')
    const operationActions = container.querySelector<HTMLElement>(
      '[data-review-file-header-operation-actions]'
    )

    expect(fileName?.className).toContain('[direction:rtl]')
    expect(fileName?.getAttribute('title')).toBe('src/example.ts')
    expect(fileName?.parentElement?.nextElementSibling?.textContent).toBe('+2 -1')
    expect(fileName?.parentElement?.nextElementSibling?.nextElementSibling).toBe(hoverActions)
    expect(hoverActions?.className).toContain('group-hover/diff-header:opacity-100')
    expect(hoverActions?.querySelectorAll('button')).toHaveLength(3)
    expect(hoverActions?.textContent).toBe('')
    expect(operationActions?.parentElement?.lastElementChild).toBe(operationActions)
    expect(operationActions?.className).toContain('ml-auto')
    expect(operationActions?.className).not.toContain('opacity-0')
    expect(operationActions?.querySelectorAll('button')).toHaveLength(1)
    expect(operationActions?.textContent).toBe('')
    expect(container.textContent).not.toContain('未暂存')
    expect(container.textContent).not.toContain('已修改')

    const stageButton =
      operationActions?.querySelector<HTMLButtonElement>('[aria-label="暂存未暂存文件"]')
    const revertButton = operationActions?.querySelector<HTMLButtonElement>(
      '[aria-label="还原未暂存文件更改"]'
    )
    expect(stageButton?.title).toBe('暂存文件')
    expect(stageButton?.querySelector('svg')?.classList.contains('lucide-plus')).toBe(true)
    expect(revertButton).toBeNull()

    await act(async () => {
      stageButton?.click()
      hoverActions?.querySelector<HTMLButtonElement>('[aria-label="复制文件路径"]')?.click()
      hoverActions?.querySelector<HTMLButtonElement>('[aria-label="收起文件差异"]')?.click()
    })

    expect(controller.applyFileAction).toHaveBeenCalledWith(
      loadingGroup,
      loadingGroup.sections[0],
      'stage'
    )
    expect(copyPath).toHaveBeenCalledWith('src/example.ts')
    expect(controller.setCollapsed).toHaveBeenCalledWith(expect.any(String), true)
  })

  it('hides unstage and revert file actions in the uncommitted review', async () => {
    await act(async () => {
      root.render(<ReviewFileBlock controller={loadingController()} group={stagedGroup} />)
    })

    expect(container.querySelector('[aria-label="取消暂存已暂存文件"]')).toBeNull()
    expect(container.querySelector('[aria-label="还原已暂存文件更改"]')).toBeNull()
  })

  it('shows the unstage action with a minus icon and its file-specific tooltip', async () => {
    await act(async () => {
      root.render(
        <ReviewFileBlock controller={loadingController({ type: 'staged' })} group={stagedGroup} />
      )
    })

    const unstageButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="取消暂存已暂存文件"]'
    )
    expect(unstageButton?.title).toBe('对文件取消暂存')
    expect(unstageButton?.querySelector('svg')?.classList.contains('lucide-minus')).toBe(true)
  })
})

const loadingGroup: ReviewFileGroup = {
  path: 'src/example.ts',
  additions: 2,
  deletions: 1,
  treeStatus: 'modified',
  sections: [
    {
      kind: 'snapshot',
      backendSource: { type: 'unstaged' },
      snapshotGeneration: 'generation',
      file: {
        path: 'src/example.ts',
        changeKind: 'modified',
        revision: 'revision',
        additions: 2,
        deletions: 1,
        binary: false,
        conflicted: false
      },
      key: 'section',
      loadState: { status: 'loading' }
    }
  ]
}

const stagedGroup: ReviewFileGroup = {
  ...loadingGroup,
  sections: [
    {
      kind: 'snapshot',
      backendSource: { type: 'staged' },
      snapshotGeneration: 'generation',
      file: {
        path: 'src/example.ts',
        changeKind: 'modified',
        revision: 'revision',
        additions: 2,
        deletions: 1,
        binary: false,
        conflicted: false
      },
      key: 'section',
      loadState: { status: 'loading' }
    }
  ]
}

function loadingController(
  displaySource: ReviewWorkspaceController['displaySource'] = { type: 'uncommitted' }
): ReviewWorkspaceController {
  return {
    selectedPath: undefined,
    displaySource,
    preferences: { collapsedKeys: [], skipRevertConfirmation: false },
    search: { currentIndex: -1, matches: [] },
    isMutationDisabled: vi.fn(() => false),
    setCollapsed: vi.fn(),
    applyFileAction: vi.fn(),
    applyHunkAction: vi.fn()
  } as unknown as ReviewWorkspaceController
}
