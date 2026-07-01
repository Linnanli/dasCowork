import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { resolve } from 'node:path'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import electronExecutable from 'electron'
import { _electron as electron, type ElectronApplication } from 'playwright'

const appRoot = resolve(__dirname, '..', '..')
const repoRoot = resolve(appRoot, '..')

type MockRequest = {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

type MockBackend = {
  baseUrl: string
  requests: MockRequest[]
  close(): Promise<void>
}

type ResponsesStep = {
  events: ResponseEvent[]
}

type ResponseEvent = {
  type: string
  [key: string]: unknown
}

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
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('approves a command request through the desktop approval panel', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-approval-tool', 'call-approved-pwd', {
        command: 'pwd && printf "\\nE2E_APPROVED_COMMAND"',
        timeout_ms: 5000,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies the desktop approval panel'
      }),
      assistantMessageResponse(
        'resp-approval-final',
        'msg-approval-final',
        'Approved command completed'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, '运行 pwd，然后告诉我当前目录。')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('Command execution approval')
    await expect(panel).toContainText('pwd')

    await panel.getByRole('button', { name: 'Approve', exact: true }).click()

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Approved command completed'
    )
    await expect(panel).toBeHidden()

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    const toolOutput = functionCallOutputText(providerBodies[1], 'call-approved-pwd')
    expect(toolOutput).toContain(appRoot)
    expect(toolOutput).toContain('E2E_APPROVED_COMMAND')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('rejects a command request through the desktop approval panel', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-reject-tool', 'call-rejected-pwd', {
        command: 'pwd && printf "\\nE2E_REJECTED_COMMAND_SHOULD_NOT_RUN"',
        timeout_ms: 5000,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies command rejection'
      }),
      assistantMessageResponse(
        'resp-reject-final',
        'msg-reject-final',
        'Command was rejected by the user'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, '运行 pwd，然后拒绝授权。')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('Command execution approval')
    await expect(panel).toContainText('pwd')

    await panel.getByRole('button', { name: 'Reject' }).click()

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Command was rejected by the user'
    )
    await expect(panel).toBeHidden()

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    const toolOutput = functionCallOutputText(providerBodies[1], 'call-rejected-pwd')
    expect(toolOutput).toBe('exec command rejected by user')
    expect(toolOutput).not.toContain('E2E_REJECTED_COMMAND_SHOULD_NOT_RUN')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('switches projects from the left sidebar project list', async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [assistantMessageResponse('resp-sidebar-switch', 'msg-sidebar-switch', 'ok')]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    const runId = Date.now().toString(36)
    const firstProjectName = `E2E Sidebar Alpha ${runId}`
    const secondProjectName = `E2E Sidebar Beta ${runId}`
    await createLocalProject(page, firstProjectName, appRoot)
    await createLocalProject(page, secondProjectName, repoRoot)
    await expect(page.locator('body')).toContainText(`Working in: ${secondProjectName}`)

    await page
      .locator('[data-slot="codex-sidebar"]')
      .getByText(firstProjectName, { exact: true })
      .click()

    await expect(page.locator('body')).toContainText(`Working in: ${firstProjectName}`)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('opens a sidebar conversation and continues the same desktop thread', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const runId = Date.now().toString(36)
  const firstPrompt = `sidebar-history-${runId}`
  const secondPrompt = `sidebar-continued-${runId}`
  const firstResponse = `sidebar restored response ${runId}`
  const secondResponse = `sidebar continued response ${runId}`
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse(
        'resp-sidebar-history-first',
        'msg-sidebar-history-first',
        firstResponse
      ),
      assistantMessageResponse(
        'resp-sidebar-history-second',
        'msg-sidebar-history-second',
        secondResponse
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()

    await sidebar.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(page.locator('[data-role="user"]').filter({ hasText: firstPrompt })).toHaveCount(0)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toHaveCount(0)

    await sidebar.getByText(firstPrompt, { exact: true }).click()
    await expect(page.locator('[data-role="user"]')).toContainText(firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    await sendComposerMessage(page, secondPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondResponse })
    ).toBeVisible()

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    const resumedInput = JSON.stringify(providerBodies[1])
    expect(resumedInput).toContain(firstPrompt)
    expect(resumedInput).toContain(firstResponse)
    expect(resumedInput).toContain(secondPrompt)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('keeps sidebar projects and conversations after a renderer reload', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const runId = Date.now().toString(36)
  const projectName = `E2E Reload Project ${runId}`
  const firstPrompt = `reload-history-${runId}`
  const firstResponse = `reload restored response ${runId}`
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('resp-reload-history', 'msg-reload-history', firstResponse)
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await createLocalProject(page, projectName, appRoot)
    await expect(page.locator('body')).toContainText(`Working in: ${projectName}`)

    await sendComposerMessage(page, firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await expect(sidebar.getByText(projectName, { exact: true })).toBeVisible()
    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()

    await page.reload()

    await expect(page.locator('body')).toContainText(`Working in: ${projectName}`)
    await expect(sidebar.getByText(projectName, { exact: true })).toBeVisible()
    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

test('preserves a new conversation across reload and restores its history', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const runId = Date.now().toString(36)
  const firstPrompt = `preserve-reload-${runId}`
  const firstResponse = `preserve reloaded response ${runId}`
  const backend = await startMockBackend({
    responses: [assistantMessageResponse('resp-preserve', 'msg-preserve', firstResponse)]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()
    await expectConversationInAuthoritativeList(page, firstPrompt)
    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()

    await page.reload()

    await expect(sidebar.getByText(firstPrompt, { exact: true })).toBeVisible()

    await sidebar.getByText(firstPrompt, { exact: true }).click()
    await expect(page.locator('[data-role="user"]')).toContainText(firstPrompt)
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstResponse })
    ).toBeVisible()
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await app?.close().catch(() => undefined)
    await backend.close()
  }
})

async function launchApp(backend: MockBackend, logs: string[]): Promise<ElectronApplication> {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: appRoot,
    env: {
      ...process.env,
      ADMIN_BACKEND_URL: backend.baseUrl,
      ADMIN_BACKEND_MODEL_USER_ID: 'e2e-user',
      ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '1000',
      CODEX_ASP_DEBUG_PACKETS: '1',
      CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: '1',
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })

  app.process().stdout?.on('data', (chunk) => logs.push(`[main:stdout] ${String(chunk)}`))
  app.process().stderr?.on('data', (chunk) => logs.push(`[main:stderr] ${String(chunk)}`))
  return app
}

async function sendMessage(page: Page, message: string): Promise<void> {
  await expect(page.locator('body')).toContainText('qwen3.7-plus')
  await ensureLocalProjectSelected(page)
  await sendComposerMessage(page, message)
}

async function sendComposerMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
  await input.fill(message)
  const sendButton = page.getByRole('button', { name: '发送消息', exact: true })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
}

async function ensureLocalProjectSelected(page: Page): Promise<void> {
  await createLocalProject(page, 'E2E Local Project', appRoot)
  await expect(page.locator('body')).toContainText('Working in: E2E Local Project')
}

async function createLocalProject(page: Page, name: string, root: string): Promise<void> {
  await page.evaluate(
    async ({ projectName, projectRoot }) => {
      await window.desktopApp.projects.createLocalProject({
        name: projectName,
        sourceRoots: [projectRoot]
      })
    },
    { projectName: name, projectRoot: root }
  )
}

async function expectConversationInAuthoritativeList(page: Page, title: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (expectedTitle) => {
          const state = await window.desktopApp.conversations.refreshConversationList()
          return (
            !state.error &&
            state.conversations.some(
              (conversation) =>
                conversation.title === expectedTitle || conversation.id === expectedTitle
            )
          )
        }, title),
      { timeout: 15_000 }
    )
    .toBe(true)
}

function collectRendererLogs(page: Page, logs: string[]): void {
  page.on('console', (message) => {
    logs.push(`[renderer:${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    logs.push(`[renderer:pageerror] ${error.stack ?? error.message}`)
  })
}

async function attachDiagnostics(
  testInfo: TestInfo,
  logs: string[],
  backend: MockBackend,
  app: ElectronApplication | undefined
): Promise<void> {
  let status: unknown = undefined
  if (app) {
    const windows = app.windows()
    const page = windows[0]
    if (page) {
      status = await page
        .evaluate(async () => window.desktopApp?.codex?.getStatus?.())
        .catch((error: unknown) => `status unavailable: ${errorMessage(error)}`)
    }
  }

  const diagnosticsPath = testInfo.outputPath('desktop-chat-diagnostics.json')
  await writeFile(
    diagnosticsPath,
    JSON.stringify(
      {
        status,
        backendRequests: backend.requests,
        logs
      },
      null,
      2
    )
  )
  await testInfo.attach('desktop-chat-diagnostics.json', {
    contentType: 'application/json',
    path: diagnosticsPath
  })
}

async function startMockBackend(options: { responses: ResponsesStep[] }): Promise<MockBackend> {
  const requests: MockRequest[] = []
  const responses = [...options.responses]
  const server = createServer(async (request, response) => {
    const capturedRequest: MockRequest = {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
      body: ''
    }
    requests.push(capturedRequest)

    const body = await readRequestBody(request)
    capturedRequest.body = body

    if (request.method === 'GET' && request.url?.startsWith('/api/client-models')) {
      writeJson(response, [
        {
          model_id: 'qwen3.7-plus',
          display_name: 'qwen3.7-plus',
          description: null,
          provider: 'qwen',
          is_default: true,
          capabilities: ['text'],
          api_base_url: serverBaseUrl(server),
          api_key: 'sk-e2e-test-key',
          api_format: 'openai',
          source: 'admin'
        }
      ])
      return
    }

    if (request.method === 'GET' && (request.url === '/v1/models' || request.url === '/models')) {
      writeJson(response, {
        object: 'list',
        data: [{ id: 'qwen3.7-plus', object: 'model', created: 0, owned_by: 'qwen' }]
      })
      return
    }

    if (request.method === 'POST' && request.url === '/responses') {
      const nextResponse = responses.shift()
      if (!nextResponse) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'No scripted /responses payload remaining' }))
        return
      }
      writeResponsesStream(response, nextResponse)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: `Unhandled ${request.method} ${request.url}` }))
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    baseUrl: serverBaseUrl(server),
    requests,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()))
      })
  }
}

function serverBaseUrl(server: ReturnType<typeof createServer>): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock backend is not listening')
  return `http://127.0.0.1:${address.port}`
}

function writeJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  })
  response.end(JSON.stringify(payload))
}

function writeResponsesStream(response: ServerResponse, step: ResponsesStep): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  for (const event of step.events) writeSse(response, event)
  response.end()
}

function assistantMessageResponse(
  responseId: string,
  messageId: string,
  text: string
): ResponsesStep {
  return {
    events: [
      responseCreated(responseId),
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          id: messageId,
          content: [{ type: 'output_text', text }]
        }
      },
      responseCompleted(responseId)
    ]
  }
}

function shellCommandResponse(
  responseId: string,
  callId: string,
  args: Record<string, unknown>
): ResponsesStep {
  return {
    events: [
      responseCreated(responseId),
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: callId,
          name: 'shell_command',
          arguments: JSON.stringify(args)
        }
      },
      responseCompleted(responseId)
    ]
  }
}

function responseCreated(responseId: string): ResponseEvent {
  return {
    type: 'response.created',
    response: { id: responseId }
  }
}

function responseCompleted(responseId: string): ResponseEvent {
  return {
    type: 'response.completed',
    response: {
      id: responseId,
      usage: {
        input_tokens: 1,
        input_tokens_details: null,
        output_tokens: 1,
        output_tokens_details: null,
        total_tokens: 2
      }
    }
  }
}

function writeSse(response: ServerResponse, payload: ResponseEvent): void {
  response.write(`event: ${payload.type}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function providerResponseBodies(backend: MockBackend): unknown[] {
  return backend.requests
    .filter((request) => request.method === 'POST' && request.url === '/responses')
    .map((request) => JSON.parse(request.body) as unknown)
}

function functionCallOutputText(providerBody: unknown, callId: string): string | undefined {
  if (!isRecord(providerBody) || !Array.isArray(providerBody.input)) return undefined
  const outputItem = providerBody.input.find(
    (item) => isRecord(item) && item.type === 'function_call_output' && item.call_id === callId
  )
  if (!isRecord(outputItem) || typeof outputItem.output !== 'string') return undefined
  return outputItem.output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolveRead(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectRead)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
