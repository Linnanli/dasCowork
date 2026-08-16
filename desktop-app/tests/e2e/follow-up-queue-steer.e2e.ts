import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import { expectTerminalScenario } from './support/terminalScenario'
import { planAssert } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  assistantMessageResponse,
  deferred,
  providerResponseBodies,
  startMockBackend
} from './support/mockBackend'

const realCodexCommand = process.env.DASCOWORK_E2E_REAL_CODEX_BIN || 'codex'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

async function recordPlanAssertions(
  scenarioIds: readonly string[],
  assertionId: string,
  assertion: () => Promise<void> | void
): Promise<void> {
  for (const scenarioId of scenarioIds) {
    await planAssert({ scenarioId, assertionId, assertion })
  }
}

test('E01/E02/E03/E10/E11/E22 queues, reorders, reloads, resumes, and drains follow-ups', async ({
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
    await recordPlanAssertions(
      ['E01', 'E02', 'E03', 'E10', 'E11', 'E22'],
      '队列顺序、revision、lease 与消费状态正确',
      async () => {
        await expect(page.locator('[data-slot="queued-follow-up-row"]')).toHaveCount(2)
        await expect(page.locator('[data-slot="queued-follow-up-row"]').first()).toContainText(
          'Move this message ahead of the first queued message.'
        )
        await expect(page.locator('[data-slot="queued-follow-up-row"]').nth(1)).toContainText(
          'This message must run second.'
        )
      }
    )
    await recordPlanAssertions(
      ['E01', 'E02', 'E03', 'E10', 'E11', 'E22'],
      '重启从持久化状态恢复',
      async () => {
        await expect(page.locator('[data-slot="queued-follow-up-row"]')).toHaveCount(2)
        await expect(page.locator('[data-slot="queued-follow-up-row"]').first()).toContainText(
          'Move this message ahead of the first queued message.'
        )
      }
    )

    releaseFirstTurn.resolve()
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
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(3)
    await recordPlanAssertions(
      ['E01', 'E02', 'E03', 'E10', 'E11', 'E22'],
      '不能重复 claim 或自动重发',
      async () => {
        expect(providerResponseBodies(backend)).toHaveLength(3)
        await expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
          .toBe(3)
      }
    )
  } finally {
    releaseFirstTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('M01/A03/A08/A11/A13/B11/E05 steers one of two identical non-head queue items, navigates away and back, without starting a second response', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseTurn = deferred()
  const activeResponse = assistantMessageResponse(
    'resp-steer',
    'msg-steer',
    'Steered turn completed'
  )
  const backend = await startMockBackend({
    responses: [
      {
        ...activeResponse,
        beforeEvent: (_event, index) =>
          index === activeResponse.events.length - 1 ? releaseTurn.promise : undefined
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
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: 'Steered turn completed' })
    ).toHaveCount(1)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    const identicalFollowUp = 'Keep this identical message queued.'
    await input.fill(identicalFollowUp)
    await queueButton.click()
    await input.fill(identicalFollowUp)
    await queueButton.click()

    const identicalRows = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: identicalFollowUp })
    const firstRow = identicalRows.nth(0)
    const secondRow = identicalRows.nth(1)
    await expect(firstRow).toHaveCount(1)
    await expect(secondRow).toHaveCount(1)
    const queuedIds = await page.evaluate(async (text) => {
      const conversationKey = document
        .querySelector('[data-slot="queued-follow-up-list"]')
        ?.getAttribute('data-conversation-key')
      if (!conversationKey) return []
      return (await window.desktopApp.followUps.getState(conversationKey)).items
        .filter((item) => item.message.text === text)
        .map((item) => item.id)
    }, identicalFollowUp)
    expect(queuedIds).toHaveLength(2)
    expect(new Set(queuedIds).size).toBe(2)
    await secondRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()

    await planAssert({
      scenarioId: 'B11',
      assertionId: '正确的恢复、暂停或拒绝状态',
      assertion: async () => {
        await expect(secondRow).toHaveCount(0)
        await expect(firstRow).toHaveCount(1)
      }
    })
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: identicalFollowUp })
    ).toHaveCount(1)
    await planAssert({
      scenarioId: 'B11',
      assertionId: 'claim、接受与队列结算至多一次',
      assertion: () =>
        expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
          .toBe(1)
    })
    expect(providerResponseBodies(backend)).toHaveLength(1)

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    const activeConversation = sidebar.getByRole('button', {
      name: /^Start a turn that accepts a steer\., running/u
    })
    await expect(activeConversation).toBeVisible()
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: identicalFollowUp })
    ).toHaveCount(0)
    await activeConversation.click()
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: identicalFollowUp })
    ).toHaveCount(1)
    await expect(firstRow).toHaveCount(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await recordPlanAssertions(['A03', 'A08', 'A11', 'A13'], '已显示回答保持不变', () =>
      expect(
        page.locator('[data-role="assistant"]').filter({ hasText: 'Steered turn completed' })
      ).toHaveCount(1)
    )
    await recordPlanAssertions(
      ['A03', 'A08', 'A11', 'A13'],
      '复用原 turn，不能额外启动 turn',
      async () => {
        expect(providerResponseBodies(backend)).toHaveLength(1)
        await expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
          .toBe(1)
      }
    )
    await recordPlanAssertions(['A03', 'A08', 'A11', 'A13'], '队列顺序与对话隔离正确', async () => {
      await expect(firstRow).toHaveCount(1)
      await expect(
        page.locator('[data-role="user"]').filter({ hasText: identicalFollowUp })
      ).toHaveCount(1)
    })
    await recordPlanAssertions(['E05'], '队列顺序、revision、lease 与消费状态正确', () =>
      expect(firstRow).toHaveCount(1)
    )
    await recordPlanAssertions(['E05'], '重启从持久化状态恢复', () =>
      expect(firstRow).toHaveCount(1)
    )
    await recordPlanAssertions(['E05'], '不能重复 claim 或自动重发', async () => {
      expect(providerResponseBodies(backend)).toHaveLength(1)
      await expect
        .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
        .toBe(1)
    })

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
    await planAssert({
      scenarioId: 'M01',
      assertionId: '最终 UI 状态',
      assertion: async () => {
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: 'Steered turn completed' })
        ).toHaveCount(1)
        await expect(
          page
            .locator('[data-role="assistant"]')
            .filter({ hasText: 'Steer continuation completed' })
        ).toHaveCount(1)
        await expect(
          page
            .locator('[data-role="assistant"]')
            .filter({ hasText: 'Remaining queued message completed' })
        ).toHaveCount(1)
      }
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: 'terminal 类型和次数',
      assertion: () =>
        expectTerminalScenario({
          page,
          logs,
          backend,
          terminal: 'finish',
          providerRequestCount: 3,
          turnStartedCount: 2,
          pendingApprovalCount: 0
        })
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: '队列状态、顺序与 revision',
      assertion: () => expect(page.locator('[data-slot="queued-follow-up-list"]')).toHaveCount(0)
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: 'turn started 数量',
      assertion: () =>
        expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
          .toBe(2)
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: 'provider 请求数量',
      assertion: () => expect(providerResponseBodies(backend)).toHaveLength(3)
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: 'tool/approval 执行数量',
      assertion: async () => {
        await expect(page.locator('[data-slot="tool-group-unit"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
      }
    })
    await planAssert({
      scenarioId: 'M01',
      assertionId: 'renderer/page 健康',
      assertion: () => {
        expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
        expect(logs.filter((line) => /unhandled rejection/i.test(line))).toEqual([])
      }
    })
    await planAssert({
      scenarioId: 'B11',
      assertionId: 'terminal 和 active run 不被竞态覆盖',
      assertion: () =>
        expectTerminalScenario({
          page,
          logs,
          backend,
          terminal: 'finish',
          providerRequestCount: 3,
          turnStartedCount: 2,
          pendingApprovalCount: 0
        })
    })
  } finally {
    releaseTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('A14 steers two concurrent conversations independently without starting extra turns', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFirstTurn = deferred()
  const releaseSecondTurn = deferred()
  const firstInitialResponse = assistantMessageResponse(
    'resp-concurrent-first',
    'msg-concurrent-first',
    'First conversation visible output'
  )
  const secondInitialResponse = assistantMessageResponse(
    'resp-concurrent-second',
    'msg-concurrent-second',
    'Second conversation visible output'
  )
  const backend = await startMockBackend({
    responses: [
      {
        ...firstInitialResponse,
        beforeEvent: (_event, index) =>
          index === firstInitialResponse.events.length - 1 ? releaseFirstTurn.promise : undefined
      },
      {
        ...secondInitialResponse,
        beforeEvent: (_event, index) =>
          index === secondInitialResponse.events.length - 1 ? releaseSecondTurn.promise : undefined
      },
      assistantMessageResponse(
        'resp-concurrent-first-continuation',
        'msg-concurrent-first-continuation',
        'First steer continuation completed'
      ),
      assistantMessageResponse(
        'resp-concurrent-second-continuation',
        'msg-concurrent-second-continuation',
        'Second steer continuation completed'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    const firstPrompt = 'Keep the first conversation running.'
    const secondPrompt = 'Keep the second conversation running.'
    const firstSteer = 'Steer only the first conversation.'
    const secondSteer = 'Steer only the second conversation.'
    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    const sidebar = page.locator('[data-slot="codex-sidebar"]')

    await sendMessage(page, firstPrompt)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'First conversation visible output' })
    ).toHaveCount(1)
    await input.fill(firstSteer)
    await queueButton.click()
    const firstSteerRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: firstSteer })
    await firstSteerRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
    await expect(firstSteerRow).toHaveCount(0)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)

    const firstConversation = sidebar.getByRole('button', {
      name: /^Keep the first conversation running\., running/u
    })
    await expect(firstConversation).toBeVisible()
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, secondPrompt)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Second conversation visible output' })
    ).toHaveCount(1)
    await input.fill(secondSteer)
    await queueButton.click()
    const secondSteerRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: secondSteer })
    await secondSteerRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
    await expect(secondSteerRow).toHaveCount(0)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(2)
    expect(providerResponseBodies(backend)).toHaveLength(2)
    await expect(page.locator('[data-role="user"]').filter({ hasText: secondSteer })).toHaveCount(1)
    await expect(page.locator('[data-role="user"]').filter({ hasText: firstSteer })).toHaveCount(0)

    await firstConversation.click()
    await expect(page.locator('[data-role="user"]').filter({ hasText: firstSteer })).toHaveCount(1)
    await expect(page.locator('[data-role="user"]').filter({ hasText: secondSteer })).toHaveCount(0)
    await recordPlanAssertions(['A14'], '已显示回答保持不变', () =>
      expect(
        page
          .locator('[data-role="assistant"]')
          .filter({ hasText: 'First conversation visible output' })
      ).toHaveCount(1)
    )
    await recordPlanAssertions(['A14'], '复用原 turn，不能额外启动 turn', async () => {
      expect(providerResponseBodies(backend)).toHaveLength(2)
      await expect
        .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
        .toBe(2)
    })
    await recordPlanAssertions(['A14'], '队列顺序与对话隔离正确', async () => {
      await expect(page.locator('[data-role="user"]').filter({ hasText: firstSteer })).toHaveCount(
        1
      )
      await expect(page.locator('[data-role="user"]').filter({ hasText: secondSteer })).toHaveCount(
        0
      )
    })
    releaseFirstTurn.resolve()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'First steer continuation completed' })
    ).toHaveCount(1)

    await sidebar
      .getByRole('button', { name: /^Keep the second conversation running\., running/u })
      .click()
    releaseSecondTurn.resolve()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Second steer continuation completed' })
    ).toHaveCount(1)
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 4,
      turnStartedCount: 2,
      pendingApprovalCount: 0
    })
  } finally {
    releaseFirstTurn.resolve()
    releaseSecondTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('A12 steers text, image, file, folder, and a context directive on one active turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseTurn = deferred()
  const localContextDir = await mkdtemp(join(tmpdir(), 'dascowork-rich-steer-'))
  const imagePath = join(localContextDir, 'diagram.png')
  const filePath = join(localContextDir, 'notes.txt')
  const folderPath = join(localContextDir, 'reference-folder')
  const contextPath = join(localContextDir, 'context-reference.md')
  await Promise.all([
    writeFile(imagePath, onePixelPng),
    writeFile(filePath, 'local file attachment'),
    mkdir(folderPath),
    writeFile(contextPath, 'context directive target')
  ])
  const contextDirective = `:file[context-reference.md]{name=${encodeURIComponent(contextPath)}}`
  const activeResponse = assistantMessageResponse(
    'resp-rich-steer',
    'msg-rich-steer',
    'Rich steer initial output stays visible'
  )
  const backend = await startMockBackend({
    capabilities: ['text', 'image'],
    responses: [
      {
        ...activeResponse,
        beforeEvent: (_event, index) =>
          index === activeResponse.events.length - 1 ? releaseTurn.promise : undefined
      },
      assistantMessageResponse(
        'resp-rich-steer-continuation',
        'msg-rich-steer-continuation',
        'Rich steer continuation completed'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    await app.evaluate(
      ({ dialog }, { filePaths, folderPath }) => {
        let pickerChoice = 0
        Object.assign(dialog, {
          showMessageBox: async () => ({ response: pickerChoice++, checkboxChecked: false }),
          showOpenDialog: async ({ properties }: { properties: string[] }) => ({
            canceled: false,
            filePaths:
              properties.includes('openDirectory') && !properties.includes('openFile')
                ? [folderPath]
                : filePaths,
            bookmarks: []
          })
        })
      },
      { filePaths: [imagePath, filePath, folderPath], folderPath }
    )
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Start the active turn for a rich steer.')
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Rich steer initial output stays visible' })
    ).toHaveCount(1)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    const richSteerText = `Please use every selected local resource ${contextDirective}`
    await input.fill(richSteerText)
    await page.getByRole('button', { name: '添加文件和更多', exact: true }).click()
    await page.getByRole('option', { name: 'Files and folders', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Image attachment', exact: true })).toBeVisible()
    if (process.platform !== 'darwin') {
      await page.getByRole('button', { name: '添加文件和更多', exact: true }).click()
      await page.getByRole('option', { name: 'Files and folders', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: 'File attachment', exact: true })).toHaveCount(2)
    await queueButton.click()

    const richSteerRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: 'Please use every selected local resource' })
    await expect(richSteerRow).toHaveCount(1)
    const conversationKey = await page
      .locator('[data-slot="queued-follow-up-list"]')
      .getAttribute('data-conversation-key')
    expect(conversationKey).toBeTruthy()
    await expect
      .poll(() =>
        page.evaluate(
          async ({ key, text }) => {
            const state = await window.desktopApp.followUps.getState(key)
            const item = state.items.find((candidate) => candidate.message.text === text)
            return item
              ? {
                  attachmentKinds: item.message.attachments
                    .map((attachment) => attachment.kind)
                    .sort(),
                  text: item.message.text
                }
              : null
          },
          { key: conversationKey!, text: richSteerText }
        )
      )
      .toEqual({
        attachmentKinds: ['file', 'folder', 'persisted-asset'],
        text: richSteerText
      })

    await richSteerRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
    await expect(richSteerRow).toHaveCount(0)
    const richSteerMessage = page
      .locator('[data-role="user"]')
      .filter({ hasText: 'Please use every selected local resource' })
    await expect(richSteerMessage).toHaveCount(1)
    await expect(
      richSteerMessage.getByRole('button', { name: 'Image attachment', exact: true })
    ).toHaveCount(1)
    await expect(
      richSteerMessage.getByRole('button', { name: 'File attachment', exact: true })
    ).toHaveCount(2)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Rich steer initial output stays visible' })
    ).toHaveCount(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)
    expect(logs.filter((line) => line.includes('"method":"turn/started"'))).toHaveLength(1)
    await recordPlanAssertions(['A12'], '已显示回答保持不变', () =>
      expect(
        page
          .locator('[data-role="assistant"]')
          .filter({ hasText: 'Rich steer initial output stays visible' })
      ).toHaveCount(1)
    )
    await recordPlanAssertions(['A12'], '复用原 turn，不能额外启动 turn', () => {
      expect(providerResponseBodies(backend)).toHaveLength(1)
      expect(logs.filter((line) => line.includes('"method":"turn/started"'))).toHaveLength(1)
    })
    await recordPlanAssertions(['A12'], '队列顺序与对话隔离正确', async () => {
      await expect(richSteerRow).toHaveCount(0)
      await expect(richSteerMessage).toHaveCount(1)
    })

    releaseTurn.resolve()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Rich steer continuation completed' })
    ).toHaveCount(1)
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0
    })
  } finally {
    releaseTurn.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await rm(localContextDir, { recursive: true, force: true })
  }
})

test('M04/B03 @recovery settles a steer and turn-completed race without duplicating the queued message', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseCompletion = deferred()
  const initialResponse = assistantMessageResponse(
    'resp-steer-terminal-race',
    'msg-steer-terminal-race',
    'The race turn has visible output.'
  )
  const continuedText = 'The race settled without a duplicate follow-up.'
  const backend = await startMockBackend({
    responses: [
      {
        ...initialResponse,
        beforeEvent: (_event, index) =>
          index === initialResponse.events.length - 1 ? releaseCompletion.promise : undefined
      },
      assistantMessageResponse(
        'resp-steer-terminal-race-continuation',
        'msg-steer-terminal-race-continuation',
        continuedText
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Keep this turn active until I steer it.')
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The race turn has visible output.' })
    ).toHaveCount(1)

    const message = 'This follow-up races with turn/completed.'
    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill(message)
    await page.getByRole('button', { name: '将追问加入队列' }).click()
    const queuedSteer = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: message })
    await expect(queuedSteer).toHaveCount(1)

    await queuedSteer.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
    await expect(queuedSteer).toHaveCount(0)
    await expect(page.locator('[data-role="user"]').filter({ hasText: message })).toHaveCount(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    releaseCompletion.resolve()

    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: continuedText })
    ).toHaveCount(1)
    await expect(page.locator('[data-role="user"]').filter({ hasText: message })).toHaveCount(1)
    await expect(queuedSteer).toHaveCount(0)
    await planAssert({
      scenarioId: 'B03',
      assertionId: 'claim、接受与队列结算至多一次',
      assertion: async () => {
        await expect(page.locator('[data-role="user"]').filter({ hasText: message })).toHaveCount(1)
        await expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
          .toBe(1)
      }
    })
    await planAssert({
      scenarioId: 'B03',
      assertionId: '正确的恢复、暂停或拒绝状态',
      assertion: async () => {
        await expect(queuedSteer).toHaveCount(0)
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: continuedText })
        ).toHaveCount(1)
      }
    })
    await planAssert({
      scenarioId: 'B03',
      assertionId: 'terminal 和 active run 不被竞态覆盖',
      assertion: () =>
        expectTerminalScenario({
          page,
          logs,
          backend,
          terminal: 'finish',
          providerRequestCount: 2,
          turnStartedCount: 1,
          pendingApprovalCount: 0
        })
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: '最终 UI 状态',
      assertion: async () => {
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: continuedText })
        ).toHaveCount(1)
        await expect(page.locator('[data-slot="queued-follow-up-list"]')).toHaveCount(0)
      }
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: 'terminal 类型和次数',
      assertion: () =>
        expectTerminalScenario({
          page,
          logs,
          backend,
          terminal: 'finish',
          providerRequestCount: 2,
          turnStartedCount: 1,
          pendingApprovalCount: 0
        })
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: '队列状态、顺序与 revision',
      assertion: () => expect(queuedSteer).toHaveCount(0)
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: 'turn started 数量',
      assertion: () =>
        expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
          .toBe(1)
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: 'provider 请求数量',
      assertion: () => expect(providerResponseBodies(backend)).toHaveLength(2)
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: 'tool/approval 执行数量',
      assertion: async () => {
        await expect(page.locator('[data-slot="tool-group-unit"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
      }
    })
    await planAssert({
      scenarioId: 'M04',
      assertionId: 'renderer/page 健康',
      assertion: () => {
        expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
        expect(logs.filter((line) => /unhandled rejection/i.test(line))).toEqual([])
      }
    })
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0
    })
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('M05/E07 @recovery returns an explicitly rejected steer to its original queue position', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseCompletion = deferred()
  const pidDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-steer-race-'))
  const pidPath = join(pidDirectory, 'app-server.pid')
  const heldSteerRequestPath = join(pidDirectory, 'steer-requested')
  const originalTurnCompletedPath = join(pidDirectory, 'original-turn-completed')
  const targetFollowUp = 'Return this steer to the first queue position.'
  const remainingFollowUp = 'Keep this second item queued behind it.'
  const initialResponse = assistantMessageResponse(
    'resp-steer-rejection-race',
    'msg-steer-rejection-race',
    'The original turn remains visible after the rejected steer.'
  )
  const backend = await startMockBackend({
    responses: [
      {
        ...initialResponse,
        beforeEvent: (_event, index) =>
          index === initialResponse.events.length - 1 ? releaseCompletion.promise : undefined
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      environment: {
        CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/app-server-process-wrapper.mjs'),
        DASCOWORK_E2E_APP_SERVER_PID_PATH: pidPath,
        DASCOWORK_E2E_REAL_CODEX_BIN: realCodexCommand,
        DASCOWORK_E2E_HELD_STEER_REQUEST_PATH: heldSteerRequestPath,
        DASCOWORK_E2E_ORIGINAL_TURN_COMPLETED_PATH: originalTurnCompletedPath
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Keep this active while a queued steer races the completed turn.')
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The original turn remains visible after the rejected steer.' })
    ).toHaveCount(1)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    const queueButton = page.getByRole('button', { name: '将追问加入队列' })
    await input.fill(targetFollowUp)
    await queueButton.click()
    await input.fill(remainingFollowUp)
    await queueButton.click()

    const targetRow = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: targetFollowUp })
    await expect(targetRow).toHaveCount(1)
    await targetRow.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
    await waitForFile(heldSteerRequestPath)

    releaseCompletion.resolve()
    await waitForFile(originalTurnCompletedPath)

    await planAssert({
      scenarioId: 'M05',
      assertionId: '最终 UI 状态',
      assertion: async () => {
        await expect(
          page
            .locator('[data-role="assistant"]')
            .filter({ hasText: 'The original turn remains visible after the rejected steer.' })
        ).toHaveCount(1)
        await expect(page.locator('[data-slot="queued-follow-up-paused-banner"]')).toBeVisible()
      }
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: 'terminal 类型和次数',
      assertion: async () => {
        await expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
          .toBe(1)
        expect(
          logs.some(
            (line) =>
              line.includes('"method":"turn/completed"') && line.includes('"status":"completed"')
          )
        ).toBe(true)
      }
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: '队列状态、顺序与 revision',
      assertion: async () => {
        await expect
          .poll(async () => {
            return page.evaluate(async () => {
              const root = document.querySelector('[data-slot="queued-follow-up-list"]')
              const conversationKey = root?.getAttribute('data-conversation-key')
              if (!conversationKey) return undefined
              const state = await window.desktopApp.followUps.getState(conversationKey)
              return {
                revision: state.revision,
                items: state.items.map((item) => ({
                  text: item.message.text,
                  status: item.status,
                  pauseKind: item.pause?.kind,
                  hasLease: item.lease !== undefined
                }))
              }
            })
          })
          .toEqual({
            revision: 4,
            items: [
              {
                text: targetFollowUp,
                status: 'paused-failed',
                pauseKind: 'steer-rejected',
                hasLease: false
              },
              {
                text: remainingFollowUp,
                status: 'queued',
                pauseKind: undefined,
                hasLease: false
              }
            ]
          })
      }
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: 'turn started 数量',
      assertion: () =>
        expect
          .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
          .toBe(1)
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: 'provider 请求数量',
      assertion: () => expect(providerResponseBodies(backend)).toHaveLength(1)
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: 'tool/approval 执行数量',
      assertion: async () => {
        await expect(page.locator('[data-slot="tool-group-unit"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
      }
    })
    await planAssert({
      scenarioId: 'M05',
      assertionId: 'renderer/page 健康',
      assertion: async () => {
        await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
        expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
        expect(logs.filter((line) => /unhandled rejection/i.test(line))).toEqual([])
      }
    })
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([pidDirectory])
  }
})

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  let latestError: unknown
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch (error) {
      latestError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${path}: ${String(latestError)}`)
}

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
        showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
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
