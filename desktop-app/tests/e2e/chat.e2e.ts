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

test('sends a real desktop chat turn through the admin backend model provider', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend()
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
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

    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(page.locator('body')).toContainText('qwen3.7-plus')

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill('你好')
    await page.getByRole('button', { name: '发送消息' }).click()

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
        .evaluate(async () => window.desktopCodex?.getStatus?.())
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

async function startMockBackend(): Promise<MockBackend> {
  const requests: MockRequest[] = []
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
      writeResponsesStream(response)
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

function writeResponsesStream(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  writeSse(response, {
    type: 'response.created',
    response: { id: 'resp-e2e' }
  })
  writeSse(response, {
    type: 'response.output_item.done',
    item: {
      type: 'message',
      role: 'assistant',
      id: 'msg-resp-e2e',
      content: [{ type: 'output_text', text: 'E2E hello response' }]
    }
  })
  writeSse(response, {
    type: 'response.completed',
    response: {
      id: 'resp-e2e',
      usage: {
        input_tokens: 1,
        input_tokens_details: null,
        output_tokens: 1,
        output_tokens_details: null,
        total_tokens: 2
      }
    }
  })
  response.end()
}

function writeSse(response: ServerResponse, payload: { type: string }): void {
  response.write(`event: ${payload.type}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
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
