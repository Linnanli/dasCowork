// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceRecoveryBanner } from './WorkspaceRecoveryBanner'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('WorkspaceRecoveryBanner', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('offers Restore only for a verified restorable managed worktree', async () => {
    const restoreWorkspace = vi.fn().mockResolvedValue({ state: 'available' })
    installProjects({ state: 'restorable', restoreWorkspace })

    await renderBanner()
    expect(container.textContent).toContain('原工作区可恢复')
    expect(button('恢复工作区')).not.toBeNull()

    await act(async () => button('恢复工作区')?.click())
    expect(restoreWorkspace).toHaveBeenCalledWith({ conversationId: 'conversation_1', threadId: 'thread_1' })
    expect(container.querySelector('[data-slot="workspace-recovery-banner"]')).toBeNull()
  })

  it('shows only Retry when checking the workspace fails', async () => {
    const getWorkspaceRecovery = vi
      .fn()
      .mockResolvedValueOnce({ state: 'checking-failed', message: '无法检查原工作区。请重试。' })
      .mockResolvedValueOnce({ state: 'checking-failed', message: '无法检查原工作区。请重试。' })
    const restoreWorkspace = vi.fn()
    installProjects({ getWorkspaceRecovery, restoreWorkspace })

    await renderBanner()
    expect(button('重试检查')).not.toBeNull()
    expect(button('恢复工作区')).toBeNull()
    await act(async () => button('重试检查')?.click())
    expect(getWorkspaceRecovery).toHaveBeenCalledTimes(2)
    expect(restoreWorkspace).not.toHaveBeenCalled()
  })

  it('lets a gone workspace enter a new local task without changing the old run', async () => {
    const onCreateNewTask = vi.fn()
    installProjects({ state: 'gone' })

    await renderBanner(onCreateNewTask)
    expect(container.textContent).toContain('原工作区已不可用')
    await act(async () => button('新建任务')?.click())
    expect(onCreateNewTask).toHaveBeenCalledTimes(1)
  })

  it('keeps a restore failure visible and retryable', async () => {
    const restoreWorkspace = vi
      .fn()
      .mockResolvedValueOnce({ state: 'restore-failed', message: '恢复工作区失败。请重试，或选择项目后新建任务。' })
      .mockResolvedValueOnce({ state: 'available' })
    installProjects({ state: 'restorable', restoreWorkspace })

    await renderBanner()
    await act(async () => button('恢复工作区')?.click())
    expect(container.textContent).toContain('恢复工作区失败')
    expect(button('恢复工作区')).not.toBeNull()
    await act(async () => button('恢复工作区')?.click())
    expect(restoreWorkspace).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-slot="workspace-recovery-banner"]')).toBeNull()
  })

  async function renderBanner(onCreateNewTask = vi.fn()): Promise<void> {
    await act(async () => {
      root.render(
        <WorkspaceRecoveryBanner
          conversationId="conversation_1"
          threadId="thread_1"
          onCreateNewTask={onCreateNewTask}
        />
      )
    })
  }

  function button(label: string): HTMLButtonElement | null {
    return [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ?? null
  }
})

function installProjects({
  state = 'restorable',
  getWorkspaceRecovery = vi.fn().mockResolvedValue({ state }),
  restoreWorkspace = vi.fn().mockResolvedValue({ state: 'available' })
}: {
  state?: string
  getWorkspaceRecovery?: ReturnType<typeof vi.fn>
  restoreWorkspace?: ReturnType<typeof vi.fn>
} = {}): void {
  vi.stubGlobal('desktopApp', {
    projects: { getWorkspaceRecovery, restoreWorkspace }
  })
}
