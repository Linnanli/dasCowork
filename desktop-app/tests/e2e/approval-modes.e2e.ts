import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { ensureLocalProjectSelected, sendComposerMessage } from './support/chatActions'
import { startMockBackend } from './support/mockBackend'

type ApprovalMode = 'request-approval' | 'approve-for-me' | 'full-access'

type RpcCall = {
  method: string
  params?: Record<string, unknown>
  threadId?: string
}

test.describe.configure({ timeout: 90_000 })

test('sends each selected approval mode to the app-server protocol', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalModeScenario(testInfo, async ({ page, rpcLogPath }) => {
    await ensureLocalProjectSelected(page)

    for (const [index, mode] of ['request-approval', 'approve-for-me', 'full-access'].entries()) {
      await setApprovalMode(page, mode)
      await sendComposerMessage(page, `Approval mode ${index + 1}`)
      await expect
        .poll(() => callCount(rpcLogPath, 'turn/start'), { timeout: 15_000 })
        .toBe(index + 1)
    }

    const records = await readRpcLog(rpcLogPath)
    expectThreadSettings(onlyCall(records, 'thread/start'), 'request-approval')

    const resumes = calls(records, 'thread/resume')
    expect(resumes).toHaveLength(2)
    expectThreadSettings(resumes[0], 'approve-for-me')
    expectThreadSettings(resumes[1], 'full-access')

    const turns = calls(records, 'turn/start')
    expect(turns).toHaveLength(3)
    expectTurnSettings(turns[0], 'request-approval')
    expectTurnSettings(turns[1], 'approve-for-me')
    expectTurnSettings(turns[2], 'full-access')
  })
})

test('applies a full-access downgrade to the next turn in the same conversation', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalModeScenario(testInfo, async ({ page, rpcLogPath }) => {
    await ensureLocalProjectSelected(page)
    await setApprovalMode(page, 'full-access')
    await sendComposerMessage(page, 'Start with full access.')
    await setApprovalMode(page, 'request-approval')
    await sendComposerMessage(page, 'Downgrade to request approval.')

    await expect.poll(() => callCount(rpcLogPath, 'turn/start'), { timeout: 15_000 }).toBe(2)
    const records = await readRpcLog(rpcLogPath)
    expectThreadSettings(onlyCall(records, 'thread/start'), 'full-access')
    expectThreadSettings(onlyCall(records, 'thread/resume'), 'request-approval')

    const turns = calls(records, 'turn/start')
    expectTurnSettings(turns[0], 'full-access')
    expectTurnSettings(turns[1], 'request-approval')
  })
})

test('keeps approval modes isolated between conversations', async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalModeScenario(testInfo, async ({ page, rpcLogPath }) => {
    const firstPrompt = `request-mode-${Date.now().toString(36)}`
    const secondPrompt = `full-mode-${Date.now().toString(36)}`
    await ensureLocalProjectSelected(page)

    await setApprovalMode(page, 'request-approval')
    await sendComposerMessage(page, firstPrompt)
    await expect.poll(() => conversationCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    const firstThreadId = onlyCall(await readRpcLog(rpcLogPath), 'thread/start').threadId
    expect(firstThreadId).toBeTruthy()

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await setApprovalMode(page, 'full-access')
    await sendComposerMessage(page, secondPrompt)
    await expect.poll(() => conversationCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)

    await openPersistedConversation(page, firstThreadId!)
    await expect(page.locator('[data-slot="composer-approval-mode-selector"]')).toHaveAttribute(
      'data-mode',
      'request-approval'
    )
    const starts = calls(await readRpcLog(rpcLogPath), 'thread/start')
    expect(starts).toHaveLength(2)
    await openPersistedConversation(page, starts[1]?.threadId ?? '')
    await expect(page.locator('[data-slot="composer-approval-mode-selector"]')).toHaveAttribute(
      'data-mode',
      'full-access'
    )

    expect(starts[0]?.threadId).not.toBe(starts[1]?.threadId)
    expectThreadSettings(starts[0], 'request-approval')
    expectThreadSettings(starts[1], 'full-access')
  })
})

test('restores approval settings after reload and app relaunch', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const serverStateDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-relaunch-server-'))
  const userDataDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-relaunch-user-data-'))
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-relaunch-codex-home-'))
  const rpcLogPath = join(serverStateDir, 'approval-rpc.jsonl')
  const backend = await startMockBackend({ responses: [] })
  const logs: string[] = []
  const launchOptions = {
    userDataDir,
    codexHomeDir,
    preserveDataDirectories: true,
    environment: {
      CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/approval-modes-app-server.mjs'),
      DASCOWORK_E2E_APPROVAL_RPC_LOG_PATH: rpcLogPath
    }
  }
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, launchOptions)
    let page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await ensureLocalProjectSelected(page)
    await setApprovalMode(page, 'full-access')
    await captureApprovalModeScreenshots(page, testInfo, 'full-access')
    await sendComposerMessage(page, 'Restore this full-access conversation after relaunch.')
    await expect.poll(() => callCount(rpcLogPath, 'turn/start'), { timeout: 15_000 }).toBe(1)
    const threadId = onlyCall(await readRpcLog(rpcLogPath), 'thread/start').threadId
    expect(threadId).toBeTruthy()

    await page.reload()
    collectRendererLogs(page, logs)
    await expect(page.locator('[data-slot="composer-approval-mode-selector"]')).toHaveAttribute(
      'data-mode',
      'full-access'
    )

    await closeApp(app)
    app = undefined

    app = await launchApp(backend, logs, launchOptions)
    page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await openPersistedConversation(page, threadId!)
    const selector = page.locator('[data-slot="composer-approval-mode-selector"]')
    await expect(selector).toHaveAttribute('data-mode', 'full-access')

    await page
      .locator('[data-slot="codex-sidebar"]')
      .getByRole('button', { name: '新对话', exact: true })
      .click()
    await expect(selector).toHaveAttribute('data-mode', 'request-approval')
    await selector.click()
    await page
      .locator('[data-slot="composer-approval-mode-menu"] [data-mode="full-access"]')
      .click()
    await expect(page.locator('[data-slot="full-access-confirmation-dialog"]')).toHaveCount(0)
    await expect(selector).toHaveAttribute('data-mode', 'full-access')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([serverStateDir, userDataDir, codexHomeDir])
  }
})

async function withApprovalModeScenario(
  testInfo: Parameters<typeof attachDiagnostics>[0],
  run: (input: {
    page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
    rpcLogPath: string
  }) => Promise<void>
): Promise<void> {
  const serverStateDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-modes-'))
  const rpcLogPath = join(serverStateDir, 'approval-rpc.jsonl')
  const backend = await startMockBackend({ responses: [] })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      environment: {
        CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/approval-modes-app-server.mjs'),
        DASCOWORK_E2E_APPROVAL_RPC_LOG_PATH: rpcLogPath
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await run({ page, rpcLogPath })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([serverStateDir])
  }
}

async function setApprovalMode(page: Page, mode: ApprovalMode): Promise<void> {
  const selector = page.locator('[data-slot="composer-approval-mode-selector"]')
  await selector.click()
  const menu = page.locator('[data-slot="composer-approval-mode-menu"]')
  await expect(menu).toBeVisible()
  await menu.locator(`[data-mode="${mode}"]`).click()

  if (mode === 'full-access') {
    const confirmation = page.locator('[data-slot="full-access-confirmation-dialog"]')
    if (await confirmation.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmation.getByRole('button', { name: '开启完全访问权限', exact: true }).click()
    }
  }

  await expect(selector).toHaveAttribute('data-mode', mode)
}

async function readRpcLog(path: string): Promise<RpcCall[]> {
  const contents = await readFile(path, 'utf8').catch(() => '')
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcCall)
}

async function callCount(path: string, method: string): Promise<number> {
  return (await readRpcLog(path)).filter((call) => call.method === method).length
}

function calls(records: readonly RpcCall[], method: string): RpcCall[] {
  return records.filter((call) => call.method === method)
}

function onlyCall(records: readonly RpcCall[], method: string): RpcCall {
  const matching = calls(records, method)
  expect(matching).toHaveLength(1)
  return matching[0]!
}

function expectThreadSettings(call: RpcCall | undefined, mode: ApprovalMode): void {
  const expected = expectedSettings(mode)
  expect(call?.params).toMatchObject({
    approvalPolicy: expected.approvalPolicy,
    approvalsReviewer: expected.approvalsReviewer,
    sandbox: expected.sandbox
  })
}

function expectTurnSettings(call: RpcCall | undefined, mode: ApprovalMode): void {
  const expected = expectedSettings(mode)
  expect(call?.params).toMatchObject({
    approvalPolicy: expected.approvalPolicy,
    approvalsReviewer: expected.approvalsReviewer
  })
  expect(call?.params?.sandboxPolicy).toEqual(expected.sandboxPolicy)
}

function expectedSettings(mode: ApprovalMode): {
  approvalPolicy: string
  approvalsReviewer: string
  sandbox: string
  sandboxPolicy:
    | { type: 'dangerFullAccess' }
    | {
        type: 'workspaceWrite'
        writableRoots: string[]
        networkAccess: boolean
        excludeTmpdirEnvVar: boolean
        excludeSlashTmp: boolean
      }
} {
  if (mode === 'full-access') {
    return {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' }
    }
  }

  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: mode === 'approve-for-me' ? 'auto_review' : 'user',
    sandbox: 'workspace-write',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [appRoot],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  }
}

async function captureApprovalModeScreenshots(
  page: Page,
  testInfo: Parameters<typeof attachDiagnostics>[0],
  name: string
): Promise<void> {
  const selector = page.locator('[data-slot="composer-approval-mode-selector"]')
  const menu = page.locator('[data-slot="composer-approval-mode-menu"]')

  await selector.click()
  await expect(menu).toBeVisible()
  await captureApprovalModeViewport(page, menu, testInfo, `${name}-desktop`, 1280)
  await captureApprovalModeViewport(page, menu, testInfo, `${name}-narrow`, 420)
  await page.keyboard.press('Escape')
}

async function captureApprovalModeViewport(
  page: Page,
  menu: ReturnType<Page['locator']>,
  testInfo: Parameters<typeof attachDiagnostics>[0],
  name: string,
  width: number
): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width)

  const path = testInfo.outputPath(`approval-mode-${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(`approval-mode-${name}.png`, { contentType: 'image/png', path })

  const documentWidth = await page.locator('body').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }))
  expect(documentWidth.scrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth + 1)

  await page.setViewportSize({ width: 1280, height: 900 })
}

async function conversationCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const result = await window.desktopApp.conversations.getConversationList()
    return result.conversations.length
  })
}

async function openPersistedConversation(page: Page, conversationId: string): Promise<void> {
  await expect.poll(() => conversationTitle(page, conversationId)).not.toBeNull()
  const title = await conversationTitle(page, conversationId)
  expect(title).toBeTruthy()
  await page
    .locator('[data-slot="codex-sidebar"]')
    .getByRole('button', { name: title!, exact: true })
    .click()
}

async function conversationTitle(page: Page, conversationId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const result = await window.desktopApp.conversations.getConversationList()
    const conversation = result.conversations.find(
      (candidate) => candidate.id === id || candidate.threadId === id
    )
    return conversation?.title ?? null
  }, conversationId)
}
