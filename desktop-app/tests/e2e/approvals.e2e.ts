import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { appRoot, attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import {
  assistantMessageAndShellCommandResponse,
  assistantMessageResponse,
  deferred,
  functionCallOutputText,
  providerResponseBodies,
  shellCommandResponse,
  startMockBackend
} from './support/mockBackend'

test('approves a command request through the desktop approval panel', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFinal = deferred()
  const backend = await startMockBackend({
    responses: [
      assistantMessageAndShellCommandResponse(
        'resp-approval-tool',
        'msg-approval-commentary',
        '请确认这条命令。',
        'call-approved-pwd',
        {
          command: 'pwd && printf "\\nE2E_APPROVED_COMMAND"',
          timeout_ms: 5000,
          sandbox_permissions: 'require_escalated',
          justification: 'E2E verifies the desktop approval panel'
        },
        { phase: 'commentary' }
      ),
      {
        ...assistantMessageResponse(
          'resp-approval-final',
          'msg-approval-final',
          'Approved command completed'
        ),
        beforeResponse: () => releaseFinal.promise
      }
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
    await expect(page.locator('[data-slot="reasoning-group-trigger"]')).toContainText('等待确认')
    await expect(page.locator('[data-slot="message-thinking-unit"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="tool-group-trigger"]')).not.toContainText('正在思考')
    await expect(page.locator('[data-slot="tool-group-trigger-icon"]')).toBeVisible()

    await panel.getByRole('button', { name: 'Approve', exact: true }).click()

    await expect(page.locator('[data-slot="reasoning-group-trigger"]')).toContainText('已处理')
    await expect(page.locator('[data-slot="tool-group-trigger"]')).not.toContainText('正在思考')
    await expect(page.locator('[data-slot="tool-group-trigger-icon"]')).toBeVisible()
    await expect(page.locator('[data-slot="message-thinking-unit"]')).toHaveCount(0)

    releaseFinal.resolve()

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Approved command completed'
    )
    await expect(panel).toBeHidden()
    const completedReasoningTrigger = page.locator('[data-slot="reasoning-group-trigger"]')
    await expect(completedReasoningTrigger).toContainText('已处理')
    await completedReasoningTrigger.click()
    await expect(page.locator('[data-slot="tool-group-trigger"]')).not.toContainText('正在思考')
    await expect(page.locator('[data-slot="tool-group-trigger-icon"]')).toBeVisible()
    await expect(page.locator('[data-slot="message-thinking-unit"]')).toHaveCount(0)

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    const toolOutput = functionCallOutputText(providerBodies[1], 'call-approved-pwd')
    expect(toolOutput).toContain(appRoot)
    expect(toolOutput).toContain('E2E_APPROVED_COMMAND')
  } finally {
    releaseFinal.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
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
    await closeApp(app)
    await backend.close()
  }
})

test('keeps simultaneous conversation approvals independently actionable', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const runId = Date.now().toString(36)
  const firstPrompt = `approval-first-${runId}`
  const secondPrompt = `approval-second-${runId}`
  const firstMarker = `APPROVAL_FIRST_${runId}`
  const secondMarker = `APPROVAL_SECOND_${runId}`
  const firstFinal = `approval first completed ${runId}`
  const secondFinal = `approval second completed ${runId}`
  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-approval-first-tool', 'call-approval-first', {
        command: `printf ${firstMarker}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies approval isolation'
      }),
      shellCommandResponse('resp-approval-second-tool', 'call-approval-second', {
        command: `printf ${secondMarker}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies approval isolation'
      }),
      assistantMessageResponse('resp-approval-first-final', 'msg-approval-first-final', firstFinal),
      assistantMessageResponse(
        'resp-approval-second-final',
        'msg-approval-second-final',
        secondFinal
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
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText(firstMarker)

    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, secondPrompt)
    await expect(panel.locator('article')).toHaveCount(2)

    const firstCard = panel.locator('article').filter({ hasText: firstMarker })
    const secondCard = panel.locator('article').filter({ hasText: secondMarker })
    await expect(firstCard).toContainText(firstPrompt)
    await expect(secondCard).toContainText(secondPrompt)

    await firstCard.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(firstCard).toHaveCount(0)
    await expect(secondCard).toBeVisible()

    await secondCard.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondFinal })
    ).toBeVisible()

    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstFinal })
    ).toBeVisible()
    expect(providerResponseBodies(backend)).toHaveLength(4)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})
