import { writeFile } from 'node:fs/promises'

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

import { attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { sendComposerMessage } from './support/chatActions'
import { createConversationStreamPerformanceFixture } from './support/conversationStreamPerformanceFixture'
import {
  percentile,
  startConversationStreamTrace,
  type ConversationStreamTraceMetrics
} from './support/conversationStreamTrace'
import { startMockBackend } from './support/mockBackend'

type ConversationStreamPerformanceMetrics = {
  schemaVersion: 1
  fixture: {
    sha256: string
    durationMs: number
    deltaCount: number
    deltaIntervalMs: number
    deltaBytes: number
    finalTextBytes: number
    historyMessageCount: number
  }
  renderer: {
    longTasks: {
      count: number
      maxDurationMs: number
      p95DurationMs: number
      p99DurationMs: number
      totalBlockingMs: number
    }
    publishToCommitMs: DurationDistribution
    commitToNextFrameMs: DurationDistribution
    commits: {
      conversationWorkspaceLayout: number
      activeConversationPane: number
      chatThread: number
      assistantMessage: number
    }
    viewport: {
      forwardedRefAttachCount: number
      forwardedRefDetachCount: number
      nodeReplacementCount: number
      scrollRestoreSetupCount: number
      scrollRestoreScheduleCount: number
      scrollRestoreApplyCount: number
      scrollRestoreCleanupCount: number
    }
  }
  trace: ConversationStreamTraceMetrics
}

type DurationDistribution = {
  count: number
  p50: number
  p95: number
  p99: number
  max: number
}

test.describe('conversation stream performance baseline', () => {
  test.setTimeout(180_000)

  test('PERF-CONVERSATION-STREAM records deterministic renderer and trace metrics', async ({
    browserName
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

    const fixture = createConversationStreamPerformanceFixture()
    const backend = await startMockBackend({ responses: [fixture.response] })
    const logs: string[] = []
    let app: ElectronApplication | undefined

    try {
      app = await launchApp(backend, logs)
      const page = await app.firstWindow()
      collectRendererLogs(page, logs)
      await beginConversationPerformanceCollection(page)
      const trace = await startConversationStreamTrace(page)
      const sampleTimer = setInterval(() => void trace.sample(), 500)

      try {
        await sendComposerMessage(
          page,
          'Run the deterministic conversation stream performance fixture.'
        )
        await expect(page.locator('[data-role="assistant"]')).toContainText('Terminal delta 600.', {
          timeout: fixture.durationMs + 60_000
        })
      } finally {
        clearInterval(sampleTimer)
      }

      const traceResult = await trace.collect()
      const renderer = await readConversationPerformanceRendererMetrics(page)
      const metrics: ConversationStreamPerformanceMetrics = {
        schemaVersion: 1,
        fixture: {
          sha256: fixture.sha256,
          durationMs: fixture.durationMs,
          deltaCount: fixture.deltaCount,
          deltaIntervalMs: fixture.deltaIntervalMs,
          deltaBytes: fixture.deltaBytes,
          finalTextBytes: fixture.finalTextBytes,
          historyMessageCount: fixture.historyMessageCount
        },
        renderer,
        trace: traceResult.metrics
      }
      assertConversationStreamPerformanceMetrics(metrics)
      await attachConversationPerformanceArtifacts(testInfo, metrics, traceResult.rawTrace)
    } finally {
      await cleanupConversationPerformanceCollection(app)
      await attachDiagnostics(testInfo, logs, backend, app)
      await closeApp(app)
      await backend.close()
    }
  })
})

async function beginConversationPerformanceCollection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as typeof window & {
      conversationStreamLongTaskObserver?: PerformanceObserver
      conversationStreamLongTasks?: number[]
      __DASCOWORK_CONVERSATION_PERF__?: boolean
      __DASCOWORK_CONVERSATION_PERF_COUNTS__?: Record<string, number>
    }
    target.conversationStreamLongTaskObserver?.disconnect()
    target.conversationStreamLongTasks = []
    target.__DASCOWORK_CONVERSATION_PERF__ = true
    target.__DASCOWORK_CONVERSATION_PERF_COUNTS__ = {}
    const observer = new PerformanceObserver((list) => {
      target.conversationStreamLongTasks?.push(...list.getEntries().map((entry) => entry.duration))
    })
    observer.observe({ buffered: true, type: 'longtask' })
    target.conversationStreamLongTaskObserver = observer
  })
}

async function cleanupConversationPerformanceCollection(
  app: ElectronApplication | undefined
): Promise<void> {
  if (!app) return
  const page = await app.firstWindow().catch(() => undefined)
  await page
    ?.evaluate(() => {
      const target = window as typeof window & {
        conversationStreamLongTaskObserver?: PerformanceObserver
        conversationStreamLongTasks?: number[]
        __DASCOWORK_CONVERSATION_PERF__?: boolean
        __DASCOWORK_CONVERSATION_PERF_COUNTS__?: Record<string, number>
      }
      target.conversationStreamLongTaskObserver?.disconnect()
      target.conversationStreamLongTaskObserver = undefined
      target.conversationStreamLongTasks = []
      target.__DASCOWORK_CONVERSATION_PERF__ = false
      target.__DASCOWORK_CONVERSATION_PERF_COUNTS__ = {}
      performance
        .getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('conversation-stream:'))
        .forEach((entry) => performance.clearMarks(entry.name))
      performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith('conversation-stream:'))
        .forEach((entry) => performance.clearMeasures(entry.name))
    })
    .catch(() => undefined)
}

async function readConversationPerformanceRendererMetrics(
  page: Page
): Promise<ConversationStreamPerformanceMetrics['renderer']> {
  return page.evaluate(() => {
    const target = window as typeof window & {
      conversationStreamLongTasks?: number[]
      __DASCOWORK_CONVERSATION_PERF_COUNTS__?: Record<string, number>
    }
    const counts = target.__DASCOWORK_CONVERSATION_PERF_COUNTS__ ?? {}
    const longTasks = target.conversationStreamLongTasks ?? []
    return {
      longTasks: {
        count: longTasks.length,
        maxDurationMs: rounded(Math.max(0, ...longTasks)),
        p95DurationMs: browserPercentile(longTasks, 95),
        p99DurationMs: browserPercentile(longTasks, 99),
        totalBlockingMs: rounded(
          longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0)
        )
      },
      publishToCommitMs: browserDistribution('conversation-stream:publish-to-commit:'),
      commitToNextFrameMs: browserDistribution('conversation-stream:commit-to-next-frame:'),
      commits: {
        conversationWorkspaceLayout: counts.conversationWorkspaceLayout ?? 0,
        activeConversationPane: counts.activeConversationPane ?? 0,
        chatThread: counts.chatThread ?? 0,
        assistantMessage: counts.assistantMessage ?? 0
      },
      viewport: {
        forwardedRefAttachCount: counts.forwardedRefAttachCount ?? 0,
        forwardedRefDetachCount: counts.forwardedRefDetachCount ?? 0,
        nodeReplacementCount: counts.nodeReplacementCount ?? 0,
        scrollRestoreSetupCount: counts.scrollRestoreSetupCount ?? 0,
        scrollRestoreScheduleCount: counts.scrollRestoreScheduleCount ?? 0,
        scrollRestoreApplyCount: counts.scrollRestoreApplyCount ?? 0,
        scrollRestoreCleanupCount: counts.scrollRestoreCleanupCount ?? 0
      }
    }

    function browserDistribution(prefix: string): DurationDistribution {
      const values = performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith(prefix))
        .map((entry) => entry.duration)
      return {
        count: values.length,
        p50: browserPercentile(values, 50),
        p95: browserPercentile(values, 95),
        p99: browserPercentile(values, 99),
        max: rounded(Math.max(0, ...values))
      }
    }

    function browserPercentile(values: readonly number[], percentileValue: number): number {
      if (values.length === 0) return 0
      const sorted = [...values].sort((left, right) => left - right)
      const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
      )
      return rounded(sorted[index] ?? 0)
    }

    function rounded(value: number): number {
      return Math.round(value * 100) / 100
    }
  })
}

function assertConversationStreamPerformanceMetrics(
  metrics: ConversationStreamPerformanceMetrics
): void {
  expect(metrics.schemaVersion).toBe(1)
  expect(metrics.fixture.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(metrics.fixture.deltaCount).toBe(600)
  expect(metrics.fixture.deltaIntervalMs).toBe(50)
  expect(metrics.fixture.durationMs).toBe(30_000)
  expect(metrics.fixture.deltaBytes).toBe(metrics.fixture.finalTextBytes)
  expect(metrics.renderer.longTasks.totalBlockingMs).toBeGreaterThanOrEqual(0)
  expect(metrics.renderer.publishToCommitMs.count).toBeGreaterThan(0)
  expect(metrics.renderer.commitToNextFrameMs.count).toBeGreaterThan(0)
  expect(metrics.renderer.viewport.scrollRestoreSetupCount).toBeLessThan(10)
  expect(metrics.trace.runTasksOver50ms).toBeGreaterThanOrEqual(0)
  expect(metrics.trace.layout.count).toBeGreaterThanOrEqual(0)
  expect(metrics.trace.paint.count).toBeGreaterThanOrEqual(0)
  expect(metrics.renderer.viewport.forwardedRefAttachCount).toBeGreaterThan(0)
  expect(percentile([metrics.renderer.longTasks.maxDurationMs], 95)).toBeGreaterThanOrEqual(0)
}

async function attachConversationPerformanceArtifacts(
  testInfo: TestInfo,
  metrics: ConversationStreamPerformanceMetrics,
  rawTrace: string
): Promise<void> {
  const metricsBody = `${JSON.stringify(metrics, null, 2)}\n`
  const metricsPath = testInfo.outputPath('conversation-stream-performance.json')
  const tracePath = testInfo.outputPath('conversation-stream-performance-trace.json')
  await writeFile(metricsPath, metricsBody, 'utf8')
  await writeFile(tracePath, rawTrace, 'utf8')
  await testInfo.attach('conversation-stream-performance.json', {
    body: metricsBody,
    contentType: 'application/json'
  })
  await testInfo.attach('conversation-stream-performance-trace.json', {
    path: tracePath,
    contentType: 'application/json'
  })
}
