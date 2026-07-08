import { test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { appRoot, attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { sendMessage } from './support/chatActions'
import {
  assistantMessageResponse,
  functionCallOutputText,
  providerResponseBodies,
  shellCommandResponse,
  startMockBackend
} from './support/mockBackend'

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
