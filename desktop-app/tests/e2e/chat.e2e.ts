import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import {
  assistantMessageResponse,
  deferred,
  providerResponseBodies,
  startMockBackend
} from './support/mockBackend'

test('sends a real desktop chat turn through the admin backend model provider', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [assistantMessageResponse('resp-e2e', 'msg-resp-e2e', 'E2E hello response')]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, '你好')

    await expect(page.locator('[data-role="assistant"]')).toContainText('E2E hello response')

    const providerRequest = backend.requests.find(
      (request) => request.method === 'POST' && request.url === '/responses'
    )
    expect(providerRequest).toBeDefined()
    if (!providerRequest) throw new Error('Expected provider responses request')

    expect(providerRequest.headers.authorization).toBe('Bearer sk-e2e-test-key')
    const providerBody = JSON.parse(providerRequest.body) as {
      model?: string
      input?: unknown
    }
    expect(providerBody.model).toBe('qwen3.7-plus')
    expect(JSON.stringify(providerBody.input)).toContain('你好')
    expect(
      backend.requests.some((request) => request.url === '/compatible-mode/v1/chat/completions')
    ).toBe(false)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('creates a sidebar conversation entry before the provider response returns', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseProviderResponse = deferred()
  const runId = Date.now().toString(36)
  const prompt = `immediate-sidebar-${runId}`
  const responseText = `immediate sidebar response ${runId}`
  const backend = await startMockBackend({
    responses: [
      {
        ...assistantMessageResponse(
          'resp-immediate-sidebar',
          'msg-immediate-sidebar',
          responseText
        ),
        beforeResponse: () => releaseProviderResponse.promise
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, prompt)

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await expect(sidebar.getByText(prompt, { exact: true })).toBeVisible()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: responseText })
    ).toHaveCount(0)

    releaseProviderResponse.resolve()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: responseText })
    ).toBeVisible()
  } finally {
    releaseProviderResponse.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('keeps one conversation streaming while another conversation completes', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFirstResponse = deferred()
  const runId = Date.now().toString(36)
  const firstPrompt = `parallel-first-${runId}`
  const secondPrompt = `parallel-second-${runId}`
  const firstResponse = `parallel first response ${runId}`
  const secondResponse = `parallel second response ${runId}`
  const backend = await startMockBackend({
    responses: [
      {
        ...assistantMessageResponse('resp-parallel-first', 'msg-parallel-first', firstResponse),
        beforeResponse: () => releaseFirstResponse.promise
      },
      assistantMessageResponse('resp-parallel-second', 'msg-parallel-second', secondResponse)
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    const firstConversation = sidebar.getByRole('button', {
      name: new RegExp(`^${firstPrompt}, running`)
    })
    await expect(firstConversation).toBeVisible()

    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, secondPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondResponse })
    ).toBeVisible()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toHaveCount(0)

    await firstConversation.click()
    await expect(page.locator('[data-role="user"]')).toContainText(firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondResponse })
    ).toHaveCount(0)

    releaseFirstResponse.resolve()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    expect(JSON.stringify(providerBodies[0])).toContain(firstPrompt)
    expect(JSON.stringify(providerBodies[1])).toContain(secondPrompt)
  } finally {
    releaseFirstResponse.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('stops only the active conversation while a background conversation continues', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFirstResponse = deferred()
  const releaseSecondResponse = deferred()
  const runId = Date.now().toString(36)
  const firstPrompt = `stop-isolation-first-${runId}`
  const secondPrompt = `stop-isolation-second-${runId}`
  const firstResponse = `stop isolation first response ${runId}`
  const secondResponse = `stop isolation second response ${runId}`
  const backend = await startMockBackend({
    responses: [
      {
        ...assistantMessageResponse('resp-stop-first', 'msg-stop-first', firstResponse),
        beforeResponse: () => releaseFirstResponse.promise
      },
      {
        ...assistantMessageResponse('resp-stop-second', 'msg-stop-second', secondResponse),
        beforeResponse: () => releaseSecondResponse.promise
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)
    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await expect(
      sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}, running`) })
    ).toBeVisible()

    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, secondPrompt)
    await expect(
      sidebar.getByRole('button', { name: new RegExp(`^${secondPrompt}, running`) })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
    releaseFirstResponse.resolve()

    const firstConversation = sidebar.getByRole('button', {
      name: new RegExp(`^${firstPrompt}`)
    })
    await firstConversation.click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    const secondConversation = sidebar.getByRole('button', {
      name: new RegExp(`^${secondPrompt}`)
    })
    await secondConversation.click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondResponse })
    ).toHaveCount(0)
    expect(providerResponseBodies(backend)).toHaveLength(2)
  } finally {
    releaseFirstResponse.resolve()
    releaseSecondResponse.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('shows upstream quota errors returned by the admin backend model provider', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [
      {
        status: 403,
        body: {
          request_id: 'req-quota-exhausted',
          code: 'PERMISSION_DENIED',
          message: 'The free quota has been exhausted.'
        }
      }
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, '你好')

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'The free quota has been exhausted.'
    )
    await expect(page.locator('[data-slot="codex-sidebar"]')).not.toContainText(
      'The free quota has been exhausted.'
    )
    expect(
      backend.requests.some((request) => request.method === 'POST' && request.url === '/responses')
    ).toBe(true)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})
