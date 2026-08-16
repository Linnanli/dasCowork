import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { sendComposerMessage, sendMessage } from './support/chatActions'
import { conversationKeyForStartedTurn } from './support/followUpQueueState'
import { expectTerminalScenario, type PlanAssertionEvidence } from './support/terminalScenario'
import { planAssert } from '../../scripts/lib/test-plan-assertions.mjs'
import {
  assistantMessageResponse,
  deferred,
  disconnectingResponse,
  functionCallOutputText,
  providerResponseBodies,
  responseCompleted,
  responseCreated,
  shellCommandResponse,
  startMockBackend,
  type MockBackend,
  type ResponsesStep,
  type ResponsesStreamStep
} from './support/mockBackend'

const terminalAssertions = [
  '保留可见内容并显示单一终态',
  'terminal 只结算一次且 Composer 恢复',
  '无自动重试、额外请求或迟到事件应用'
]
const queueAssertions = [
  '队列顺序、revision、lease 与消费状态正确',
  '重启从持久化状态恢复',
  '不能重复 claim 或自动重发'
]
const uiAssertions = [
  '错误、取消与重试 UI 正确',
  '历史与已显示内容保留',
  '可访问性、脱敏和 Composer 状态正确'
]
const mockAssertions = [
  '最终 UI 状态',
  'terminal 类型和次数',
  '队列状态、顺序与 revision',
  'turn started 数量',
  'provider 请求数量',
  'tool/approval 执行数量',
  'renderer/page 健康'
]
const raceAssertions = [
  'claim、接受与队列结算至多一次',
  '正确的恢复、暂停或拒绝状态',
  'terminal 和 active run 不被竞态覆盖'
]
const planAssertionsByScenario: Record<string, readonly string[]> = {
  B10: raceAssertions,
  C02: terminalAssertions,
  C03: terminalAssertions,
  C04: terminalAssertions,
  C05: terminalAssertions,
  C07: terminalAssertions,
  C08: terminalAssertions,
  C10: terminalAssertions,
  C12: terminalAssertions,
  C13: terminalAssertions,
  C14: terminalAssertions,
  C16: terminalAssertions,
  C17: terminalAssertions,
  C20: terminalAssertions,
  C21: terminalAssertions,
  D16: [
    '工具、审批记录与执行次数正确',
    '失败和拒绝不伪装成完成',
    '旧 tool 结果保持且不随重试重复执行'
  ],
  E08: queueAssertions,
  E15: queueAssertions,
  F02: uiAssertions,
  F08: uiAssertions,
  F12: uiAssertions,
  F13: uiAssertions,
  F16: uiAssertions,
  F17: uiAssertions,
  F19: uiAssertions,
  G06: ['跨对话与信任边界隔离', '资源、并发和终态无残留', '诊断可关联而不泄露密钥'],
  M02: mockAssertions,
  M03: mockAssertions,
  M06: mockAssertions,
  M07: mockAssertions,
  M08: mockAssertions,
  M09: mockAssertions,
  M10: mockAssertions,
  M12: mockAssertions
}

function planEvidence(_testName: string, scenarioIds: readonly string[]): PlanAssertionEvidence[] {
  return scenarioIds.flatMap((scenarioId) =>
    (planAssertionsByScenario[scenarioId] ?? []).map((assertionId) => ({
      scenarioId,
      assertionId
    }))
  )
}

test('M02/C10/D16/E08/E15/F16 @terminal-failure keeps a completed tool after final failure and restart', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  await runCompletedToolAndAcceptedSteerRecoveryScenario(
    testInfo,
    'completed-tool',
    planEvidence(
      'M02/C10/D16/E08/E15/F16 @terminal-failure keeps a completed tool after final failure and restart',
      ['M02', 'M09', 'C10', 'D16', 'E08', 'E15', 'F16']
    )
  )
})

test('M06/E08 @terminal-failure keeps an accepted steer consumed after final failure and restart', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  await runCompletedToolAndAcceptedSteerRecoveryScenario(
    testInfo,
    'accepted-steer',
    planEvidence(
      'M06/E08 @terminal-failure keeps an accepted steer consumed after final failure and restart',
      ['M06', 'E08']
    )
  )
})

async function runCompletedToolAndAcceptedSteerRecoveryScenario(
  testInfo: TestInfo,
  focus: 'completed-tool' | 'accepted-steer',
  evidence: PlanAssertionEvidence[]
): Promise<void> {
  const userDataDir = await mkdtemp(join(tmpdir(), `dascowork-e2e-${focus}-recovery-user-data-`))
  const codexHomeDir = await mkdtemp(join(tmpdir(), `dascowork-e2e-${focus}-recovery-codex-home-`))
  const releaseInitialResponse = deferred()
  const prompt = 'Start a turn and wait for a follow-up.'
  const followUp = 'Use one read-only tool, then explain its result.'
  const initialResponse = assistantMessageResponse(
    'resp-follow-up-failure-initial',
    'msg-follow-up-failure-initial',
    'The initial answer is already visible.'
  )
  const backend = await startMockBackend({
    responses: [
      {
        ...initialResponse,
        beforeEvent: (_event, index) =>
          index === initialResponse.events.length - 1 ? releaseInitialResponse.promise : undefined
      },
      shellCommandResponse('resp-follow-up-failure-tool', 'call-follow-up-failure-pwd', {
        command: 'pwd',
        timeout_ms: 5_000,
        sandbox_permissions: 'require_escalated',
        justification: 'E2E executes the recovery fixture command outside the Linux runner sandbox'
      }),
      disconnectingResponse('resp-follow-up-failure-final'),
      assistantMessageResponse(
        'resp-follow-up-failure-retry',
        'msg-follow-up-failure-retry',
        'Recovered after the explicit retry.'
      )
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

    await sendMessage(page, prompt)
    await expect
      .poll(() => logs.some((line) => line.includes('"method":"turn/started"')))
      .toBe(true)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The initial answer is already visible.' })
    ).toHaveCount(1)

    const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await input.fill(followUp)
    await page.getByRole('button', { name: '将追问加入队列' }).click()

    const queuedSteer = page
      .locator('[data-slot="queued-follow-up-row"]')
      .filter({ hasText: followUp })
    await expect(queuedSteer).toHaveCount(1)
    const queuedStateBeforeSteer = await readFollowUpQueueState(page)
    const queuedItemId = queuedStateBeforeSteer.items[0]?.id
    expect(queuedStateBeforeSteer.items).toEqual([
      {
        id: queuedItemId,
        status: 'queued',
        text: followUp,
        lease: null
      }
    ])
    await queuedSteer.getByRole('button', { name: /引导第 \d+ 条排队消息/u }).click()

    await expect(queuedSteer).toHaveCount(0)
    await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(1)
    const claimedQueueState = await readFollowUpQueueState(
      page,
      queuedStateBeforeSteer.conversationKey
    )
    expect(claimedQueueState).toEqual({
      conversationKey: queuedStateBeforeSteer.conversationKey,
      revision: queuedStateBeforeSteer.revision + 1,
      items: [
        {
          id: queuedItemId,
          status: 'steering',
          text: followUp,
          lease: { operation: 'turn-steer', owner: 'main' }
        }
      ]
    })
    await expect
      .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
      .toBe(1)
    expect(providerResponseBodies(backend)).toHaveLength(1)

    releaseInitialResponse.resolve()

    await approveE2eFixtureCommand(page)

    await expect.poll(() => providerResponseBodies(backend).length).toBe(3)
    await expect(page.locator('[data-slot="tool-group-unit"]')).toBeVisible()
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'error',
      preservedAssistantText: 'The initial answer is already visible.',
      providerRequestCount: 3,
      turnStartedCount: 1,
      pendingApprovalCount: 0,
      observedToolCount: 1,
      toolResultCount: 1,
      queue: { items: [] },
      planEvidence: evidence.filter(
        ({ assertionId }) =>
          assertionId !== '旧 tool 结果保持且不随重试重复执行' &&
          assertionId !== '重启从持久化状态恢复' &&
          assertionId !== '队列状态、顺序与 revision' &&
          assertionId !== '队列顺序、revision、lease 与消费状态正确' &&
          assertionId !== '不能重复 claim 或自动重发'
      )
    })
    const consumedQueueState = await readFollowUpQueueState(
      page,
      queuedStateBeforeSteer.conversationKey
    )
    expect(consumedQueueState).toEqual({
      conversationKey: queuedStateBeforeSteer.conversationKey,
      revision: queuedStateBeforeSteer.revision + 3,
      items: []
    })
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The initial answer is already visible.' })
    ).toHaveCount(1)
    if (focus === 'accepted-steer') {
      await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(1)
      await expect(
        page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: followUp })
      ).toHaveCount(0)
    }

    const providerBodies = providerResponseBodies(backend)
    expect(providerBodies).toHaveLength(3)
    expect(functionCallOutputText(providerBodies[2], 'call-follow-up-failure-pwd')).toContain(
      appRoot
    )

    await closeApp(app)
    app = undefined
    app = await launchPersistentApp()
    page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await page
      .locator('[data-slot="codex-sidebar"]')
      .getByRole('button', { name: new RegExp(`^${prompt}`) })
      .click()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The initial answer is already visible.' })
    ).toHaveCount(1)
    if (focus === 'accepted-steer') {
      await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(1)
      await expect(
        page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: followUp })
      ).toHaveCount(0)
    } else {
      await expect(page.locator('[data-slot="tool-group-unit"]')).toBeVisible()
    }
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(1)
    expect(providerResponseBodies(backend)).toHaveLength(3)
    const recoveredQueueState = await readFollowUpQueueState(
      page,
      queuedStateBeforeSteer.conversationKey
    )
    await assertPlanEvidence(evidence, '重启从持久化状态恢复', async () => {
      await expect(
        page
          .locator('[data-role="assistant"]')
          .filter({ hasText: 'The initial answer is already visible.' })
      ).toHaveCount(1)
      await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(1)
      await expect.poll(() => providerResponseBodies(backend).length).toBe(3)
      if (focus === 'accepted-steer') {
        await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(
          1
        )
        await expect(
          page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: followUp })
        ).toHaveCount(0)
      } else {
        await expect(page.locator('[data-slot="tool-group-unit"]')).toBeVisible()
      }
      expect(recoveredQueueState).toEqual(consumedQueueState)
    })
    await assertPlanEvidence(evidence, '队列状态、顺序与 revision', async () => {
      await expect(page.locator('[data-slot="queued-follow-up-row"]')).toHaveCount(0)
      expect(recoveredQueueState).toEqual({
        conversationKey: queuedStateBeforeSteer.conversationKey,
        revision: queuedStateBeforeSteer.revision + 3,
        items: []
      })
    })
    await assertPlanEvidence(evidence, '队列顺序、revision、lease 与消费状态正确', () => {
      expect(queuedItemId).toBeTruthy()
      expect(queuedStateBeforeSteer.items).toEqual([
        {
          id: queuedItemId,
          status: 'queued',
          text: followUp,
          lease: null
        }
      ])
      expect(claimedQueueState).toEqual({
        conversationKey: queuedStateBeforeSteer.conversationKey,
        revision: queuedStateBeforeSteer.revision + 1,
        items: [
          {
            id: queuedItemId,
            status: 'steering',
            text: followUp,
            lease: { operation: 'turn-steer', owner: 'main' }
          }
        ]
      })
      expect(consumedQueueState).toEqual({
        conversationKey: queuedStateBeforeSteer.conversationKey,
        revision: queuedStateBeforeSteer.revision + 3,
        items: []
      })
      expect(recoveredQueueState).toEqual(consumedQueueState)
    })
    await assertPlanEvidence(evidence, '不能重复 claim 或自动重发', async () => {
      await expect.poll(() => providerResponseBodies(backend).length).toBe(3)
      await expect
        .poll(() => logs.filter((line) => line.includes('"method":"turn/steer"')).length)
        .toBe(1)
      await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(1)
      expect(recoveredQueueState.items).toEqual([])
    })

    await page.locator('[data-slot="aui_assistant-message-retry"]').click()
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'Recovered after the explicit retry.' })
    ).toHaveCount(1)
    await expect.poll(() => providerResponseBodies(backend).length).toBe(4)
    await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({ hasText: 'The initial answer is already visible.' })
    ).toHaveCount(1)
    if (focus === 'accepted-steer') {
      await expect(page.locator('[data-role="user"]').filter({ hasText: followUp })).toHaveCount(1)
      await expect(
        page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: followUp })
      ).toHaveCount(0)
    }
    await assertPlanEvidence(evidence, '旧 tool 结果保持且不随重试重复执行', async () => {
      await expect.poll(() => providerResponseBodies(backend).length).toBe(4)
      expect(
        functionCallOutputText(providerResponseBodies(backend)[2], 'call-follow-up-failure-pwd')
      ).toContain(appRoot)
      expect(
        functionCallOutputText(providerResponseBodies(backend)[3], 'call-follow-up-failure-pwd')
      ).toBeUndefined()
      await expect
        .poll(() => logs.filter((line) => line.includes('"method":"turn/started"')).length)
        .toBe(2)
    })
    await expectTerminalScenario({
      page,
      logs,
      backend,
      terminal: 'finish',
      terminalEventCount: 2,
      canonicalOutcomeEventCount: 1,
      providerRequestCount: 4,
      turnStartedCount: 2,
      pendingApprovalCount: 0,
      observedToolCount: 0,
      toolResultCount: 1,
      queue: { items: [] }
    })
  } finally {
    releaseInitialResponse.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([userDataDir, codexHomeDir])
  }
}

test('C03 @terminal-failure shows one recoverable error for HTTP 401 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 401))

test('C03 @terminal-failure shows one recoverable error for HTTP 403 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 403))

test('C03 @terminal-failure shows one recoverable error for HTTP 404 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 404))

test('C03 @terminal-failure shows one recoverable error for HTTP 429 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 429))

test('C04 @terminal-failure shows one recoverable error for HTTP 500 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 500))

test('C04 @terminal-failure shows one recoverable error for HTTP 502 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 502))

test('C04 @terminal-failure shows one recoverable error for HTTP 503 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 503))

test('C04 @terminal-failure shows one recoverable error for HTTP 504 without retrying automatically', async ({
  browserName
}, testInfo) => runHttpFailureScenario(browserName, testInfo, 504))

async function runHttpFailureScenario(
  browserName: string,
  testInfo: TestInfo,
  status: 401 | 403 | 404 | 429 | 500 | 502 | 503 | 504
): Promise<void> {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  await runSingleConversationScenario(
    testInfo,
    [
      {
        status,
        body: {
          code: `MOCK_HTTP_${status}`,
          message: `Mock upstream HTTP ${status}`
        }
      }
    ],
    async ({ page, backend, logs }) => {
      await sendMessage(page, `Trigger HTTP ${status}.`)
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        planEvidence(testInfo.title, [
          status === 401 || status === 403 || status === 404 || status === 429 ? 'C03' : 'C04'
        ])
      )
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
}

test('C02 @terminal-failure shows an error when the model closes before response headers', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [{ events: [], termination: 'close-before-headers' }],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Close before headers.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        planEvidence(
          'C02 @terminal-failure shows an error when the model closes before response headers',
          ['C02']
        )
      )
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('C05 @terminal-failure shows an error when the stream disconnects after response.created', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [disconnectingResponse('resp-created-disconnect')],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Disconnect after response.created.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        planEvidence(
          'C05 @terminal-failure shows an error when the stream disconnects after response.created',
          ['C05']
        )
      )
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('M03/C07/C12/F02 @terminal-failure preserves assistant text when the stream disconnects before completion', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const partialText = 'Visible output must survive the disconnect.'
  await runSingleConversationScenario(
    testInfo,
    [assistantTextThenDisconnect('resp-partial-disconnect', 'msg-partial-disconnect', partialText)],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M03/C07/C12/F02 @terminal-failure preserves assistant text when the stream disconnects before completion',
        ['M03', 'C07', 'C12', 'F02']
      )
      await sendMessage(page, 'Show partial output, then disconnect.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        { providerRequestCount: 1, terminalEventCount: 1, turnStartedCount: 1 },
        withoutQueueStateEvidence(evidence, 'M03'),
        partialText
      )
      await assertEmptyQueueStateEvidence(evidence, 'M03', page, logs)
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: partialText })
      ).toHaveCount(1)
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('C08 @terminal-failure keeps a completed assistant item when the stream closes before response.completed', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const completedText = 'The completed assistant item stays visible after the premature close.'
  await runSingleConversationScenario(
    testInfo,
    [
      {
        events: [
          responseCreated('resp-completed-item-disconnect'),
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-completed-item-disconnect',
              content: [{ type: 'output_text', text: completedText }]
            }
          }
        ],
        termination: 'disconnect'
      }
    ],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Complete one assistant item, then close before the terminal event.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        planEvidence(
          'C08 @terminal-failure keeps a completed assistant item when the stream closes before response.completed',
          ['C08']
        )
      )
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: completedText })
      ).toHaveCount(1)
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('M12/C13 @terminal-failure treats an empty HTTP 200 SSE stream as a failed turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [{ events: [] }],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M12/C13 @terminal-failure treats an empty HTTP 200 SSE stream as a failed turn',
        ['M12', 'C13']
      )
      await sendMessage(page, 'Return an empty stream.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        withoutQueueStateEvidence(evidence, 'M12')
      )
      await assertEmptyQueueStateEvidence(evidence, 'M12', page, logs)
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('M12/C14 @terminal-failure treats malformed SSE JSON as a failed turn without a renderer crash', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [
      {
        events: [],
        rawSse: ['event: response.created\ndata: {not-valid-json}\n\n']
      }
    ],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M12/C14 @terminal-failure treats malformed SSE JSON as a failed turn without a renderer crash',
        ['M12', 'C14']
      )
      await sendMessage(page, 'Return malformed SSE.')
      await expectSingleTurnError(
        page,
        logs,
        backend,
        undefined,
        withoutQueueStateEvidence(evidence, 'M12')
      )
      await assertEmptyQueueStateEvidence(evidence, 'M12', page, logs)
      expect(providerResponseBodies(backend)).toHaveLength(1)
    }
  )
})

test('M12/B10/C16/C17 @terminal-failure ignores an unknown event and duplicate completion without duplicating the answer', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const responseId = 'resp-duplicate-terminal'
  const answer = 'Duplicate terminal events still produce one answer.'
  const queuedFollowUp = 'Dispatch this queued message once after the duplicate terminal.'
  const queuedAnswer = 'The queued follow-up was accepted exactly once.'
  const releaseDuplicateTerminal = deferred()
  const evidence = planEvidence(
    'M12/B10/C16/C17 @terminal-failure ignores an unknown event and duplicate completion without duplicating the answer',
    ['M12', 'B10', 'C16', 'C17']
  )
  await runSingleConversationScenario(
    testInfo,
    [
      {
        events: [
          responseCreated(responseId),
          { type: 'response.future.unknown', payload: { ignored: true } },
          {
            type: 'response.output_item.done',
            item: {
              type: 'message',
              role: 'assistant',
              id: 'msg-duplicate-terminal',
              content: [{ type: 'output_text', text: answer }]
            }
          },
          responseCompleted(responseId),
          responseCompleted(responseId)
        ],
        beforeEvent: (_event, index) => (index === 3 ? releaseDuplicateTerminal.promise : undefined)
      },
      assistantMessageResponse(
        'resp-duplicate-terminal-queued',
        'msg-duplicate-terminal-queued',
        queuedAnswer
      )
    ],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Send duplicate terminal events.')
      await expect(page.locator('[data-role="assistant"]').filter({ hasText: answer })).toHaveCount(
        1
      )
      const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
      await input.fill(queuedFollowUp)
      await page.getByRole('button', { name: '将追问加入队列' }).click()
      await expect(
        page.locator('[data-slot="queued-follow-up-row"]').filter({ hasText: queuedFollowUp })
      ).toHaveCount(1)
      const queuedStateBeforeTerminal = await readFollowUpQueueState(page)
      const queuedItemId = queuedStateBeforeTerminal.items[0]?.id
      expect(queuedStateBeforeTerminal.items).toEqual([
        {
          id: queuedItemId,
          status: 'queued',
          text: queuedFollowUp,
          lease: null
        }
      ])

      releaseDuplicateTerminal.resolve()
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: queuedAnswer })
      ).toHaveCount(1)
      await expectTerminalScenario({
        page,
        logs,
        backend,
        terminal: 'finish',
        providerRequestCount: 2,
        turnStartedCount: 2,
        pendingApprovalCount: 0,
        queue: { items: [] },
        planEvidence: evidence.filter(
          ({ scenarioId, assertionId }) =>
            !(
              scenarioId === 'B10' &&
              (assertionId === 'claim、接受与队列结算至多一次' ||
                assertionId === '正确的恢复、暂停或拒绝状态')
            ) && !(scenarioId === 'M12' && assertionId === '队列状态、顺序与 revision')
        )
      })
      const settledQueueState = await readFollowUpQueueState(
        page,
        queuedStateBeforeTerminal.conversationKey
      )
      await assertPlanEvidence(evidence, 'claim、接受与队列结算至多一次', async () => {
        expect(queuedItemId).toBeTruthy()
        expect(queuedStateBeforeTerminal.items).toEqual([
          {
            id: queuedItemId,
            status: 'queued',
            text: queuedFollowUp,
            lease: null
          }
        ])
        await expect(
          page.locator('[data-role="user"]').filter({ hasText: queuedFollowUp })
        ).toHaveCount(1)
        expect(settledQueueState).toEqual({
          conversationKey: queuedStateBeforeTerminal.conversationKey,
          revision: queuedStateBeforeTerminal.revision + 2,
          items: []
        })
      })
      await assertPlanEvidence(evidence, '正确的恢复、暂停或拒绝状态', async () => {
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
        await expect(page.locator('[data-slot="queued-follow-up-row"]')).toHaveCount(0)
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: queuedAnswer })
        ).toHaveCount(1)
      })
      await assertPlanEvidence(evidence, '队列状态、顺序与 revision', () => {
        expect(settledQueueState).toEqual({
          conversationKey: queuedStateBeforeTerminal.conversationKey,
          revision: queuedStateBeforeTerminal.revision + 2,
          items: []
        })
      })
      expect(providerResponseBodies(backend)).toHaveLength(2)
    },
    () => releaseDuplicateTerminal.resolve()
  )
})

test('M07/F01/F06/F08/F10/F11/F12/F20 @approval-retry succeeds exactly once after a keyboard retry', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const recoveredText = 'Only the explicit retry recovered this turn.'
  await runSingleConversationScenario(
    testInfo,
    [
      disconnectingResponse('resp-explicit-retry-first'),
      assistantMessageResponse(
        'resp-explicit-retry-second',
        'msg-explicit-retry-second',
        recoveredText
      )
    ],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M07/F01/F06/F08/F10/F11/F12/F20 @approval-retry succeeds exactly once after a keyboard retry',
        ['M07', 'F08', 'F12']
      )
      await sendMessage(page, 'Fail once, then recover only after I retry.')
      await expectSingleTurnError(page, logs, backend)
      const retry = page.locator('[data-slot="aui_assistant-message-retry"]')
      await retry.focus()
      await expect(retry).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: recoveredText })
      ).toHaveCount(1)
      await expectTerminalScenario({
        page,
        logs,
        backend,
        terminal: 'finish',
        preservedAssistantText: recoveredText,
        providerRequestCount: 2,
        turnStartedCount: 2,
        canonicalOutcomeEventCount: 1,
        pendingApprovalCount: 0,
        queue: { items: [] },
        planEvidence: withoutQueueStateEvidence(evidence, 'M07')
      })
      await assertEmptyQueueStateEvidence(evidence, 'M07', page, logs)
      await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
    }
  )
})

test('M08/F13 @terminal-failure keeps one error card when an explicit retry fails again', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [
      disconnectingResponse('resp-retry-fails-first'),
      disconnectingResponse('resp-retry-fails-second')
    ],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M08/F13 @terminal-failure keeps one error card when an explicit retry fails again',
        ['M08', 'F13']
      )
      await sendMessage(page, 'Fail twice with an explicit retry.')
      await expectSingleTurnError(page, logs, backend)
      await page.locator('[data-slot="aui_assistant-message-retry"]').click()
      await expect.poll(() => providerResponseBodies(backend).length).toBe(2)
      await expectSingleTurnError(
        page,
        logs,
        backend,
        {
          providerRequestCount: 2,
          terminalEventCount: 2,
          turnStartedCount: 2
        },
        withoutQueueStateEvidence(evidence, 'M08')
      )
      await assertEmptyQueueStateEvidence(evidence, 'M08', page, logs)
      await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(1)
    }
  )
})

test('C20/F17 @terminal-failure marks a hanging request as cancelled after the user stops it', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [
      {
        events: [responseCreated('resp-hang-until-cancel')],
        termination: 'hang'
      }
    ],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Hang until I cancel.')
      await expect.poll(() => providerResponseBodies(backend).length).toBe(1)
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await expectTerminalScenario({
        page,
        logs,
        backend,
        terminal: 'aborted',
        outcome: 'interrupted',
        requireCanonicalOutcomeSource: true,
        providerRequestCount: 1,
        turnStartedCount: 1,
        pendingApprovalCount: 0,
        planEvidence: planEvidence(
          'C20/F17 @terminal-failure marks a hanging request as cancelled after the user stops it',
          ['C20', 'F17']
        )
      })
    }
  )
})

test('C21/F19 @terminal-failure releases the UI when the next response hangs after a completed tool', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await runSingleConversationScenario(
    testInfo,
    [
      shellCommandResponse('resp-tool-then-hang-tool', 'call-tool-then-hang', {
        command: 'pwd',
        sandbox_permissions: 'require_escalated',
        justification: 'E2E executes the terminal fixture command outside the Linux runner sandbox'
      }),
      {
        events: [responseCreated('resp-tool-then-hang-final')],
        termination: 'hang'
      }
    ],
    async ({ page, backend, logs }) => {
      await sendMessage(page, 'Run one tool, then hang until I stop the turn.')
      await approveE2eFixtureCommand(page)
      await expect.poll(() => providerResponseBodies(backend).length).toBe(2)
      await expect(page.locator('[data-slot="tool-group-unit"]')).toBeVisible()
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await expectTerminalScenario({
        page,
        logs,
        backend,
        terminal: 'aborted',
        outcome: 'interrupted',
        requireCanonicalOutcomeSource: true,
        providerRequestCount: 2,
        turnStartedCount: 1,
        pendingApprovalCount: 0,
        observedToolCount: 1,
        toolResultCount: 1,
        queue: { items: [] },
        planEvidence: planEvidence(
          'C21/F19 @terminal-failure releases the UI when the next response hangs after a completed tool',
          ['C21', 'F19']
        )
      })
      expect(
        functionCallOutputText(providerResponseBodies(backend)[1], 'call-tool-then-hang')
      ).toContain(appRoot)
    }
  )
})

async function approveE2eFixtureCommand(page: Page): Promise<void> {
  const panel = page.locator('[data-slot="server-request-panel"]')
  await expect(panel).toContainText('pwd')
  await panel.getByRole('button', { name: '允许一次', exact: true }).click()
  await expect(panel).toHaveCount(0)
}

test('M10/G06 @terminal-failure isolates a failed conversation from a concurrent successful conversation', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const releaseFailure = deferred()
  const firstPrompt = `isolated-failure-${Date.now().toString(36)}`
  const secondPrompt = `isolated-success-${Date.now().toString(36)}`
  const successText = 'The concurrent conversation completed normally.'
  await runSingleConversationScenario(
    testInfo,
    [
      {
        events: [responseCreated('resp-isolated-failure')],
        beforeEvent: () => releaseFailure.promise,
        termination: 'disconnect'
      },
      assistantMessageResponse('resp-isolated-success', 'msg-isolated-success', successText)
    ],
    async ({ page, backend, logs }) => {
      const evidence = planEvidence(
        'M10/G06 @terminal-failure isolates a failed conversation from a concurrent successful conversation',
        ['M10', 'G06']
      )
      await sendMessage(page, firstPrompt)
      await expect.poll(() => providerResponseBodies(backend).length).toBe(1)

      const sidebar = page.locator('[data-slot="codex-sidebar"]')
      await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
      await sendComposerMessage(page, secondPrompt)
      await expect(
        page.locator('[data-role="assistant"]').filter({ hasText: successText })
      ).toHaveCount(1)

      releaseFailure.resolve()
      await sidebar.getByRole('button', { name: new RegExp(`^${firstPrompt}`) }).click()
      await expectSingleTurnError(
        page,
        logs,
        backend,
        {
          providerRequestCount: 2,
          terminalEventCount: 2,
          turnStartedCount: 2,
          canonicalOutcomeEventCount: 1
        },
        withoutPlanAssertion(
          withoutQueueStateEvidence(evidence, 'M10'),
          'G06',
          '跨对话与信任边界隔离'
        )
      )
      await sidebar.getByRole('button', { name: new RegExp(`^${secondPrompt}`) }).click()
      await assertPlanEvidence(evidence, '跨对话与信任边界隔离', async () => {
        await expect(
          page.locator('[data-role="assistant"]').filter({ hasText: successText })
        ).toHaveCount(1)
        await expect(page.locator('[data-slot="aui_assistant-message-error"]')).toHaveCount(0)
      })
      await assertEmptyQueueStateEvidence(evidence, 'M10', page, logs, [0, 1])
      expect(providerResponseBodies(backend)).toHaveLength(2)
    },
    () => releaseFailure.resolve()
  )
})

type ScenarioContext = {
  page: Page
  backend: MockBackend
  logs: string[]
}

async function runSingleConversationScenario(
  testInfo: TestInfo,
  responses: ResponsesStep[],
  run: (context: ScenarioContext) => Promise<void>,
  cleanup?: () => void
): Promise<void> {
  const backend = await startMockBackend({ responses })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await run({ page, backend, logs })
  } finally {
    cleanup?.()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
}

async function expectSingleTurnError(
  page: Page,
  logs: string[],
  backend: MockBackend,
  counts: {
    providerRequestCount: number
    terminalEventCount: number
    turnStartedCount: number
    canonicalOutcomeEventCount?: number
  } = { providerRequestCount: 1, terminalEventCount: 1, turnStartedCount: 1 },
  planEvidence?: PlanAssertionEvidence[],
  preservedAssistantText?: string
): Promise<void> {
  await expectTerminalScenario({
    page,
    logs,
    backend,
    terminal: 'error',
    preservedAssistantText,
    pendingApprovalCount: 0,
    observedToolCount: 0,
    providerRequestCount: counts.providerRequestCount,
    queue: { items: [] },
    terminalEventCount: counts.terminalEventCount,
    canonicalOutcomeEventCount: counts.canonicalOutcomeEventCount,
    toolResultCount: 0,
    turnStartedCount: counts.turnStartedCount,
    planEvidence
  })
}

async function assertPlanEvidence(
  evidence: readonly PlanAssertionEvidence[],
  assertionId: string,
  assertion: () => Promise<void> | void
): Promise<void> {
  for (const entry of evidence.filter((candidate) => candidate.assertionId === assertionId)) {
    await planAssert({ ...entry, assertion })
  }
}

function withoutQueueStateEvidence(
  evidence: readonly PlanAssertionEvidence[],
  scenarioId: string
): PlanAssertionEvidence[] {
  return withoutPlanAssertion(evidence, scenarioId, '队列状态、顺序与 revision')
}

function withoutPlanAssertion(
  evidence: readonly PlanAssertionEvidence[],
  scenarioId: string,
  assertionId: string
): PlanAssertionEvidence[] {
  return evidence.filter(
    (entry) => entry.scenarioId !== scenarioId || entry.assertionId !== assertionId
  )
}

async function assertEmptyQueueStateEvidence(
  evidence: readonly PlanAssertionEvidence[],
  scenarioId: string,
  page: Page,
  logs: readonly string[],
  occurrences: readonly number[] = [0]
): Promise<void> {
  const conversationKeys = occurrences.map((occurrence) =>
    conversationKeyForStartedTurn(logs, occurrence)
  )
  await assertPlanEvidence(
    evidence.filter((entry) => entry.scenarioId === scenarioId),
    '队列状态、顺序与 revision',
    async () => {
      const states = await Promise.all(
        conversationKeys.map((conversationKey) => readFollowUpQueueState(page, conversationKey))
      )
      expect(states).toEqual(
        conversationKeys.map((conversationKey) => ({
          conversationKey,
          revision: 0,
          items: []
        }))
      )
    }
  )
}

async function readFollowUpQueueState(
  page: Page,
  knownConversationKey?: string
): Promise<{
  conversationKey: string
  revision: number
  items: Array<{
    id: string
    status: string
    text: string
    lease: { operation: string; owner: string } | null
  }>
}> {
  return page.evaluate(async (persistedConversationKey) => {
    const conversationKey =
      persistedConversationKey ??
      document
        .querySelector('[data-slot="queued-follow-up-list"]')
        ?.getAttribute('data-conversation-key')
    if (!conversationKey)
      throw new Error('The active conversation has no follow-up queue identity.')
    const state = await window.desktopApp.followUps.getState(conversationKey)
    return {
      conversationKey,
      revision: state.revision,
      items: state.items.map((item) => ({
        id: item.id,
        status: item.status,
        text: item.message.text,
        lease: item.lease ? { operation: item.lease.operation, owner: item.lease.owner } : null
      }))
    }
  }, knownConversationKey)
}

function assistantTextThenDisconnect(
  responseId: string,
  messageId: string,
  text: string
): ResponsesStreamStep {
  return {
    events: [
      responseCreated(responseId),
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          role: 'assistant',
          id: messageId,
          content: [{ type: 'output_text', text: '' }]
        }
      },
      {
        type: 'response.output_text.delta',
        delta: text
      }
    ],
    termination: 'disconnect'
  }
}
