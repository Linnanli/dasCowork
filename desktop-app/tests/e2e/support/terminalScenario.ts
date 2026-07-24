import { expect, type Page } from '@playwright/test'

import { planAssert } from '../../../scripts/lib/test-plan-assertions.mjs'

import type { MockBackend } from './mockBackend'
import { providerResponseBodies } from './mockBackend'

export type PlanAssertionEvidence = {
  scenarioId: string
  assertionId: string
}

export type TerminalScenario = {
  page: Page
  logs: string[]
  backend: MockBackend
  terminal: 'error' | 'aborted' | 'finish'
  outcome?: 'completed' | 'interrupted' | 'failed'
  requireCanonicalOutcomeSource?: boolean
  providerRequestCount: number
  turnStartedCount: number
  pendingApprovalCount: number
  terminalEventCount?: number
  canonicalOutcomeEventCount?: number
  observedToolCount?: number
  toolResultCount?: number
  /**
   * A scenario-specific assistant fragment that must still be present after the
   * terminal state. Tests that claim preserved visible content must pass the
   * exact fragment they produced before the failure or interruption.
   */
  preservedAssistantText?: string
  queue?: {
    revision?: number
    items: Array<{ id: string; status: string }>
  }
  /**
   * The plan assertions this terminal check proves. Each record is emitted by
   * the concrete Playwright expectation that observes the claimed behavior.
   */
  planEvidence?: PlanAssertionEvidence[]
}

/**
 * Verifies the observable parts of a stream terminal in one place.  Mock E2E
 * tests deliberately use this instead of treating a visible error card (or a
 * non-empty assistant message) as sufficient evidence that a turn settled.
 */
export async function expectTerminalScenario(scenario: TerminalScenario): Promise<void> {
  const { backend, logs, page, terminal } = scenario
  const errorCards = page.locator('[data-slot="aui_assistant-message-error"]')
  const cancelledCards = page.locator('[data-slot="aui_assistant-message-cancelled"]')
  const stopButton = page.getByRole('button', { name: '停止生成', exact: true })
  const sendButton = page.getByRole('button', { name: '发送消息', exact: true })
  const composer = page.locator('.aui-lexical-input[contenteditable="true"]').last()

  if (terminal === 'error') {
    await expectWithPlanEvidence(
      scenario,
      '最终 UI 状态',
      async () => {
        await expect(errorCards).toHaveCount(1)
        await expect(errorCards).toBeVisible()
        await expect(errorCards).not.toHaveText('')
      }
    )
    await expectWithPlanEvidence(scenario, '错误、取消与重试 UI 正确', async () => {
      await expect(page.locator('[data-slot="aui_assistant-message-retry"]')).toBeEnabled()
      await expect(cancelledCards).toHaveCount(0)
    })
    await expectWithPlanEvidence(scenario, '失败和拒绝不伪装成完成', async () => {
      await expect(errorCards).toHaveCount(1)
      await expect(cancelledCards).toHaveCount(0)
    })
  } else if (terminal === 'aborted') {
    await expectWithPlanEvidence(scenario, '最终 UI 状态', async () => {
      await expect(cancelledCards).toHaveCount(1)
      await expect(errorCards).toHaveCount(0)
    })
    await expectWithPlanEvidence(scenario, '错误、取消与重试 UI 正确', async () => {
      await expect(cancelledCards).toHaveCount(1)
      await expect(page.locator('[data-slot="aui_assistant-message-retry"]')).toHaveCount(0)
    })
  } else {
    await expectWithPlanEvidence(scenario, '最终 UI 状态', async () => {
      await expect(errorCards).toHaveCount(0)
      await expect(cancelledCards).toHaveCount(0)
    })
    await expectWithPlanEvidence(scenario, '失败和拒绝不伪装成完成', async () => {
      await expect(errorCards).toHaveCount(0)
      await expect(cancelledCards).toHaveCount(0)
    })
    await expectWithPlanEvidence(scenario, '错误、取消与重试 UI 正确', async () => {
      await expect(page.locator('[data-slot="aui_assistant-message-retry"]')).toHaveCount(0)
    })
  }

  await expectWithPlanEvidence(scenario, '可访问性、脱敏和 Composer 状态正确', async () => {
    await expect(stopButton).toHaveCount(0)
    await expect(sendButton).toBeVisible()
    await expect(sendButton).toBeEnabled()
    await expect(composer).toBeVisible()
    await expect(composer).toBeEditable()
  })
  await expectPreservedVisibleHistory(scenario)

  const providerRequestCount = scenario.providerRequestCount
  const turnStartedCount = scenario.turnStartedCount
  const pendingApprovalCount = scenario.pendingApprovalCount ?? 0
  await expectWithPlanEvidence(scenario, 'provider 请求数量', () =>
    expect.poll(() => providerResponseBodies(backend).length).toBe(providerRequestCount)
  )
  await expectWithPlanEvidence(scenario, 'turn started 数量', () =>
    expect.poll(() => countProtocolNotifications(logs, 'turn/started')).toBe(turnStartedCount)
  )
  await expectWithPlanEvidence(scenario, '无自动重试、额外请求或迟到事件应用', async () => {
    await expect.poll(() => providerResponseBodies(backend).length).toBe(providerRequestCount)
    await expect.poll(() => countProtocolNotifications(logs, 'turn/started')).toBe(turnStartedCount)
  })
  await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(
    pendingApprovalCount
  )

  const terminalEventCount = scenario.terminalEventCount ?? scenario.turnStartedCount
  const expectedCanonicalOutcome = scenario.outcome ?? canonicalOutcomeForTerminal(terminal)
  await expectWithPlanEvidence(scenario, 'terminal 类型和次数', async () => {
    await expect
      .poll(() => countProtocolNotifications(logs, 'turn/completed'))
      .toBe(terminalEventCount)
    expect(countCanonicalTerminalNotifications(logs, expectedCanonicalOutcome)).toBe(
      scenario.canonicalOutcomeEventCount ?? terminalEventCount
    )
  })
  await expectWithPlanEvidence(scenario, 'terminal 只结算一次且 Composer 恢复', async () => {
    await expect
      .poll(() => countProtocolNotifications(logs, 'turn/completed'))
      .toBe(terminalEventCount)
    await expect(stopButton).toHaveCount(0)
    await expect(sendButton).toBeEnabled()
  })
  await expectWithPlanEvidence(scenario, 'terminal 和 active run 不被竞态覆盖', async () => {
    expect(countCanonicalTerminalNotifications(logs, expectedCanonicalOutcome)).toBe(
      scenario.canonicalOutcomeEventCount ?? terminalEventCount
    )
    await expect(stopButton).toHaveCount(0)
  })
  if (scenario.requireCanonicalOutcomeSource) {
    expect(
      countProtocolNotifications(logs, 'turn/completed') > 0,
      'the terminal must be grounded in an app-server completion notification'
    ).toBe(true)
  }

  expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(
    scenario.pendingApprovalCount ?? 0
  )
  const toolGroups = page.locator('[data-slot="tool-group-unit"]')
  const expectedToolCount = scenario.observedToolCount ?? 0
  if (expectedToolCount > 0 && (await toolGroups.count()) === 0) {
    // Completed process activity is intentionally collapsed behind the same
    // user-visible "已处理" control used by the application. Reveal it before
    // asserting the exact tool record count; do not treat the collapsed DOM as
    // evidence that the canonical tool result was lost.
    const collapsedProcessTriggers = page.locator(
      '[data-slot="reasoning-group"][data-state="closed"] [data-slot="reasoning-group-trigger"]'
    )
    while ((await collapsedProcessTriggers.count()) > 0) {
      await collapsedProcessTriggers.first().click()
    }
  }
  await expectWithPlanEvidence(scenario, 'tool/approval 执行数量', async () => {
    await expect(toolGroups).toHaveCount(expectedToolCount)
    expect(countProviderToolResults(providerResponseBodies(backend))).toBe(
      scenario.toolResultCount ?? 0
    )
  })
  await expectWithPlanEvidence(scenario, '工具、审批记录与执行次数正确', async () => {
    await expect(toolGroups).toHaveCount(expectedToolCount)
    await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(
      pendingApprovalCount
    )
  })

  await expectQueueState(page, scenario.queue)

  await expectWithPlanEvidence(scenario, 'renderer/page 健康', () =>
    expect(logs.filter((line) => line.startsWith('[renderer:pageerror]'))).toEqual([])
  )
  expect(logs.filter((line) => /unhandled rejection/i.test(line))).toEqual([])
  await expectWithPlanEvidence(scenario, '资源、并发和终态无残留', async () => {
    await expect(stopButton).toHaveCount(0)
    await expect(sendButton).toBeEnabled()
    await expect(page.locator('[data-slot="server-request-panel"] article')).toHaveCount(0)
    await expect(errorCards).toHaveCount(terminal === 'error' ? 1 : 0)
    await expect(cancelledCards).toHaveCount(terminal === 'aborted' ? 1 : 0)
  })
  await expectWithPlanEvidence(scenario, '诊断可关联而不泄露密钥', () =>
    expect(logs.join('\n')).not.toMatch(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/u)
  )
  assertAllPlanEvidenceRecorded(scenario)
}

async function expectQueueState(
  page: Page,
  expected: TerminalScenario['queue']
): Promise<void> {
  if (!expected) return

  const queueRoot = page.locator('[data-slot="queued-follow-up-list"]')
  const snapshot = await readQueueSnapshot(page)
  if (expected.items.length === 0) {
    await expect(queueRoot.locator('[data-slot="queued-follow-up-row"]')).toHaveCount(0)
    if (snapshot) {
      expect(snapshot.renderedItems).toEqual([])
      expect(snapshot.items).toEqual([])
      if (expected.revision !== undefined) expect(snapshot.revision).toBe(expected.revision)
    }
    return
  }

  expect(snapshot, 'a non-empty terminal queue must expose its durable state').not.toBeNull()
  if (!snapshot) return
  expect(snapshot.revision).toBeGreaterThanOrEqual(0)
  expect(new Set(snapshot.items.map((item) => item.id)).size).toBe(snapshot.items.length)
  expect(snapshot.renderedItems).toEqual(snapshot.items)
  if (expected.revision !== undefined) expect(snapshot.revision).toBe(expected.revision)
  expect(snapshot.items).toEqual(expected.items)
}

async function readQueueSnapshot(page: Page): Promise<{
  conversationKey: string
  renderedItems: Array<{ id: string | null; status: string | null }>
  revision: number
  items: Array<{ id: string; status: string }>
} | null> {
  return page.evaluate(async () => {
    const queueRoot = document.querySelector('[data-slot="queued-follow-up-list"]')
    const conversationKey = queueRoot?.getAttribute('data-conversation-key')
    if (!conversationKey) return null
    const state = await window.desktopApp.followUps.getState(conversationKey)
    const renderedItems = queueRoot
      ? [...queueRoot.querySelectorAll('[data-slot="queued-follow-up-row"]')].map((row) => ({
          id: row.getAttribute('data-item-id'),
          status: row.getAttribute('data-status')
        }))
      : []
    return {
      conversationKey,
      renderedItems,
      revision: state.revision,
      items: state.items.map((item) => ({ id: item.id, status: item.status }))
    }
  })
}

const planEvidenceMatches = new WeakMap<TerminalScenario, Set<number>>()

async function expectWithPlanEvidence(
  scenario: TerminalScenario,
  assertionId: string,
  assertion: () => Promise<void> | void
): Promise<void> {
  const evidence = scenario.planEvidence ?? []
  const matching = evidence
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.assertionId === assertionId)
  if (matching.length === 0) {
    await assertion()
    return
  }

  const recorded = planEvidenceMatches.get(scenario) ?? new Set<number>()
  for (const { entry, index } of matching) {
    await planAssert({ ...entry, assertion })
    recorded.add(index)
  }
  planEvidenceMatches.set(scenario, recorded)
}

function assertAllPlanEvidenceRecorded(scenario: TerminalScenario): void {
  const evidence = scenario.planEvidence ?? []
  const recorded = planEvidenceMatches.get(scenario) ?? new Set<number>()
  const missing = evidence
    .filter((_, index) => !recorded.has(index))
    .map(({ scenarioId, assertionId }) => `${scenarioId}: ${assertionId}`)
  if (missing.length > 0) {
    throw new Error(`Terminal scenario has unbound plan assertions: ${missing.join(', ')}`)
  }
  planEvidenceMatches.delete(scenario)
}

async function expectPreservedVisibleHistory(scenario: TerminalScenario): Promise<void> {
  const matchingHistoryEvidence = (scenario.planEvidence ?? []).filter(
    ({ assertionId }) =>
      assertionId === '历史与已显示内容保留' || assertionId === '保留可见内容并显示单一终态'
  )
  if (matchingHistoryEvidence.length === 0) return
  const assertHistory = async (): Promise<void> => {
    const latestUserMessage = scenario.page.locator('[data-role="user"]').last()
    await expect(latestUserMessage).toBeVisible()
    await expect(latestUserMessage).not.toHaveText('')
    if (scenario.preservedAssistantText) {
      await expect(
        scenario.page
          .locator('[data-role="assistant"]')
          .filter({ hasText: scenario.preservedAssistantText })
      ).toHaveCount(1)
    }
  }
  await expectWithPlanEvidence(scenario, '历史与已显示内容保留', assertHistory)
  await expectWithPlanEvidence(scenario, '保留可见内容并显示单一终态', assertHistory)
}

function canonicalOutcomeForTerminal(
  terminal: TerminalScenario['terminal']
): 'completed' | 'interrupted' | 'failed' {
  if (terminal === 'finish') return 'completed'
  if (terminal === 'aborted') return 'interrupted'
  return 'failed'
}

export function countProtocolNotifications(logs: readonly string[], method: string): number {
  const notification = `"method":"${method}"`
  return logs.reduce((count, line) => count + (line.split(notification).length - 1), 0)
}

function countCanonicalTerminalNotifications(
  logs: readonly string[],
  outcome: 'completed' | 'interrupted' | 'failed'
): number {
  const terminal =
    /"method":"turn\/completed","params":\{[\s\S]*?"status":"(completed|interrupted|failed)"/gu
  return [...logs.join('\n').matchAll(terminal)].filter((match) => match[1] === outcome).length
}

function countProviderToolResults(providerBodies: unknown[]): number {
  const callIds = new Set<string>()
  for (const body of providerBodies) {
    if (!isRecord(body) || !Array.isArray(body.input)) continue
    for (const item of body.input) {
      if (!isRecord(item) || item.type !== 'function_call_output') continue
      if (typeof item.call_id === 'string') callIds.add(item.call_id)
    }
  }
  return callIds.size
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
