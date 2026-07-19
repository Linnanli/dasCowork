import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import { attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { sendMessage } from './support/chatActions'
import {
  assistantMessageResponse,
  deferred,
  providerResponseBodies,
  startMockBackend
} from './support/mockBackend'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

test('queues a running follow-up and starts it after the active turn finishes', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFirstTurn = deferred()
  const backend = await startMockBackend({
    responses: [
      {
        ...assistantMessageResponse(
          'resp-follow-up-first',
          'msg-follow-up-first',
          'First turn completed'
        ),
        beforeResponse: () => releaseFirstTurn.promise
      },
      assistantMessageResponse(
        'resp-follow-up-second',
        'msg-follow-up-second',
        'Reordered follow-up completed first'
      ),
      assistantMessageResponse(
        'resp-follow-up-third',
        'msg-follow-up-third',
        'Original first follow-up completed second'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Start a turn that waits for my follow-up.')
    await expect
      .poll(() => logs.some((line) => line.includes('"method":"turn/started"')))
      .toBe(true)
    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill('This message must run second.')

    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    await expect(queueButton).toBeEnabled()
    await queueButton.click()
    await input.fill('Move this message ahead of the first queued message.')
    await queueButton.click()
    await expect(page.locator('[data-slot="queued-follow-up-list"]')).toContainText(
      'This message must run second.'
    )

    const originalFirstRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'This message must run second.' })
    const reorderedFirstRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Move this message ahead of the first queued message.' })
    await reorderedFirstRow
      .locator('[data-slot="queued-follow-up-drag-handle"]')
      .dragTo(originalFirstRow)
    await expect(page.locator('[data-slot="queued-follow-up-row"]').first()).toContainText(
      'Move this message ahead of the first queued message.'
    )
    await page.screenshot({
      path: testInfo.outputPath('queue-two-items.png'),
      animations: 'disabled'
    })
    const conversationKey = await page
      .locator('[data-slot="queued-follow-up-list"]')
      .getAttribute('data-conversation-key')
    expect(conversationKey).toBeTruthy()
    await expect
      .poll(() =>
        page.evaluate(async (key) => {
          const state = await window.desktopApp.followUps.getState(key)
          return state.items.map((item) => item.message.text)
        }, conversationKey!)
      )
      .toEqual([
        'Move this message ahead of the first queued message.',
        'This message must run second.'
      ])

    await page.reload()
    await page
      .locator('[data-slot="codex-sidebar"]')
      .getByRole('button', { name: /^Start a turn that waits for my follow-up\./u })
      .click()
    await expect(page.locator('[data-slot="queued-follow-up-row"]').first()).toContainText(
      'Move this message ahead of the first queued message.'
    )
    await expect(page.locator('[data-slot="queued-follow-up-row"]').nth(1)).toContainText(
      'This message must run second.'
    )

    releaseFirstTurn.resolve()
    await expect(page.locator('[data-slot="queued-follow-up-paused-banner"]')).toBeVisible()
    await page.getByRole('button', { name: 'Resume follow-up queue' }).click()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Reordered follow-up completed first' })
    ).toHaveCount(1)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Original first follow-up completed second' })
    ).toHaveCount(1)
    await expect(page.locator('[data-slot="queued-follow-up-list"]')).toHaveCount(0)
    expect(providerResponseBodies(backend)).toHaveLength(3)
  } finally {
    releaseFirstTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('steers the selected non-head queue item without starting a second response', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseTurn = deferred()
  const backend = await startMockBackend({
    responses: [
      {
        ...assistantMessageResponse('resp-steer', 'msg-steer', 'Steered turn completed'),
        beforeResponse: () => releaseTurn.promise
      },
      assistantMessageResponse(
        'resp-steer-continuation',
        'msg-steer-continuation',
        'Steer continuation completed'
      ),
      assistantMessageResponse(
        'resp-remaining-queue',
        'msg-remaining-queue',
        'Remaining queued message completed'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Start a turn that accepts a steer.')
    await expect
      .poll(() => logs.some((line) => line.includes('"method":"turn/started"')))
      .toBe(true)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    await input.fill('Keep this message queued first.')
    await queueButton.click()
    await input.fill('Steer this second queued message now.')
    await queueButton.click()

    const firstRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Keep this message queued first.' })
    const secondRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Steer this second queued message now.' })
    await expect(firstRow).toHaveCount(1)
    await expect(secondRow).toHaveCount(1)
    await secondRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()

    await expect(secondRow).toHaveCount(0)
    await expect(firstRow).toHaveCount(1)
    await expect(
      page
        .locator('[data-role="user"]')
        .filter({ hasText: 'Steer this second queued message now.' })
    ).toHaveCount(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)

    releaseTurn.resolve()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: 'Steered turn completed' })
    ).toHaveCount(1)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: 'Steer continuation completed' })
    ).toHaveCount(1)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Remaining queued message completed' })
    ).toHaveCount(1)
    await expect(page.locator('[data-slot="queued-follow-up-list"]')).toHaveCount(0)
    expect(providerResponseBodies(backend)).toHaveLength(3)
  } finally {
    releaseTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('edits a queued message in the composer and closes queueing without clearing rows', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseTurn = deferred()
  const localContextDir = await mkdtemp(join(tmpdir(), 'dascowork-follow-up-edit-'))
  const imagePath = join(localContextDir, 'queued-edit.png')
  await writeFile(imagePath, onePixelPng)
  const backend = await startMockBackend({
    capabilities: ['text', 'image'],
    responses: [
      {
        ...assistantMessageResponse(
          'resp-edit-queue',
          'msg-edit-queue',
          'Edited queue turn completed'
        ),
        beforeResponse: () => releaseTurn.promise
      },
      assistantMessageResponse('resp-edit-steer', 'msg-edit-steer', 'Edited queue steer completed'),
      assistantMessageResponse(
        'resp-edit-remaining',
        'msg-edit-remaining',
        'Remaining edit queue completed'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    await app.evaluate(({ dialog }, filePath) => {
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
      })
    }, imagePath)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Start a turn while I edit the queue.')
    await expect
      .poll(() => logs.some((line) => line.includes('"method":"turn/started"')))
      .toBe(true)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    await input.fill('Edit this queued message.')
    await page.getByRole('button', { name: '添加文件和更多', exact: true }).click()
    await page.getByRole('option', { name: 'Files and folders', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Image attachment', exact: true })).toBeVisible()
    await queueButton.click()
    const editingRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Edit this queued message.' })
    await expect(editingRow).toHaveCount(1)
    await input.fill('Keep this other queued message.')
    await queueButton.click()

    const stableItemId = await editingRow.getAttribute('data-item-id')
    expect(stableItemId).toBeTruthy()

    await editingRow.getByRole('button', { name: /更多操作/u }).click()
    await page.getByRole('menuitem', { name: '编辑消息' }).click()
    await expect(editingRow).toHaveCount(0)
    await expect(input).toHaveText('Edit this queued message.')
    await expect(page.getByRole('button', { name: 'Image attachment', exact: true })).toBeVisible()

    await input.fill('Edited queued message.')
    await page.getByRole('button', { name: '保存编辑后的排队消息' }).click()
    const editedRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Edited queued message.' })
    await expect(editedRow).toHaveAttribute('data-item-id', stableItemId!)

    await editedRow.getByRole('button', { name: /删除第 \d+ 条排队消息/u }).click()
    await expect(editedRow).toHaveCount(0)

    const remainingRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Keep this other queued message.' })
    await page.screenshot({
      path: testInfo.outputPath('queue-one-item.png'),
      animations: 'disabled'
    })
    await remainingRow.getByRole('button', { name: /更多操作/u }).click()
    await page.getByRole('menuitem', { name: '关闭排队' }).click()
    await expect(remainingRow).toHaveCount(1)

    await input.fill('Steer after queueing is closed.')
    await page.getByRole('button', { name: '立即调整当前任务' }).click()
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)

    await remainingRow.getByRole('button', { name: /更多操作/u }).click()
    await page.getByRole('menuitem', { name: '开启排队' }).click()
    await input.fill('Queue after queueing is reopened.')
    await page.getByRole('button', { name: '将追问加入队列' }).click()
    await expect(
      page
        .locator('[data-slot="queued-follow-up-row"]')
        .filter({ hasText: 'Queue after queueing is reopened.' })
    ).toHaveCount(1)
  } finally {
    releaseTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await rm(localContextDir, { recursive: true, force: true })
  }
})
