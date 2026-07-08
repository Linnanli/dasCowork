import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  attachDiagnostics,
  closeApp,
  cleanupTempDirs,
  collectRendererLogs,
  launchApp
} from './support/app'
import { createLocalProject, sendComposerMessage, sendMessage } from './support/chatActions'
import {
  applyPatchResponse,
  assistantMessageResponse,
  isResponsesUrl,
  shellCommandResponse,
  startMockBackend,
  webSearchResponse
} from './support/mockBackend'
import { writeFakeChatGptAuth, writeStandaloneWebSearchConfig } from './support/authFixtures'

test('renders web search and exploration render units through the real desktop chat flow', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const query = 'render unit parity e2e'
  const backend = await startMockBackend({
    modelApiBasePath: '/api/codex',
    modelProvider: 'OpenAI',
    responses: [
      webSearchResponse('resp-web-search-tool', 'web-run-1', query),
      shellCommandResponse('resp-exploration-tool', 'call-read-package', {
        command: 'cat package.json',
        timeout_ms: 5000
      }),
      assistantMessageResponse(
        'resp-render-unit-final',
        'msg-render-unit-final',
        'Web search and exploration render units complete'
      )
    ],
    searchResponses: [{ encrypted_output: 'ciphertext', output: 'Search result' }]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      configureCodexHome: async (codexHomeDir) => {
        await writeStandaloneWebSearchConfig(codexHomeDir, backend)
        await writeFakeChatGptAuth(codexHomeDir)
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, '搜索 render unit parity，然后总结。')

    const webSearchGroup = page.locator('[data-slot="web-search-group-unit"]')
    await expect(webSearchGroup).toBeVisible()
    await expect(webSearchGroup).toContainText('已搜索')

    await webSearchGroup.locator('[data-slot="tool-group-trigger"]').click()
    await expect(page.locator('[data-slot="web-search-details"]')).toContainText(query)
    await expect(page.locator('[data-slot="web-search-details"]')).toContainText('已搜索 · search')

    const explorationCard = page.locator('[data-slot="exploration-entry-unit"]')
    await expect(explorationCard).toBeVisible()
    await expect(explorationCard).toContainText('已探索')
    await expect(explorationCard).toContainText('package.json')
    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Web search and exploration render units complete'
    )

    const searchRequest = backend.requests.find(
      (request) => request.method === 'POST' && request.url === '/api/codex/alpha/search'
    )
    expect(searchRequest).toBeDefined()
    if (!searchRequest) throw new Error('Expected standalone web search request')

    const searchBody = JSON.parse(searchRequest.body) as {
      commands?: { search_query?: Array<{ q?: string }> }
    }
    expect(searchBody.commands?.search_query?.[0]?.q).toBe(query)
    expect(
      backend.requests.filter((request) => request.method === 'POST' && isResponsesUrl(request.url))
    ).toHaveLength(3)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('renders turn diff render unit after a real file change through the desktop chat flow', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-diff-'))
  await writeFile(join(projectRoot, 'notes.txt'), 'before\n', 'utf8')

  const patch = `*** Begin Patch
*** Update File: notes.txt
@@
-before
+after from e2e
*** End Patch
`
  const backend = await startMockBackend({
    responses: [
      applyPatchResponse('resp-turn-diff-patch', 'call-turn-diff-patch', patch),
      assistantMessageResponse(
        'resp-turn-diff-final',
        'msg-turn-diff-final',
        'Turn diff render unit complete'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(page.locator('body')).toContainText('qwen3.7-plus')
    const projectName = `E2E Turn Diff ${Date.now().toString(36)}`
    await createLocalProject(page, projectName, projectRoot)
    await expect(page.locator('body')).toContainText(`Working in: ${projectName}`)

    await sendComposerMessage(page, '更新 notes.txt，并展示这次文件变更。')

    const panel = page.locator('[data-slot="server-request-panel"]')
    const approvalAppeared = await panel
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (approvalAppeared) {
      await expect(panel).toContainText('File change approval')
      await expect(panel).toContainText('notes.txt')
      await panel.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(panel).toBeHidden()
    }

    const turnDiffCard = page.locator('[data-slot="turn-diff-entry-unit"]').first()
    await expect(turnDiffCard).toBeVisible()
    await expect(turnDiffCard).toContainText('代码变更')
    await expect(turnDiffCard).toContainText('notes.txt')
    await expect(turnDiffCard).toContainText('+1/-1')
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: 'Turn diff render unit complete' })
    ).toBeVisible()
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('after from e2e\n')
    expect(
      backend.requests.filter((request) => request.method === 'POST' && isResponsesUrl(request.url))
    ).toHaveLength(2)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})
