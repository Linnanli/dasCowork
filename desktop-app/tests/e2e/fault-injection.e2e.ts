import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
import { planAssert } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  deferred,
  providerResponseBodies,
  responseCompleted,
  responseCreated,
  startMockBackend
} from './support/mockBackend'

const realCodexCommand = process.env.DASCOWORK_E2E_REAL_CODEX_BIN || 'codex'

test('P002-E2E-01 restores the local conversation when reload precedes thread binding', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  const wrapperDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-held-thread-start-'))
  const pidPath = join(wrapperDirectory, 'app-server.pid')
  const heldThreadStartPath = join(wrapperDirectory, 'thread-start-held')
  const releaseThreadStartPath = join(wrapperDirectory, 'thread-start-release')
  const prompt = 'Reload before this new conversation binds its thread.'
  const finalText = 'The original turn resumed after thread binding.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-thread-bound-after-reload'),
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-thread-bound-after-reload',
              content: [{ type: 'output_text', text: finalText }]
            }
          },
          responseCompleted('resp-thread-bound-after-reload')
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
        DASCOWORK_E2E_HELD_THREAD_START_PATH: heldThreadStartPath,
        DASCOWORK_E2E_REAL_CODEX_BIN: realCodexCommand,
        DASCOWORK_E2E_RELEASE_THREAD_START_PATH: releaseThreadStartPath
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await sendMessage(page, prompt)
    await expect
      .poll(async () => readFile(heldThreadStartPath, 'utf8').catch(() => ''))
      .toBe('thread/start\n')
    await expect
      .poll(() =>
        page.evaluate(() => window.sessionStorage.getItem('das-cowork.active-conversation.v1'))
      )
      .not.toBeNull()
    const activeConversationId = await page.evaluate(() =>
      window.sessionStorage.getItem('das-cowork.active-conversation.v1')
    )
    expect(activeConversationId).not.toBeNull()
    const recoverySnapshot = await page.evaluate(
      async (conversationId) =>
        conversationId ? window.desktopApp.chat.getActiveSnapshot?.(conversationId) : null,
      activeConversationId
    )
    expect(recoverySnapshot?.baseMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [expect.objectContaining({ type: 'text', text: prompt })]
        })
      ])
    )

    await page.reload()
    collectRendererLogs(page, logs)
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()
    await writeFile(releaseThreadStartPath, 'release\n', 'utf8')

    await expect(page.getByText(finalText, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    await expect.poll(() => providerResponseBodies(backend).length).toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([wrapperDirectory])
  }
})

test('C22/G11 @terminal-failure keeps the canonical turn alive when a renderer reload closes its MessagePort', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseCompletion = deferred()
  const partialText = 'Visible output survives the renderer reload.'
  const continuedText = ' The replacement renderer receives this live delta.'
  const completedText = `${partialText}${continuedText}`
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
          { type: 'response.output_text.delta', delta: continuedText },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-message-port-reload',
              content: [{ type: 'output_text', text: completedText }]
            }
          },
          responseCompleted('resp-message-port-reload')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
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
    await expect(page.getByText(partialText, { exact: true })).toBeVisible()
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
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: completedText })
        ).toHaveCount(1)
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

test('P002-E2E-05 settles a completed turn that ends while the renderer is detached', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseCompletion = deferred()
  const partialText = 'Output emitted before the detached terminal.'
  const finalText = `${partialText} Final state is recovered from history.`
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-terminal-detached'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-terminal-detached',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          { type: 'response.output_text.delta', delta: ' Final state is recovered from history.' },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-terminal-detached',
              content: [{ type: 'output_text', text: finalText }]
            }
          },
          responseCompleted('resp-terminal-detached')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await sendMessage(page, 'Finish while this renderer is reloading.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)

    const reload = page.reload()
    releaseCompletion.resolve()
    await reload
    collectRendererLogs(page, logs)

    await expect(page.getByText(finalText, { exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    expect(logs.filter((line) => line.includes('"method":"turn/completed"'))).toHaveLength(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-05 preserves replayed output and marks a failed terminal after renderer detach', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseDisconnect = deferred()
  const partialText = 'Partial output emitted before the detached failure.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-terminal-failed-detached'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-terminal-failed-detached',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          { type: 'response.output_text.delta', delta: '' }
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseDisconnect.promise : undefined),
        termination: 'disconnect'
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await sendMessage(page, 'Preserve this partial output when the detached run fails.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)

    const reload = page.reload()
    releaseDisconnect.resolve()
    await reload
    collectRendererLogs(page, logs)

    await expect(page.getByText(partialText, { exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
    expect(
      logs.some(
        (line) => line.includes('"method":"turn/completed"') && line.includes('"status":"failed"')
      )
    ).toBe(true)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseDisconnect.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-05 preserves an interrupted terminal when Stop races renderer reload', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const partialText = 'Partial output remains visible after the detached interruption.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-terminal-interrupted-detached'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-terminal-interrupted-detached',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText }
        ],
        termination: 'hang'
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await sendMessage(page, 'Stop this running turn while the renderer reloads.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)

    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await page.reload()
    collectRendererLogs(page, logs)

    await expect(page.getByText(partialText, { exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
    expect(
      logs.some(
        (line) =>
          line.includes('"method":"turn/completed"') && line.includes('"status":"interrupted"')
      )
    ).toBe(true)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-03 reattaches after a transient MessagePort failure without reloading the page', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const faultDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-message-port-fault-'))
  const faultPath = join(faultDirectory, 'trigger-messageerror')
  const injectedPath = `${faultPath}.injected`
  const releaseCompletion = deferred()
  const partialText = 'The initial MessagePort delivered this prefix.'
  const finalText = `${partialText} The reattached MessagePort delivered this suffix.`
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-message-port-reattach'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-message-port-reattach',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          {
            type: 'response.output_text.delta',
            delta: ' The reattached MessagePort delivered this suffix.'
          },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-message-port-reattach',
              content: [{ type: 'output_text', text: finalText }]
            }
          },
          responseCompleted('resp-message-port-reattach')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      args: [join(appRoot, 'tests/e2e/support/e2e-main-bootstrap.cjs')],
      environment: {
        DASCOWORK_E2E_MESSAGE_PORT_FAULT_PATH: faultPath
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await expect.poll(() => readFile(`${faultPath}.ready`, 'utf8').catch(() => '')).toBe('ready\n')

    await sendMessage(page, 'Reconnect this running task after the renderer MessagePort fails.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    await writeFile(faultPath, 'inject\n', 'utf8')
    await expect.poll(() => readFile(injectedPath, 'utf8').catch(() => '')).toBe('messageerror\n')
    releaseCompletion.resolve()

    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1)
    await expect(page.locator('[data-role="assistant"]')).toContainText(finalText)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([faultDirectory])
  }
})

test('P002-E2E-04 repairs a recoverable sequence gap without duplicating the transcript', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const faultDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-sequence-gap-'))
  const faultPath = join(faultDirectory, 'trigger-sequence-gap')
  const injectedPath = `${faultPath}.injected`
  const releaseCompletion = deferred()
  const partialText = 'The stream begins before its recoverable sequence gap.'
  const finalText = `${partialText} The journal replay restores the missing delta exactly once.`
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-sequence-gap-recovery'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-sequence-gap-recovery',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          {
            type: 'response.output_text.delta',
            delta: ' The journal replay restores the missing delta exactly once.'
          },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-sequence-gap-recovery',
              content: [{ type: 'output_text', text: finalText }]
            }
          },
          responseCompleted('resp-sequence-gap-recovery')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      args: [join(appRoot, 'tests/e2e/support/e2e-main-bootstrap.cjs')],
      environment: {
        DASCOWORK_E2E_MESSAGE_PORT_FAULT_PATH: faultPath,
        DASCOWORK_E2E_MESSAGE_PORT_FAULT_MODE: 'sequence-gap'
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await expect.poll(() => readFile(`${faultPath}.ready`, 'utf8').catch(() => '')).toBe('ready\n')

    await sendMessage(
      page,
      'Recover this message stream from a missing sequence without replaying it.'
    )
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    await writeFile(faultPath, 'inject\n', 'utf8')
    await expect.poll(() => readFile(injectedPath, 'utf8').catch(() => '')).toBe('messageerror\n')
    releaseCompletion.resolve()

    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1)
    await expect(page.locator('[data-role="assistant"]')).toHaveText(finalText)
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([faultDirectory])
  }
})

test('P002-E2E-09 retries one broken React render unit without replaying the turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const answer = 'The surrounding conversation remains intact after the local render retry.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-render-boundary'),
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-render-boundary',
              content: [{ type: 'output_text', text: answer }]
            }
          },
          responseCompleted('resp-render-boundary')
        ]
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await sendMessage(page, 'Force only this assistant render unit to fail once.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(answer)

    const injected = await page.evaluate(() => {
      const assistant = document.querySelector('[data-role="assistant"]') as
        | (HTMLElement & Record<string, unknown>)
        | null
      if (!assistant) return false
      const fiberKey = Object.keys(assistant).find((key) => key.startsWith('__reactFiber$'))
      if (!fiberKey) return false
      const visited = new Set<unknown>()
      const pending = [
        assistant[fiberKey] as {
          child?: unknown
          sibling?: unknown
          stateNode?: unknown
        }
      ]
      let boundary: Record<string, unknown> | undefined
      while (pending.length > 0) {
        const fiber = pending.pop()
        if (!fiber || visited.has(fiber)) continue
        visited.add(fiber)
        const stateNode = fiber.stateNode as { constructor?: { name?: string } } | undefined
        if (stateNode?.constructor?.name === 'ConversationTurnErrorBoundary') {
          boundary = stateNode as unknown as Record<string, unknown>
          break
        }
        if (fiber.child) pending.push(fiber.child as typeof fiber)
        if (fiber.sibling) pending.push(fiber.sibling as typeof fiber)
      }
      if (!boundary) return false
      ;(boundary.setState as (state: { failed: boolean }) => void)({ failed: true })
      return true
    })
    expect(injected).toBe(true)
    await expect(page.locator('[data-slot="conversation-render-error"]')).toHaveCount(1)
    await expect(page.getByText('这条回复暂时无法显示。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()

    await page.locator('[data-slot="conversation-render-retry"]').click()
    await expect(page.locator('[data-slot="conversation-render-error"]')).toHaveCount(0)
    await expect(page.locator('[data-role="assistant"]')).toContainText(answer)
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-07 redacts an unexpected recovery IPC failure while preserving replayed content', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const scenarios = [
    {
      error: 'provider configuration rejected secret-provider-token',
      kind: 'unknown',
      text: '无法重新连接任务。已保留历史；请发送一条新消息继续。'
    }
  ] as const

  for (const [index, scenario] of scenarios.entries()) {
    const faultDirectory = await mkdtemp(join(tmpdir(), `dascowork-e2e-recovery-${index}-`))
    const errorPath = join(faultDirectory, 'get-active-run-error')
    const releaseCompletion = deferred()
    const partialText = `Partial history survives recovery diagnostic ${index}.`
    const backend = await startMockBackend({
      responses: [
        {
          events: [
            responseCreated(`resp-recovery-diagnostic-${index}`),
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                type: 'message',
                role: 'assistant',
                id: `msg-recovery-diagnostic-${index}`,
                content: [{ type: 'output_text', text: '' }]
              }
            },
            { type: 'response.output_text.delta', delta: partialText },
            responseCompleted(`resp-recovery-diagnostic-${index}`)
          ],
          beforeEvent: (_event, eventIndex) =>
            eventIndex === 3 ? releaseCompletion.promise : undefined
        }
      ]
    })
    const logs: string[] = []
    let app: ElectronApplication | undefined

    try {
      app = await launchApp(backend, logs, {
        args: [join(appRoot, 'tests/e2e/support/e2e-main-bootstrap.cjs')],
        environment: { DASCOWORK_E2E_RECOVERY_ERROR_PATH: errorPath }
      })
      const page = await app.firstWindow()
      collectRendererLogs(page, logs)
      await sendMessage(page, `Recover this running task with diagnostic scenario ${index}.`)
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: partialText })
      ).toHaveCount(1)
      await writeFile(errorPath, scenario.error, 'utf8')
      await page.reload()
      collectRendererLogs(page, logs)

      const recovery = page.locator('[data-slot="conversation-recovery-status"]')
      await expect(recovery).toHaveAttribute('data-recovery-kind', scenario.kind)
      await expect(recovery).toHaveText(scenario.text)
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: partialText })
      ).toHaveCount(1)
      await expect(page.locator('body')).not.toContainText('secret-')
      expect(logs.filter((line) => line.startsWith('[renderer:')).join('\n')).not.toContain(
        'secret-'
      )
      expect(providerResponseBodies(backend)).toHaveLength(1)
      expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
    } finally {
      releaseCompletion.resolve()
      await attachDiagnostics(testInfo, logs, backend, app)
      await closeApp(app)
      await backend.close()
      await cleanupTempDirs([faultDirectory])
    }
  }
})

test('P002-E2E-10 renders only the workspace recovery actions permitted by main status', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const scenarios = [
    {
      get: { state: 'checking-failed', message: '无法检查原工作区。请重试。' },
      button: '重试检查',
      remainsVisible: true
    },
    {
      get: { state: 'restorable', message: '原工作区可恢复。' },
      restore: { state: 'available' },
      button: '恢复工作区',
      remainsVisible: false
    },
    {
      get: { state: 'gone', message: '原工作区已不可用。请选择项目并新建任务继续。' },
      button: '新建任务',
      remainsVisible: false
    },
    {
      get: { state: 'restorable', message: '原工作区可恢复。' },
      restore: {
        state: 'restore-failed',
        message: '恢复工作区失败。请重试，或选择项目后新建任务。'
      },
      button: '恢复工作区',
      remainsVisible: true
    },
    {
      get: { state: 'remote-unavailable', message: '远程工作区暂时不可用。' },
      button: '重试检查',
      remainsVisible: true
    },
    {
      get: { state: 'not-applicable' },
      button: null,
      remainsVisible: false
    }
  ] as const

  for (const [index, scenario] of scenarios.entries()) {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), `dascowork-e2e-workspace-recovery-${index}-`)
    )
    const statusPath = join(fixtureDirectory, 'workspace-recovery-status.json')
    await writeFile(statusPath, JSON.stringify(scenario), 'utf8')
    const responseText = `Workspace recovery scenario ${index} finished.`
    const backend = await startMockBackend({
      responses: [
        {
          events: [
            responseCreated(`resp-workspace-recovery-${index}`),
            {
              type: 'response.output_item.done',
              item: {
                type: 'message',
                role: 'assistant',
                id: `msg-workspace-recovery-${index}`,
                content: [{ type: 'output_text', text: responseText }]
              }
            },
            responseCompleted(`resp-workspace-recovery-${index}`)
          ]
        }
      ]
    })
    const logs: string[] = []
    let app: ElectronApplication | undefined

    try {
      app = await launchApp(backend, logs, {
        args: [join(appRoot, 'tests/e2e/support/e2e-main-bootstrap.cjs')],
        environment: { DASCOWORK_E2E_WORKSPACE_RECOVERY_STATUS_PATH: statusPath }
      })
      const page = await app.firstWindow()
      collectRendererLogs(page, logs)
      await sendMessage(page, `Exercise workspace recovery status ${index}.`)
      await expect(page.getByText(responseText, { exact: true })).toBeVisible()

      const banner = page.locator('[data-slot="workspace-recovery-banner"]')
      if (!scenario.button) {
        await expect(banner).toHaveCount(0)
      } else {
        await expect(banner).toHaveAttribute('data-workspace-recovery-state', scenario.get.state)
        await expect(
          banner.getByRole('button', { name: scenario.button, exact: true })
        ).toBeVisible()
        await banner.getByRole('button', { name: scenario.button, exact: true }).click()
        if (scenario.remainsVisible) {
          await expect(banner).toBeVisible()
        } else {
          await expect(banner).toHaveCount(0)
        }
      }

      expect(providerResponseBodies(backend)).toHaveLength(1)
      expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
    } finally {
      await attachDiagnostics(testInfo, logs, backend, app)
      await closeApp(app)
      await backend.close()
      await cleanupTempDirs([fixtureDirectory])
    }
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
        DASCOWORK_E2E_REAL_CODEX_BIN: realCodexCommand
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
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
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

    await sendComposerMessage(page, 'Start a new turn after the interrupted app-server transport.')
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

test('P002-E2E-06A reattaches the same active turn after only the desktop-facing transport closes', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const relayDirectory = await mkdtemp('/private/tmp/dascowork-p002-relay-')
  const proxyPidPath = join(relayDirectory, 'proxy.pid')
  const relayPidPath = join(relayDirectory, 'relay.pid')
  const relayReadyPath = join(relayDirectory, 'relay.ready')
  const relaySocketPath = join(relayDirectory, 'relay.sock')
  const releaseCompletion = deferred()
  const partialText = 'The first transport delivered this prefix.'
  const finalText = `${partialText} The resumed transport delivered this suffix.`
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-existing-turn-recovery'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-existing-turn-recovery',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          {
            type: 'response.output_text.delta',
            delta: ' The resumed transport delivered this suffix.'
          },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-existing-turn-recovery',
              content: [{ type: 'output_text', text: finalText }]
            }
          },
          responseCompleted('resp-existing-turn-recovery')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      environment: {
        CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/persistent-app-server-proxy.mjs'),
        DASCOWORK_E2E_APP_SERVER_PID_PATH: proxyPidPath,
        DASCOWORK_E2E_PERSISTENT_RELAY_SOCKET: relaySocketPath,
        DASCOWORK_E2E_RELAY_READY_PATH: relayReadyPath,
        DASCOWORK_E2E_RELAY_PID_PATH: relayPidPath,
        DASCOWORK_E2E_REAL_CODEX_BIN: realCodexCommand
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Keep this active turn alive while only its transport is replaced.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    await expect.poll(() => readFile(relayReadyPath, 'utf8').catch(() => '')).toBe('ready\n')

    process.kill(await readAppServerPid(proxyPidPath), 'SIGKILL')
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"thread/resume"')).length)
      .toBe(1)
    releaseCompletion.resolve()

    await expect(page.locator('[data-role="assistant"]')).toContainText(finalText)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/completed"')).length)
      .toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await stopPersistentRelay(relayPidPath)
    await cleanupTempDirs([relayDirectory])
  }
})

test('P002-E2E-06B settles as interrupted when the restarted app-server has no active turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const relayDirectory = await mkdtemp('/private/tmp/dascowork-p002-restart-')
  const proxyPidPath = join(relayDirectory, 'proxy.pid')
  const relayPidPath = join(relayDirectory, 'relay.pid')
  const relayReadyPath = join(relayDirectory, 'relay.ready')
  const relayRestartPath = join(relayDirectory, 'relay.restart')
  const relaySocketPath = join(relayDirectory, 'relay.sock')
  const releaseCompletion = deferred()
  const partialText = 'History survives although the active turn no longer exists.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-restarted-server-no-active-turn'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-restarted-server-no-active-turn',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: partialText },
          responseCompleted('resp-restarted-server-no-active-turn')
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseCompletion.promise : undefined)
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      environment: {
        CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/persistent-app-server-proxy.mjs'),
        DASCOWORK_E2E_APP_SERVER_PID_PATH: proxyPidPath,
        DASCOWORK_E2E_PERSISTENT_RELAY_SOCKET: relaySocketPath,
        DASCOWORK_E2E_RELAY_READY_PATH: relayReadyPath,
        DASCOWORK_E2E_RELAY_PID_PATH: relayPidPath,
        DASCOWORK_E2E_RELAY_RESTART_PATH: relayRestartPath,
        DASCOWORK_E2E_REAL_CODEX_BIN: realCodexCommand
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Do not replay this prompt when the app-server process is replaced.')
    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    await writeFile(relayRestartPath, 'restart\n', 'utf8')

    await expect(page.locator('[data-role="assistant"]')).toContainText(partialText)
    await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"thread/resume"')).length)
      .toBe(1)
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
      .toBe(1)
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  } finally {
    releaseCompletion.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await stopPersistentRelay(relayPidPath)
    await cleanupTempDirs([relayDirectory])
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

async function stopPersistentRelay(relayPidPath: string): Promise<void> {
  try {
    process.kill(await readAppServerPid(relayPidPath), 'SIGTERM')
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error.code !== 'ESRCH' && error.code !== 'ENOENT')
    ) {
      throw error
    }
  }
}
