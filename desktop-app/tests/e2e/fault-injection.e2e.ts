import { mkdtemp, readFile } from 'node:fs/promises'
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
import { sendMessage } from './support/chatActions'
import { planAssert } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  deferred,
  providerResponseBodies,
  responseCompleted,
  responseCreated,
  startMockBackend
} from './support/mockBackend'

test('C22/G11 @terminal-failure keeps the canonical turn alive when a renderer reload closes its MessagePort', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseCompletion = deferred()
  const partialText = 'Visible output survives the renderer reload.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-message-port-reload'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-message-port-reload',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-message-port-reload',
              content: [{ type: 'output_text', text: partialText }]
            }
          },
          responseCompleted('resp-message-port-reload')
        ],
        beforeEvent: (_event, index) => (index === 4 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Reload after partial output without cancelling the canonical turn.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    const activeConversation = await page.evaluate(async () => {
      const selectedIdentity = window.sessionStorage.getItem('das-cowork.active-conversation.v1')
      const conversations = await window.desktopApp.conversations.getConversationList()
      return { selectedIdentity, conversations: conversations.conversations }
    })
    expect(
      activeConversation.conversations.some(
        (conversation) =>
          conversation.id === activeConversation.selectedIdentity ||
          conversation.threadId === activeConversation.selectedIdentity
      )
    ).toBe(true)

    await page.reload()
    collectRendererLogs(page, logs)
    releaseCompletion.resolve()

    await expect.poll(() => providerResponseBodies(backend).length).toBe(1)
    await planAssert({
      scenarioId: 'G11',
      assertionId: '错误、取消、完成竞态只进入单终态',
      assertion: async () => {
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(0)
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
      scenarioId: 'C22',
      assertionId: '保留可见内容并显示单一终态',
      assertion: async () => {
        await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
      }
    })
    await planAssert({
      scenarioId: 'C22',
      assertionId: 'terminal 只结算一次且 Composer 恢复',
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
        await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
      }
    })
    await planAssert({
      scenarioId: 'C22',
      assertionId: '无自动重试、额外请求或迟到事件应用',
      assertion: () => {
        expect(providerResponseBodies(backend)).toHaveLength(1)
        expect(logs.filter((line) => line.includes('"method":"turn/interrupt"'))).toHaveLength(0)
      }
    })
    await planAssert({
      scenarioId: 'G11',
      assertionId: '资源、并发和终态无残留',
      assertion: () => {
        expect(logs.filter((line) => line.includes('"method":"turn/completed"'))).toHaveLength(1)
        expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
      }
    })
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('C23 @terminal-failure crashes the active Desktop shared app-server transport and rebuilds it for retry', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const pidDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-app-server-pid-'))
  const pidPath = join(pidDirectory, 'app-server.pid')
  const partialText = 'Visible output remains after the app-server process exits.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-transport-crash'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-transport-crash',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          responseCompleted('resp-transport-crash')
        ],
        beforeEvent: (_event, index) =>
          index === 3 ? new Promise<never>(() => undefined) : undefined
      },
      {
        events: [
          responseCreated('resp-transport-retry'),
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-transport-retry',
              content: [{ type: 'output_text', text: 'The rebuilt transport completed the retry.' }]
            }
          },
          responseCompleted('resp-transport-retry')
        ]
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
        DASCOWORK_E2E_REAL_APP_SERVER_BIN: join(
          appRoot,
          '.bundle-resources',
          'codex-app-server',
          process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
        )
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(
      page,
      'Keep partial output visible while the app-server process is terminated.'
    )
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)

    const appServerPid = await readAppServerPid(pidPath)
    process.kill(appServerPid, 'SIGKILL')

    await planAssert({
      scenarioId: 'C23',
      assertionId: '保留可见内容并显示单一终态',
      assertion: async () => {
        await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(1)
      }
    })
    await planAssert({
      scenarioId: 'C23',
      assertionId: 'terminal 只结算一次且 Composer 恢复',
      assertion: async () => {
        await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
        await expect(
          page.locator('.aui-lexical-input[contenteditable="true"]').last()
        ).toBeEditable()
      }
    })
    await planAssert({
      scenarioId: 'C23',
      assertionId: '无自动重试、额外请求或迟到事件应用',
      assertion: () => expect(providerResponseBodies(backend)).toHaveLength(1)
    })

    await page.locator('[data-slot="aui_assistant-message-retry"]').click()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The rebuilt transport completed the retry.' })
    ).toHaveCount(1)
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect.poll(() => providerResponseBodies(backend).length).toBe(2)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(2)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([pidDirectory])
  }
})

async function readAppServerPid(pidPath: string): Promise<number> {
  const deadline = Date.now() + 10_000
  let latestError: unknown
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt((await readFile(pidPath, 'utf8')).trim(), 10)
      if (Number.isSafeInteger(pid) && pid > 0) return pid
      latestError = new Error(`Invalid app-server pid in ${pidPath}`)
    } catch (error) {
      latestError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(
    `Timed out waiting for the test wrapper to report the app-server PID: ${String(latestError)}`
  )
}
