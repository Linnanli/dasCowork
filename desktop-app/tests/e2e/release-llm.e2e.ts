import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  appRoot,
  attachReleaseDiagnostics,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'

const realModelRuntime = resolveRealModelRuntime()
const isReleaseRuntime = realModelRuntime === 'release'
const realModelSmokeEnabled = isReleaseRuntime
  ? process.env['DASCOWORK_RELEASE_LLM_SMOKE'] === '1'
  : process.env['DASCOWORK_DEV_LLM_SMOKE'] === '1'
const adminBackendUrl = isReleaseRuntime
  ? process.env['DASCOWORK_RELEASE_ADMIN_BACKEND_URL']?.trim()
  : process.env['DASCOWORK_DEV_ADMIN_BACKEND_URL']?.trim()
const adminBackendUserId = isReleaseRuntime
  ? process.env['DASCOWORK_RELEASE_ADMIN_BACKEND_USER_ID']?.trim()
  : process.env['DASCOWORK_DEV_ADMIN_BACKEND_USER_ID']?.trim()
const packagedExecutable = process.env['DASCOWORK_RELEASE_PACKAGED_APP_EXECUTABLE']
const realModelAssertionTimeoutMs = 120_000
const realModelTestTimeoutMs = 180_000

type RuntimeExpectation = { expectedBinaryPathFragment: string }

type ReleaseContext = {
  app: ElectronApplication
  page: Page
  logs: string[]
  runtime: RuntimeExpectation
}

test.describe('real-model smoke gate', () => {
  test.setTimeout(realModelTestTimeoutMs)
  test.skip(!realModelSmokeEnabled, 'Real-model smoke requires an explicit opt-in')
  test.skip(
    isReleaseRuntime && !packagedExecutable,
    'Run through npm run test:e2e:release-llm to verify the packaged app'
  )

  test('R01 normal text reaches the real model through the desktop chain', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    await withReleaseApp(testInfo, async ({ page, runtime }) => {
      await sendReleaseMessage(page, '请用两句话说明桌面端真实模型链路已就绪。')
      await expectReleaseTurnSucceeded(page, runtime)
    })
  })

  test('R02 visible output then steer is accepted by the real-model turn', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    await withReleaseApp(testInfo, async ({ page, runtime }) => {
      await sendReleaseMessage(
        page,
        '请从 “RELEASE_STEER_READY” 开始，写一份 120 条的编号清单；逐条输出，不要使用工具。'
      )
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: 'RELEASE_STEER_READY' })
      ).toBeVisible({ timeout: realModelAssertionTimeoutMs })
      await expectReleaseActiveTurnBound(page)
      await queueAndSteer(page, '请停止清单，改为只用一句话总结当前任务。')
      await expectReleaseTurnSucceeded(page, runtime)
      await expect(
        page
          .locator('[data-role="user"]')
          .filter({ hasText: '请停止清单，改为只用一句话总结当前任务。' })
      ).toHaveCount(1)
    })
  })

  test('R03 reads a disposable workspace file through a real approved command', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    await withDisposableReadOnlyWorkspace(async ({ root, filename, marker }) => {
      await withReleaseApp(
        testInfo,
        async ({ page, runtime }) => {
          await sendReleaseMessage(
            page,
            `请使用命令工具读取当前工作区的 ${filename}（只允许读取，不得修改任何文件）。` +
              `命令审批出现后等待用户批准。读取完成后在最终回答中包含文件中的标记 ${marker}。`
          )
          await approvePendingReadOnlyCommand(page, filename)
          await expectReleaseToolActivity(page)
          await expectReleaseTurnSucceeded(page, runtime)
          await expect(page.locator('[data-role="assistant"]')).toContainText(marker)
          await expect(readFile(join(root, filename), 'utf8')).resolves.toBe(`${marker}\n`)
        },
        root
      )
    })
  })

  test('R04 steers while a real approved read-only command is running', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    await withDisposableReadOnlyWorkspace(async ({ root, filename, marker }) => {
      const steer = `命令完成后，用一句话确认已读取 ${marker}。`
      await withReleaseApp(
        testInfo,
        async ({ page, runtime }) => {
          await sendReleaseMessage(
            page,
            `请使用命令工具执行 \`sh -c 'sleep 4; cat ${filename}'\` 读取当前工作区文件。` +
              `只允许读取，不得修改文件；命令审批出现后等待用户批准，完成后再回答。`
          )
          await approvePendingReadOnlyCommand(page, filename)
          await expectReleaseToolActivity(page)
          await expectReleaseActiveTurnBound(page)
          await queueAndSteer(page, steer)
          await expectReleaseTurnSucceeded(page, runtime)
          await expect(page.locator('[data-role="assistant"]')).toContainText(marker)
          await expect(page.locator('[data-role="user"]').filter({ hasText: steer })).toHaveCount(1)
          await expect(readFile(join(root, filename), 'utf8')).resolves.toBe(`${marker}\n`)
        },
        root
      )
    })
  })

  test('R05 user stop produces an interrupted terminal in the desktop app', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    const prompt = '逐行写 500 条不重复的桌面端测试建议；不要使用工具。'
    await withReleaseApp(testInfo, async ({ page, runtime }) => {
      await sendReleaseMessage(page, prompt)
      await expectReleaseActiveTurnBound(page)
      await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible({
        timeout: realModelAssertionTimeoutMs
      })
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
      await expectReleaseTerminal(page, 'aborted')
      await expectReleaseNoToolActivity(page)
      await expectReleaseRuntime(page, runtime)
      await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
      await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
      await expect(page.locator('[data-slot="server-request-panel"]')).toHaveCount(0)

      await page.reload()
      const sidebar = page.locator('[data-slot="codex-sidebar"]')
      await expect(sidebar.getByText(prompt, { exact: true })).toBeVisible()
      await sidebar.getByText(prompt, { exact: true }).click()
      await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
      await expectReleaseTerminal(page, 'aborted')
      await expectReleaseNoToolActivity(page)
    })
  })

  test('R06 reload preserves real-model answer and steer history', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
    const marker = `RELEASE_HISTORY_${Date.now().toString(36)}`
    const steer = `请在历史中保留这条引导：${marker}`
    const prompt = `输出标记 ${marker} 并写 120 条编号清单；不要调用任何工具。`
    await withReleaseApp(testInfo, async ({ page, runtime }) => {
      await sendReleaseMessage(page, prompt)
      await expect(page.locator('[data-role="assistant"]').filter({ hasText: marker })).toBeVisible(
        { timeout: realModelAssertionTimeoutMs }
      )
      await expectReleaseActiveTurnBound(page)
      await queueAndSteer(page, steer)
      await expectReleaseTurnSucceeded(page, runtime)
      await expectReleaseNoToolActivity(page)
      await page.reload()
      const sidebar = page.locator('[data-slot="codex-sidebar"]')
      await expect(sidebar.getByText(prompt, { exact: true })).toBeVisible()
      await sidebar.getByText(prompt, { exact: true }).click()
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: marker }).first()
      ).toBeVisible()
      await expect(page.locator('[data-role="user"]').filter({ hasText: steer })).toHaveCount(1)
      await expectReleaseNoToolActivity(page)
      await expectReleaseRuntime(page, runtime)
    })
  })
})

async function withReleaseApp(
  testInfo: TestInfo,
  run: (context: ReleaseContext) => Promise<void>,
  workspaceRoot = appRoot
): Promise<void> {
  if (!adminBackendUrl) {
    throw new Error(
      isReleaseRuntime
        ? 'DASCOWORK_RELEASE_ADMIN_BACKEND_URL is required'
        : 'DASCOWORK_DEV_ADMIN_BACKEND_URL is required'
    )
  }
  if (isReleaseRuntime && !packagedExecutable) throw new Error('A packaged executable is required')
  if (isReleaseRuntime && process.env['CODEX_APP_SERVER_BIN']) {
    throw new Error('CODEX_APP_SERVER_BIN is forbidden in the packaged release gate')
  }
  if (isReleaseRuntime && process.env['DASCOWORK_RELEASE_DEV_APP_SERVER_BIN']) {
    throw new Error('DASCOWORK_RELEASE_DEV_APP_SERVER_BIN is forbidden in the release gate')
  }

  const logs: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await launchApp(
      { baseUrl: adminBackendUrl, requests: [], close: async () => undefined },
      logs,
      {
        cwd: appRoot,
        environment: {
          // The generic E2E launch default uses `e2e-user`, which is only valid for the mock
          // backend. Real catalog backends may reject it, so omit user_id unless explicitly set.
          ADMIN_BACKEND_MODEL_USER_ID: adminBackendUserId ?? '',
          CODEX_APP_SERVER_BIN: undefined,
          CODEX_RUST_WORKSPACE_ROOT: undefined,
          DASCOWORK_RELEASE_DEV_APP_SERVER_BIN: undefined,
          CODEX_ASP_DEBUG_PACKETS: process.env.DASCOWORK_RELEASE_LLM_DEBUG === '1' ? '1' : undefined
        },
        executablePath: isReleaseRuntime ? packagedExecutable : undefined,
        args: isReleaseRuntime ? [] : undefined
      }
    )
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await selectReleaseModel(page)
    await createLocalProject(page, 'Release LLM smoke project', workspaceRoot)
    const runtimeInfo = await app.evaluate(({ app: electronApp }) => ({
      isPackaged: electronApp.isPackaged,
      resourcesPath: process.resourcesPath
    }))
    expect(runtimeInfo.isPackaged).toBe(isReleaseRuntime)
    const runtime: RuntimeExpectation = {
      expectedBinaryPathFragment: isReleaseRuntime
        ? runtimeInfo.resourcesPath
        : `${appRoot}/.bundle-resources/codex-app-server`
    }
    await run({ app, page, logs, runtime })
  } finally {
    await attachReleaseDiagnostics(testInfo, logs, app)
    await closeApp(app)
  }
}

async function sendReleaseMessage(page: Page, message: string): Promise<void> {
  await sendComposerMessage(page, message)
}

async function withDisposableReadOnlyWorkspace(
  run: (workspace: { root: string; filename: string; marker: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dascowork-release-readonly-'))
  const filename = 'release-readonly-fixture.txt'
  const marker = `RELEASE_READONLY_${Date.now().toString(36)}`
  try {
    await writeFile(join(root, filename), `${marker}\n`, 'utf8')
    await run({ root, filename, marker })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function selectReleaseModel(page: Page): Promise<void> {
  const trigger = page.locator('[data-slot="model-selector-trigger"]')
  await expect(trigger).toBeVisible()

  const catalog = await page.evaluate(() => window.desktopApp.codex.listModels())
  expect(catalog.models).not.toHaveLength(0)
  const selectedModel = catalog.models.find((model) => model.id === catalog.selectedModelId)
  if (selectedModel) {
    await expect(trigger).toContainText(selectedModel.displayName)
    return
  }

  await trigger.click()
  const availableModels = page.locator('[data-slot="model-selector-item"]')
  await expect(availableModels.first()).toBeVisible()
  await availableModels.first().click()
  await expect(trigger).not.toContainText('Select model')
}

async function queueAndSteer(page: Page, text: string): Promise<void> {
  const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
  await input.fill(text)
  await page.getByRole('button', { name: '将追问加入队列' }).click()
  const queuedSteer = page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: text })
  await expect(queuedSteer).toHaveCount(1)
  await queuedSteer.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()
  await expect(queuedSteer).toHaveCount(0)
}

async function expectReleaseTurnSucceeded(page: Page, runtime: RuntimeExpectation): Promise<void> {
  await expect
    .poll(
      async () =>
        (await page.locator('[data-role="assistant"]').last().textContent())?.trim().length ?? 0,
      { timeout: realModelAssertionTimeoutMs }
    )
    .toBeGreaterThan(0)
  await expectReleaseTerminal(page, 'finish')
  await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, {
    timeout: realModelAssertionTimeoutMs
  })
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
  await expectReleaseRuntime(page, runtime)
}

async function expectReleaseTerminal(page: Page, terminal: 'finish' | 'aborted'): Promise<void> {
  if (terminal === 'aborted') {
    await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(1)
  } else {
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="aui_assistant-message-cancelled"]')).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, {
    timeout: realModelAssertionTimeoutMs
  })
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
}

async function expectReleaseActiveTurnBound(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible({
    timeout: realModelAssertionTimeoutMs
  })
}

async function expectReleaseNoToolActivity(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="tool-group-unit"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
}

async function approvePendingReadOnlyCommand(page: Page, filename: string): Promise<void> {
  const panel = page.locator('[data-slot="server-request-panel"]')
  await expect(panel).toContainText('Command execution approval', {
    timeout: realModelAssertionTimeoutMs
  })
  const command = (await panel.textContent()) ?? ''
  expect(command, 'the approval must name the disposable fixture being read').toContain(filename)
  expect(command, 'the release smoke test only approves a read-only command').toMatch(
    /\b(?:cat|head|tail|sed|awk|grep|rg)\b/u
  )
  expect(
    command,
    'the release smoke test must refuse a command with write-like operations'
  ).not.toMatch(
    /(?:\b(?:rm|mv|cp|touch|mkdir|chmod|chown|tee|dd|truncate|install)\b|>>?|\b(?:apply_patch|git\s+(?:add|commit|reset|checkout|restore|clean))\b)/u
  )
  await panel.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(panel).toHaveCount(0)
}

async function expectReleaseToolActivity(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('[data-slot="tool-group-unit"]').count(), {
      timeout: realModelAssertionTimeoutMs
    })
    .toBeGreaterThan(0)
  await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
}

async function expectReleaseRuntime(page: Page, runtime: RuntimeExpectation): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.desktopApp.codex.getStatus()))
    .toMatchObject({ state: 'ready' })
  const status = await page.evaluate(() => window.desktopApp.codex.getStatus())
  expect(status.binary).toContain(runtime.expectedBinaryPathFragment)
  expect(status.binary).toContain('codex-app-server')
  expect(status.binary).not.toMatch(/(?:^|\s)cargo(?:\s|$)/u)
}

function resolveRealModelRuntime(): 'development' | 'release' {
  const requestedRuntime = process.env['DASCOWORK_REAL_LLM_RUNTIME']
  if (requestedRuntime === 'development' || requestedRuntime === 'release') {
    return requestedRuntime
  }
  return 'release'
}
