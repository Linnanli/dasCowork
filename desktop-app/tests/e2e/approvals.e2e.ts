import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect, type Locator } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import { planAssert } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  crashApp,
  launchApp
} from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import { conversationKeyForStartedTurn, readFollowUpQueueState } from './support/followUpQueueState'
import {
  countProtocolNotifications,
  expectTerminalScenario,
  type PlanAssertionEvidence
} from './support/terminalScenario'
import {
  assistantMessageAndShellCommandResponse,
  assistantMessageResponse,
  deferred,
  disconnectingResponse,
  functionCallOutputCount,
  functionCallOutputText,
  providerResponseBodies,
  responseCompleted,
  responseCreated,
  shellCommandResponse,
  startMockBackend
} from './support/mockBackend'

const mockAssertions = [
  '最终 UI 状态',
  'terminal 类型和次数',
  '队列状态、顺序与 revision',
  'turn started 数量',
  'provider 请求数量',
  'tool/approval 执行数量',
  'renderer/page 健康'
]
const conversationAssertions = [
  '已显示回答保持不变',
  '复用原 turn，不能额外启动 turn',
  '队列顺序与对话隔离正确'
]
const planAssertionsByScenario: Record<string, readonly string[]> = {
  A09: conversationAssertions,
  M11: mockAssertions
}

function approvalCards(panel: Locator): Locator {
  return panel.locator('[data-codex-approval-surface="true"]')
}

function planEvidence(_testName: string, scenarioIds: readonly string[]): PlanAssertionEvidence[] {
  return scenarioIds.flatMap((scenarioId) =>
    (planAssertionsByScenario[scenarioId] ?? []).map((assertionId) => ({
      scenarioId,
      assertionId
    }))
  )
}

test.describe.configure({ timeout: 90_000 })

test('M11/D12 @approval-retry approves a command request through the desktop approval panel', async ({
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
    await expect(panel).toContainText('是否允许执行以下命令？')
    await expect(panel).toContainText('pwd')
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await attachApprovalScreenshots(page, testInfo, 'command')
    await expect(page.locator('[data-slot="reasoning-group-trigger"]')).toContainText('等待确认')
    await expect(page.locator('[data-slot="message-thinking-unit"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="tool-group-trigger"]')).not.toContainText('正在思考')
    await expect(page.locator('[data-slot="tool-group-trigger-icon"]')).toBeVisible()

    await panel.getByRole('button', { name: '允许一次', exact: true }).click()

    await expect(page.locator('[data-slot="reasoning-group-trigger"]')).toContainText('已处理')
    await expect(page.locator('[data-slot="tool-group-trigger"]')).not.toContainText('正在思考')
    await expect(page.locator('[data-slot="tool-group-trigger-icon"]')).toBeVisible()
    await expect(page.locator('[data-slot="message-thinking-unit"]')).toHaveCount(0)

    releaseFinal.resolve()

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Approved command completed'
    )
    await expect(panel).toBeHidden()
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
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
    const evidence = planEvidence(
      'M11/D12 @approval-retry approves a command request through the desktop approval panel',
      ['M11']
    )
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      queue: { items: [] },
      planEvidence: withoutQueueStateEvidence(evidence, 'M11')
    })
    await assertEmptyQueueStateEvidence(evidence, page, logs)
    await planAssert({
      scenarioId: 'D12',
      assertionId: '批准后执行一次并返回工具输出',
      assertion: async () => {
        expect(providerBodies).toHaveLength(2)
        expect(functionCallOutputCount(providerBodies, 'call-approved-pwd')).toBe(1)
        expect(functionCallOutputText(providerBodies[1], 'call-approved-pwd')).toContain(
          'E2E_APPROVED_COMMAND'
        )
        await expect(page.locator('[data-role="assistant"]')).toContainText(
          'Approved command completed'
        )
      }
    })
  } finally {
    releaseFinal.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-08 restores one pending approval after renderer reload', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFinal = deferred()
  const backend = await startMockBackend({
    responses: [
      assistantMessageAndShellCommandResponse(
        'resp-approval-reload-tool',
        'msg-approval-reload-commentary',
        '等待确认后继续。',
        'call-approval-reload',
        {
          command: 'pwd && printf "\\nE2E_RELOADED_APPROVAL"',
          timeout_ms: 5000,
          sandbox_permissions: 'require_escalated',
          justification: 'E2E verifies approval recovery after reload'
        },
        { phase: 'commentary' }
      ),
      {
        ...assistantMessageResponse(
          'resp-approval-reload-final',
          'msg-approval-reload-final',
          'Approval survived the renderer reload'
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
    await sendMessage(page, '运行 pwd，等待批准。')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('是否允许执行以下命令？')
    await page.reload()
    collectRendererLogs(page, logs)

    await expect(panel).toHaveCount(1)
    await expect(panel).toContainText('是否允许执行以下命令？')
    await panel.getByRole('button', { name: '允许一次', exact: true }).click()
    releaseFinal.resolve()

    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Approval survived the renderer reload' })
    ).toHaveCount(1)
    await expect(panel).toBeHidden()
    expect(providerResponseBodies(backend)).toHaveLength(2)
    expect(functionCallOutputCount(providerResponseBodies(backend), 'call-approval-reload')).toBe(1)
  } finally {
    releaseFinal.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('P002-E2E-02 replays one active thread-bound stream with text and a tool after renderer reload', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFinal = deferred()
  const commentaryText = 'The tool request is part of this active turn.'
  const finalText = 'The active turn completed once after reload.'
  const backend = await startMockBackend({
    responses: [
      {
        events: [
          responseCreated('resp-thread-bound-reload-tool'),
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-thread-bound-reload-commentary',
              content: [{ type: 'output_text', text: '' }]
            }
          },
          { type: 'response.output_text.delta', delta: commentaryText },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-thread-bound-reload-commentary',
              content: [{ type: 'output_text', text: commentaryText }],
              phase: 'commentary'
            }
          },
          {
            type: 'response.output_item.done',
            item: {
              type: 'function_call',
              call_id: 'call-thread-bound-reload-tool',
              name: 'shell_command',
              arguments: JSON.stringify({
                command: 'pwd && printf "\\nE2E_THREAD_BOUND_RELOAD_TOOL"',
                timeout_ms: 5000,
                sandbox_permissions: 'require_escalated',
                justification: 'E2E verifies exactly-once active-turn recovery'
              })
            }
          },
          responseCompleted('resp-thread-bound-reload-tool')
        ]
      },
      {
        ...assistantMessageResponse(
          'resp-thread-bound-reload-final',
          'msg-thread-bound-reload-final',
          finalText
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
    await sendMessage(page, 'Run one command, then continue after approval.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(page.getByText(commentaryText, { exact: true })).toHaveCount(1)
    await expect(panel).toContainText('是否允许执行以下命令？')

    await page.reload()
    collectRendererLogs(page, logs)

    await expect(page.getByText(commentaryText, { exact: true })).toHaveCount(1)
    await expect(panel).toHaveCount(1)
    await expect(panel).toContainText('是否允许执行以下命令？')
    await panel.getByRole('button', { name: '允许一次', exact: true }).click()
    releaseFinal.resolve()

    await expect(page.getByText(finalText, { exact: true })).toHaveCount(1)
    await expect(panel).toBeHidden()
    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    expect(functionCallOutputCount(providerBodies, 'call-thread-bound-reload-tool')).toBe(1)
  } finally {
    releaseFinal.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('M11/D13/D17 @approval-retry rejects a command request through the desktop approval panel', async ({
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
    await expect(panel).toContainText('是否允许执行以下命令？')
    await expect(panel).toContainText('pwd')

    await panel.getByRole('button', { name: '拒绝' }).click()

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Command was rejected by the user'
    )
    await expect(panel).toBeHidden()

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(2)
    const toolOutput = functionCallOutputText(providerBodies[1], 'call-rejected-pwd')
    expect(toolOutput).toBe('exec command rejected by user')
    expect(toolOutput).not.toContain('E2E_REJECTED_COMMAND_SHOULD_NOT_RUN')
    const evidence = planEvidence(
      'M11/D13/D17 @approval-retry rejects a command request through the desktop approval panel',
      ['M11']
    )
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      queue: { items: [] },
      planEvidence: withoutQueueStateEvidence(evidence, 'M11')
    })
    await assertEmptyQueueStateEvidence(evidence, page, logs)
    await planAssert({
      scenarioId: 'D13',
      assertionId: '拒绝后不执行命令并返回拒绝结果',
      assertion: () => {
        expect(providerBodies).toHaveLength(2)
        expect(functionCallOutputText(providerBodies[1], 'call-rejected-pwd')).toBe(
          'exec command rejected by user'
        )
        expect(functionCallOutputText(providerBodies[1], 'call-rejected-pwd')).not.toContain(
          'E2E_REJECTED_COMMAND_SHOULD_NOT_RUN'
        )
      }
    })
    await planAssert({
      scenarioId: 'D17',
      assertionId: '拒绝不会自动重试或重复工具请求',
      assertion: () => {
        expect(providerBodies).toHaveLength(2)
        expect(functionCallOutputCount(providerBodies, 'call-rejected-pwd')).toBe(1)
      }
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('D12 @approval-retry keeps simultaneous conversation approvals independently actionable', async ({
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
    const secondCard = approvalCards(panel).filter({ hasText: secondMarker })
    await expect(secondCard).toBeVisible()

    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    const firstCard = approvalCards(panel).filter({ hasText: firstMarker })
    await expect(firstCard).toBeVisible()
    await firstCard.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(firstCard).toHaveCount(0)
    await expect.poll(() => providerResponseBodies(backend)).toHaveLength(3)

    await sidebar.getByRole('button', { name: new RegExp(`^${secondPrompt}`) }).click()
    await expect(secondCard).toBeVisible()
    await secondCard.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: secondFinal })
    ).toBeVisible()

    await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: firstFinal })
    ).toBeVisible()
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      terminalEventCount: 2,
      providerRequestCount: 4,
      turnStartedCount: 2,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 2,
      queue: { items: [] }
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('M11/A09/D14 @approval-retry replaces composer while approval is pending, then restores it after rejection', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const visibleAssistantText = 'The assistant text remains visible while this approval is pending.'
  const backend = await startMockBackend({
    responses: [
      assistantMessageAndShellCommandResponse(
        'resp-approval-steer-stop',
        'msg-approval-steer-stop',
        visibleAssistantText,
        'call-approval-steer-stop',
        {
          command: 'pwd',
          timeout_ms: 5_000,
          sandbox_permissions: 'require_escalated',
          justification: 'E2E verifies approval replacement and rejection ordering'
        },
        { phase: 'commentary' }
      ),
      assistantMessageResponse(
        'resp-approval-reject-final',
        'msg-approval-reject-final',
        'The command was rejected and the composer is available again.'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Start a command that waits for approval.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('是否允许执行以下命令？')
    const visibleAssistant = page
      .locator('[data-role="assistant"]')
      .filter({ hasText: visibleAssistantText })
    await expect(visibleAssistant).toHaveCount(1)
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
    await planAssert({
      scenarioId: 'A09',
      assertionId: '已显示回答保持不变',
      assertion: () => expect(visibleAssistant).toHaveCount(1)
    })
    await planAssert({
      scenarioId: 'A09',
      assertionId: '队列顺序与对话隔离正确',
      assertion: () => expect(page.locator('[data-slot="queued-follow-up-list"]')).toHaveCount(0)
    })

    await panel.getByRole('button', { name: '拒绝', exact: true }).click()
    const evidence = planEvidence(
      'M11/A09/D14 @approval-retry replaces composer while approval is pending, then restores it after rejection',
      ['M11']
    )
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      planEvidence: withoutQueueStateEvidence(evidence, 'M11')
    })
    await assertEmptyQueueStateEvidence(evidence, page, logs)
    await expect(panel).toHaveCount(0)
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
    await planAssert({
      scenarioId: 'D14',
      assertionId: '审批待处理时不显示独立停止按钮，拒绝后恢复 composer',
      assertion: async () => {
        expect(providerResponseBodies(backend)).toHaveLength(2)
        expect(
          functionCallOutputCount(providerResponseBodies(backend), 'call-approval-steer-stop')
        ).toBe(1)
        expect(
          functionCallOutputText(providerResponseBodies(backend)[1], 'call-approval-steer-stop')
        ).toBe('exec command rejected by user')
        await expect(panel).toHaveCount(0)
        await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
      }
    })
    await planAssert({
      scenarioId: 'A09',
      assertionId: '拒绝后复用原 turn，不额外启动 turn',
      assertion: () => expect(providerResponseBodies(backend)).toHaveLength(2)
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

test('M11/D15 @approval-retry invalidates a pending approval after crash, then rejects the new approval before transport failure', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const userDataDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-crash-user-data-'))
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-crash-codex-home-'))
  const firstCallId = 'call-approval-before-crash'
  const secondCallId = 'call-approval-after-crash'
  const firstMarker = 'APPROVAL_BEFORE_CRASH_MUST_NOT_RUN'
  const secondMarker = 'APPROVAL_AFTER_CRASH_MUST_BE_REJECTED'
  const firstPrompt = `approval-crash-${Date.now().toString(36)}`
  const secondPrompt = `approval-after-restart-${Date.now().toString(36)}`
  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-approval-before-crash', firstCallId, {
        command: `printf ${firstMarker}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies approval invalidation across a crash'
      }),
      shellCommandResponse('resp-approval-after-crash', secondCallId, {
        command: `printf ${secondMarker}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies a fresh approval after restart'
      }),
      disconnectingResponse('resp-approval-after-crash-final-failure')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined
  const launchPersistentApp = (): Promise<ElectronApplication> =>
    launchApp(backend, logs, {
      userDataDir,
      codexHomeDir,
      preserveDataDirectories: true
    })

  try {
    app = await launchPersistentApp()
    let page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, firstPrompt)
    const panel = page.locator('[data-slot="server-request-panel"]')
    const firstCard = approvalCards(panel).filter({ hasText: firstMarker })
    await expect(firstCard).toBeVisible()
    const firstApprovalId = await firstCard.getAttribute('data-request-id')
    expect(firstApprovalId).toBeTruthy()
    await expect(approvalCards(panel)).toHaveCount(1)
    expect(functionCallOutputText(providerResponseBodies(backend)[0], firstCallId)).toBeUndefined()

    await crashApp(app)
    app = undefined
    app = await launchPersistentApp()
    page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(
      page.evaluate(async (requestId) => {
        await window.desktopApp.codex.respondApproval(requestId, { action: 'approve' })
      }, firstApprovalId!)
    ).rejects.toThrow(/Unknown approval request/u)
    await expect(approvalCards(page.locator('[data-slot="server-request-panel"]'))).toHaveCount(0)
    expect(providerResponseBodies(backend)).toHaveLength(1)
    expect(functionCallOutputText(providerResponseBodies(backend)[0], firstCallId)).toBeUndefined()

    await sendMessage(page, secondPrompt)
    const restartedPanel = page.locator('[data-slot="server-request-panel"]')
    const secondCard = approvalCards(restartedPanel).filter({ hasText: secondMarker })
    await expect(secondCard).toBeVisible()
    const secondApprovalId = await secondCard.getAttribute('data-request-id')
    expect(secondApprovalId).toBeTruthy()
    expect(secondApprovalId).not.toBe(firstApprovalId)
    await expect(approvalCards(restartedPanel)).toHaveCount(1)
    expect(functionCallOutputText(providerResponseBodies(backend)[1], secondCallId)).toBeUndefined()

    await secondCard.getByRole('button', { name: '拒绝' }).click()
    const evidence = planEvidence(
      'M11/D15 @approval-retry invalidates a pending approval after crash, then rejects the new approval before transport failure',
      ['M11']
    )
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'error',
      providerRequestCount: 3,
      turnStartedCount: 2,
      terminalEventCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      queue: { items: [] },
      planEvidence: withoutQueueStateEvidence(evidence, 'M11')
    })
    await assertEmptyQueueStateEvidence(evidence, page, logs)
    expect(functionCallOutputText(providerResponseBodies(backend)[2], secondCallId)).toBe(
      'exec command rejected by user'
    )
    expect(functionCallOutputText(providerResponseBodies(backend)[2], secondCallId)).not.toContain(
      secondMarker
    )
    await expect(approvalCards(restartedPanel)).toHaveCount(0)
    await planAssert({
      scenarioId: 'D15',
      assertionId: '终态后旧审批失效且不能再执行',
      assertion: async () => {
        expect(providerResponseBodies(backend)).toHaveLength(3)
        expect(
          functionCallOutputText(providerResponseBodies(backend)[0], firstCallId)
        ).toBeUndefined()
        expect(functionCallOutputText(providerResponseBodies(backend)[2], secondCallId)).toBe(
          'exec command rejected by user'
        )
        await expect(approvalCards(restartedPanel)).toHaveCount(0)
      }
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([userDataDir, codexHomeDir])
  }
})

test('D18 @approval-retry requires new turn, approval, and call ids before rerunning a side-effecting tool', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const firstCallId = 'call-retry-side-effect-first'
  const secondCallId = 'call-retry-side-effect-second'
  const firstMarker = 'E2E_SIDE_EFFECT_FIRST'
  const secondMarker = 'E2E_SIDE_EFFECT_SECOND'
  const sideEffectDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-approval-retry-side-effects-'))
  const firstMarkerPath = join(sideEffectDir, 'first-marker.txt')
  const secondMarkerPath = join(sideEffectDir, 'second-marker.txt')
  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-retry-side-effect-first-tool', firstCallId, {
        command: `printf '%s\\n' ${shellQuote(firstMarker)} >> ${shellQuote(firstMarkerPath)}; printf '%s' ${shellQuote(firstMarker)}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies retry approval isolation'
      }),
      disconnectingResponse('resp-retry-side-effect-first-final'),
      shellCommandResponse('resp-retry-side-effect-second-tool', secondCallId, {
        command: `printf '%s\\n' ${shellQuote(secondMarker)} >> ${shellQuote(secondMarkerPath)}; printf '%s' ${shellQuote(secondMarker)}`,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E verifies retry approval isolation'
      }),
      assistantMessageResponse(
        'resp-retry-side-effect-second-final',
        'msg-retry-side-effect-second-final',
        'The retried command completed after its new approval.'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await sendMessage(page, 'Run a side-effecting command, fail, then retry it.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText(firstMarker)
    const firstApprovalCard = approvalCards(panel).filter({ hasText: firstMarker })
    const firstApprovalId = await firstApprovalCard.getAttribute('data-request-id')
    expect(firstApprovalId).toBeTruthy()
    expect(providerResponseBodies(backend)).toHaveLength(1)
    expect(functionCallOutputText(providerResponseBodies(backend)[0], firstCallId)).toBeUndefined()
    await expect.poll(() => readMarkerLines(firstMarkerPath)).toEqual([])
    await firstApprovalCard.getByRole('button', { name: '允许一次', exact: true }).click()

    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'error',
      providerRequestCount: 2,
      turnStartedCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      queue: { items: [] }
    })
    const firstAttemptBodies = providerResponseBodies(backend)
    expect(functionCallOutputText(firstAttemptBodies[1], firstCallId)).toContain(firstMarker)
    await expect.poll(() => readMarkerLines(firstMarkerPath)).toEqual([firstMarker])
    await page.locator('[data-slot="aui_assistant-message-retry"]').click()
    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    const retriedConversation = sidebar
      .getByRole('button', { name: /^Run a side-effecting command/u })
      .last()
    await expect(retriedConversation).toBeVisible()
    await retriedConversation.click()
    await expect(panel).toContainText(secondMarker)
    const secondApprovalCard = approvalCards(panel).filter({ hasText: secondMarker })
    const secondApprovalId = await secondApprovalCard.getAttribute('data-request-id')
    expect(secondApprovalId).toBeTruthy()
    expect(secondApprovalId).not.toBe(firstApprovalId)
    await expect(firstApprovalCard).toHaveCount(0)
    await expect.poll(() => providerResponseBodies(backend).length).toBe(3)
    const secondApprovalBodies = providerResponseBodies(backend)
    expect(functionCallOutputText(secondApprovalBodies[2], secondCallId)).toBeUndefined()
    expect(functionCallOutputCount(secondApprovalBodies, secondCallId)).toBe(0)
    expect(await readMarkerLines(firstMarkerPath)).toEqual([firstMarker])
    expect(await readMarkerLines(secondMarkerPath)).toEqual([])
    await expect(approvalCards(panel)).toHaveCount(1)
    await expect(
      page.evaluate(async (requestId) => {
        await window.desktopApp.codex.respondApproval(requestId, { action: 'approve' })
      }, firstApprovalId!)
    ).rejects.toThrow(/Unknown approval request/u)
    await expect(approvalCards(panel)).toHaveCount(1)
    const staleApprovalBodies = providerResponseBodies(backend)
    expect(functionCallOutputText(staleApprovalBodies[2], secondCallId)).toBeUndefined()
    expect(functionCallOutputCount(staleApprovalBodies, secondCallId)).toBe(0)
    expect(await readMarkerLines(firstMarkerPath)).toEqual([firstMarker])
    expect(await readMarkerLines(secondMarkerPath)).toEqual([])

    await secondApprovalCard.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(
      page.locator('[data-role="assistant"]').filter({
        hasText: 'The retried command completed after its new approval.'
      })
    ).toHaveCount(1)
    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(4)
    expect(functionCallOutputText(providerBodies[3], secondCallId)).toContain(secondMarker)
    expect(functionCallOutputCount(providerBodies, secondCallId)).toBe(1)
    await expect.poll(() => readMarkerLines(firstMarkerPath)).toEqual([firstMarker])
    await expect.poll(() => readMarkerLines(secondMarkerPath)).toEqual([secondMarker])
    expect(secondCallId).not.toBe(firstCallId)
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      providerRequestCount: 4,
      turnStartedCount: 2,
      terminalEventCount: 2,
      canonicalOutcomeEventCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 2,
      queue: { items: [] }
    })
    await planAssert({
      scenarioId: 'D18',
      assertionId: '手动重试使用新的 turn、call ID、approval ID',
      assertion: async () => {
        expect(secondApprovalId).not.toBe(firstApprovalId)
        expect(secondCallId).not.toBe(firstCallId)
        expect(providerBodies).toHaveLength(4)
        expect(functionCallOutputCount([providerBodies[1]], firstCallId)).toBe(1)
        expect(functionCallOutputCount([providerBodies[3]], secondCallId)).toBe(1)
        await expect.poll(() => readMarkerLines(firstMarkerPath)).toEqual([firstMarker])
        await expect.poll(() => readMarkerLines(secondMarkerPath)).toEqual([secondMarker])
        expect(countProtocolNotifications(logs, 'turn/started')).toBe(2)
      }
    })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([sideEffectDir])
  }
})

async function attachApprovalScreenshots(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  testInfo: Parameters<typeof attachDiagnostics>[0],
  name: string
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  const desktopPath = testInfo.outputPath(`approval-${name}-desktop.png`)
  await page.screenshot({ path: desktopPath })
  await testInfo.attach(`approval-${name}-desktop.png`, {
    contentType: 'image/png',
    path: desktopPath
  })

  await page.setViewportSize({ width: 420, height: 900 })
  const narrowPath = testInfo.outputPath(`approval-${name}-narrow.png`)
  await page.screenshot({ path: narrowPath })
  await testInfo.attach(`approval-${name}-narrow.png`, {
    contentType: 'image/png',
    path: narrowPath
  })
  const width = await page.locator('body').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }))
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1)

  await page.setViewportSize({ width: 1280, height: 900 })
}

async function readMarkerLines(markerPath: string): Promise<string[]> {
  try {
    return (await readFile(markerPath, 'utf8')).split('\n').filter(Boolean)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function withoutQueueStateEvidence(
  evidence: readonly PlanAssertionEvidence[],
  scenarioId: string
): PlanAssertionEvidence[] {
  return evidence.filter(
    (entry) => entry.scenarioId !== scenarioId || entry.assertionId !== '队列状态、顺序与 revision'
  )
}

async function assertEmptyQueueStateEvidence(
  evidence: readonly PlanAssertionEvidence[],
  page: Parameters<typeof readFollowUpQueueState>[0],
  logs: readonly string[],
  expectedRevision = 0
): Promise<void> {
  const conversationKey = conversationKeyForStartedTurn(logs)
  const evidenceEntry = evidence.find(
    (entry) => entry.scenarioId === 'M11' && entry.assertionId === '队列状态、顺序与 revision'
  )
  if (!evidenceEntry) throw new Error('M11 queue evidence is missing.')
  await planAssert({
    ...evidenceEntry,
    assertion: async () => {
      expect(await readFollowUpQueueState(page, conversationKey)).toEqual({
        conversationKey,
        revision: expectedRevision,
        items: []
      })
    }
  })
}
