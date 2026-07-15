import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import { assistantMessageResponse, startMockBackend } from './support/mockBackend'

const draftStorageKey = 'das-cowork.conversation-drafts.v2'

test('restores per-thread drafts after restart but keeps scroll restoration session-only', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const userDataDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-persistent-user-data-'))
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-persistent-codex-home-'))
  const runId = Date.now().toString(36)
  const firstPrompt = `state-first-${runId}`
  const secondPrompt = `state-second-${runId}`
  const firstDraft = `unsent first draft ${runId}`
  const secondDraft = `unsent second draft ${runId}`
  const firstTail = `state first response tail ${runId}`
  const longFirstResponse = `${Array.from(
    { length: 120 },
    (_, index) => `Paragraph ${index + 1}: multi-conversation scroll state ${runId}.`
  ).join('\n\n')}\n\n${firstTail}`
  const secondResponse = `state second response ${runId}`
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('resp-state-first', 'msg-state-first', longFirstResponse),
      assistantMessageResponse('resp-state-second', 'msg-state-second', secondResponse)
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  const launchPersistentApp = (): Promise<ElectronApplication> =>
    launchApp(backend, logs, {
      userDataDir,
      codexHomeDir,
      preserveDataDirectories: true
    })

  try {
    app = await launchPersistentApp()
    let page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)
    await expect(page.locator('[data-role="assistant"]')).toContainText(firstTail)

    let sidebar = page.locator('[data-slot="codex-sidebar"]')
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, secondPrompt)
    await expect(page.locator('[data-role="assistant"]')).toContainText(secondResponse)

    let contextPanel = await openComposerContextPanel(page)
    await expect(contextPanel.getByRole('option').filter({ hasText: firstPrompt })).toHaveCount(1)
    await expect(contextPanel.getByRole('option').filter({ hasText: secondPrompt })).toHaveCount(0)
    await page.keyboard.press('Escape')

    let input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill(secondDraft)
    await expectDraftStorageToContain(page, secondDraft)

    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    contextPanel = await openComposerContextPanel(page)
    await expect(contextPanel.getByRole('option').filter({ hasText: secondPrompt })).toHaveCount(1)
    await expect(contextPanel.getByRole('option').filter({ hasText: firstPrompt })).toHaveCount(0)
    await page.keyboard.press('Escape')
    input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill(firstDraft)
    await expectDraftStorageToContain(page, firstDraft)

    let viewport = page.locator('[data-slot="aui_thread-viewport"]')
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(300)
    const scrollTarget = await viewport.evaluate((element) => {
      const target = Math.min(180, element.scrollHeight - element.clientHeight - 80)
      element.style.scrollBehavior = 'auto'
      element.scrollTop = target
      return target
    })
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrollTarget)
    const savedScrollTop = await viewport.evaluate((element) => element.scrollTop)

    await sidebar.getByRole('button', { name: new RegExp(`^${secondPrompt}`) }).click()
    await expect(input).toHaveText(secondDraft)
    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    await expect(input).toHaveText(firstDraft)
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(savedScrollTop - 40)
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeLessThan(savedScrollTop + 40)

    await closeApp(app)
    app = undefined

    app = await launchPersistentApp()
    page = await app.firstWindow()
    collectRendererLogs(page, logs)
    sidebar = page.locator('[data-slot="codex-sidebar"]')
    input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    viewport = page.locator('[data-slot="aui_thread-viewport"]')

    await sidebar.getByRole('button', { name: new RegExp(`^${secondPrompt}`) }).click()
    await expect(input).toHaveText(secondDraft)
    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    await expect(input).toHaveText(firstDraft)
    await expect(page.locator('[data-role="assistant"]')).toContainText(firstTail)

    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeLessThan(40)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([userDataDir, codexHomeDir])
  }
})

async function openComposerContextPanel(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '添加文件和更多', exact: true }).click()
  const panel = page.getByRole('listbox', { name: '添加上下文' })
  await expect(panel).toBeVisible()
  return panel
}

async function expectDraftStorageToContain(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  draft: string
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ key, expectedDraft }) =>
          window.localStorage.getItem(key)?.includes(expectedDraft) ?? false,
        { key: draftStorageKey, expectedDraft: draft }
      )
    )
    .toBe(true)
}
