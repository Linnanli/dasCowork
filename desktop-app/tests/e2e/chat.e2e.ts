import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { appRoot, attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { ensureLocalProjectSelected, sendComposerMessage, sendMessage } from './support/chatActions'
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

test('renders the add-context menu above and aligned with the composer', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({ responses: [] })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(page.locator('body')).toContainText('qwen3.7-plus')
    await page.evaluate(async () => {
      await window.desktopApp.projects.selectProject({ projectKind: 'projectless' })
    })
    await expect(page.locator('body')).toContainText('Working in: Projectless')
    const addContextButton = page.getByRole('button', { name: '添加文件和更多', exact: true })
    await expect(addContextButton).toBeEnabled()
    await addContextButton.click()

    const popover = page.getByRole('listbox', { name: '添加上下文' })
    const composer = page.locator('[data-slot="aui_composer-shell"]')
    await expect(popover).toBeVisible()
    await expect(popover).toHaveCSS('max-height', '320px')
    await popover.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })

    const [popoverBox, composerBox] = await Promise.all([
      popover.boundingBox(),
      composer.boundingBox()
    ])
    expect(popoverBox).not.toBeNull()
    expect(composerBox).not.toBeNull()
    if (!popoverBox || !composerBox) throw new Error('Could not measure composer add menu')

    expect(Math.abs(popoverBox.x - composerBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(popoverBox.width - composerBox.width)).toBeLessThanOrEqual(1)
    expect(composerBox.y - (popoverBox.y + popoverBox.height)).toBeGreaterThanOrEqual(11)
    expect(composerBox.y - (popoverBox.y + popoverBox.height)).toBeLessThanOrEqual(13)

    const screenshotPath = testInfo.outputPath('composer-add-menu.png')
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('composer-add-menu.png', {
      contentType: 'image/png',
      path: screenshotPath
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('sends a workspace reference, local file attachment and image through the provider', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const prompt = '请结合这个文件和图片说明下一步'
  const responseText = '已收到文件上下文和图片。'
  const workspaceFileLabel = 'src/renderer/src/App.tsx'
  const workspaceFilePath = `${appRoot}/${workspaceFileLabel}`
  const backend = await startMockBackend({
    capabilities: ['text', 'image'],
    responses: [assistantMessageResponse('resp-context-photo', 'msg-context-photo', responseText)]
  })
  const localContextDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-context-'))
  const attachmentPath = join(localContextDir, 'e2e-notes.txt')
  const imagePath = join(localContextDir, 'e2e-context.png')
  await writeFile(attachmentPath, 'Local attachment contents must not be uploaded.')
  await writeFile(imagePath, onePixelPng)
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    await app.evaluate(
      ({ dialog }, filePaths) => {
        Object.assign(dialog, {
          showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
          showOpenDialog: async () => ({ canceled: false, filePaths, bookmarks: [] })
        })
      },
      [attachmentPath, imagePath]
    )
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(page.locator('body')).toContainText('qwen3.7-plus')
    await ensureLocalProjectSelected(page)

    const composer = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await composer.fill(`${prompt} @${workspaceFileLabel}`)

    const contextPanel = page.getByRole('listbox', { name: '添加上下文' })
    await expect(contextPanel).toBeVisible()
    const workspaceResult = contextPanel.getByRole('option').filter({ hasText: workspaceFileLabel })
    await expect(workspaceResult).toHaveCount(1)
    await workspaceResult.click()

    await page.getByRole('button', { name: '添加文件和更多', exact: true }).click()
    await page.getByRole('option', { name: 'Files and folders', exact: true }).click()
    await expect(page.getByRole('button', { name: 'File attachment', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Image attachment', exact: true })).toBeVisible()

    const sendButton = page.getByRole('button', { name: '发送消息', exact: true })
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(page.locator('[data-role="assistant"]')).toContainText(responseText)

    const providerBody = await expectProviderResponseBody(backend)
    const contents = providerInputContents(providerBody)
    expect(contents).toContainEqual({
      type: 'input_text',
      text:
        '# Files mentioned by the user:\n\n' +
        `## ${JSON.stringify(workspaceFileLabel)}: ${JSON.stringify(workspaceFilePath)}\n\n` +
        `## ${JSON.stringify('e2e-notes.txt')}: ${JSON.stringify(attachmentPath)}` +
        `\n\n## My request for Codex:\n${prompt}`
    })
    expect(JSON.stringify(providerBody)).not.toContain(
      'Local attachment contents must not be uploaded.'
    )
    expect(contents).toContainEqual(
      expect.objectContaining({
        type: 'input_image',
        image_url: expect.stringMatching(/^data:image\/png;base64,/u)
      })
    )
    expect(
      contents.some(
        (content) =>
          content.type === 'input_text' &&
          typeof content.text === 'string' &&
          content.text.startsWith('<image name=[Image #1] path="')
      )
    ).toBe(true)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await rm(localContextDir, { recursive: true, force: true })
  }
})

async function expectProviderResponseBody(backend: {
  requests: Array<{ method: string; url: string; body: string }>
}): Promise<unknown> {
  await expect
    .poll(
      () =>
        backend.requests.find(
          (request) => request.method === 'POST' && request.url === '/responses'
        )?.body,
      { timeout: 20_000 }
    )
    .toBeTruthy()

  const providerRequest = backend.requests.find(
    (request) => request.method === 'POST' && request.url === '/responses'
  )
  if (!providerRequest) throw new Error('Expected provider responses request')
  return JSON.parse(providerRequest.body) as unknown
}

function providerInputContents(providerBody: unknown): Array<Record<string, unknown>> {
  if (!isRecord(providerBody) || !Array.isArray(providerBody.input)) {
    throw new Error('Expected the provider request to include an input array')
  }

  return providerBody.input.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return []
    return item.content.filter(isRecord)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
    await expect.poll(() => providerResponseBodies(backend)).toHaveLength(2)

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
    await expect(page.locator('.aui-lexical-input[contenteditable="true"]').last()).toHaveText('')
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
