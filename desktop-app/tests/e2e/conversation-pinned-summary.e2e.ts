import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'
import { assistantMessageResponse, startMockBackend } from './support/mockBackend'

const execFile = promisify(execFileCallback)

test('opens the conversation summary through the real Git and review paths', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-conversation-summary-'))
  const backend = await startMockBackend({
    responses: [assistantMessageResponse('summary', 'summary-message', 'Thread ready')]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'notes.txt'), 'after\nmore\n', 'utf8')
    await writeFile(join(projectRoot, 'staged.txt'), 'staged one\nstaged two\n', 'utf8')
    await execFile('git', ['add', 'staged.txt'], { cwd: projectRoot })
    await execFile('git', ['branch', 'feature/summary-menu'], { cwd: projectRoot })
    const branch = await gitOutput(projectRoot, ['branch', '--show-current'])

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await page.setViewportSize({ width: 1054, height: 484 })
    await createLocalProject(page, `Summary E2E ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open the conversation summary.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openSummary(page)
    const panel = page.locator('[data-slot="conversation-pinned-summary"]')
    await expect(panel).toContainText('环境信息')
    await expect(panel).toContainText('+4')
    await expect(panel).toContainText('-1')
    await expect(panel.locator('[data-slot="conversation-pinned-summary-branch"]')).toContainText(
      branch
    )
    await expect(panel).not.toContainText('无法获取拉取请求状态')
    await expect(panel).not.toContainText('比较分支')

    await panel.locator('[data-slot="conversation-pinned-summary-worktree"]').hover()
    const worktreeSubmenu = page.locator(
      '[data-slot="conversation-pinned-summary-worktree-submenu"]'
    )
    await expect(worktreeSubmenu).toHaveAttribute('data-side', 'left')
    await expect(worktreeSubmenu).toContainText('继续使用')
    await expect(worktreeSubmenu).toContainText('本地检出')
    await expect(worktreeSubmenu).toContainText('云端')
    await expect(
      worktreeSubmenu.locator('[data-slot="conversation-execution-target-remote"]')
    ).toBeDisabled()
    await expect(
      worktreeSubmenu.locator('[data-slot="conversation-execution-target-remote"]')
    ).toHaveAttribute(
      'title',
      '当前任务没有可切换的对应执行位置。已开始的任务暂不支持切换执行位置。'
    )

    await worktreeSubmenu.focus()
    await page.keyboard.press('Escape')
    await expect(worktreeSubmenu).not.toBeVisible()
    await expect(panel).toBeVisible()
    await panel.locator('[data-slot="conversation-pinned-summary-branch"]').hover()
    const branchSubmenu = page.locator('[data-slot="conversation-pinned-summary-branch-submenu"]')
    await expect(branchSubmenu).toHaveAttribute('data-side', 'left')
    await expect(branchSubmenu).toContainText('feature/summary-menu')
    await branchSubmenu.getByRole('textbox', { name: 'Search branches' }).fill('summary-menu')
    await expect(branchSubmenu).toContainText('feature/summary-menu')

    await branchSubmenu.focus()
    await page.keyboard.press('Escape')
    await expect(branchSubmenu).not.toBeVisible()
    await expect(panel).toBeVisible()
    await panel.locator('[data-slot="conversation-pinned-summary-changes"]').click()
    const review = page.locator('[data-slot="review-workspace"]')
    await expect(review).toContainText('notes.txt')
    await expect(review).toContainText('staged.txt')

    await expect(panel).not.toBeVisible()
    await openSummary(page)
    await panel.locator('[data-slot="conversation-pinned-summary-commit"]').click()
    const dialog = page.locator('[data-slot="commit-or-push-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('提交信息').fill('Summary panel commit')
    await dialog.locator('button[data-action="commit"]').click()
    await expect
      .poll(() => gitOutput(projectRoot, ['log', '-1', '--format=%s']))
      .toBe('Summary panel commit')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

async function openSummary(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '切换置顶摘要', exact: true })
  const panel = page.locator('[data-slot="conversation-pinned-summary"]')
  if (await panel.isVisible().catch(() => false)) return
  await trigger.click()
  await expect(panel).toBeVisible()
}

async function initializeGitRepository(projectRoot: string): Promise<void> {
  await execFile('git', ['init'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.name', 'E2E'], { cwd: projectRoot })
  await writeFile(join(projectRoot, 'notes.txt'), 'before\n', 'utf8')
  await execFile('git', ['add', 'notes.txt'], { cwd: projectRoot })
  await execFile('git', ['commit', '-m', 'initial'], { cwd: projectRoot })
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: projectRoot })).stdout.trim()
}
