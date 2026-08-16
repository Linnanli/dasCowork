import { writeFile } from 'node:fs/promises'

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'
import { assistantMessageResponse, startMockBackend } from './support/mockBackend'
import {
  buildReviewPerformanceMetrics,
  createReviewPerformanceFixture,
  REVIEW_PERFORMANCE_SMALL_FILE_COUNTS,
  type ReviewPerformanceMetrics
} from './support/reviewPerformanceFixture'

test.describe('local Git review performance baseline', () => {
  test.setTimeout(240_000)

  for (const smallFileCount of REVIEW_PERFORMANCE_SMALL_FILE_COUNTS) {
    test(`PERF-REVIEW-${smallFileCount} renders ${smallFileCount} small files plus a 2 MiB text diff`, async ({
      browserName
    }, testInfo) => {
      test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

      const fixture = await createReviewPerformanceFixture(smallFileCount)
      const backend = await startMockBackend({
        responses: [
          assistantMessageResponse(
            `review-perf-${smallFileCount}`,
            `review-perf-${smallFileCount}-message`,
            'Thread ready'
          )
        ]
      })
      const logs: string[] = []
      const actionDurationsMs: Record<string, number> = {}
      let app: ElectronApplication | undefined

      try {
        app = await launchApp(backend, logs)
        const page = await app.firstWindow()
        collectRendererLogs(page, logs)
        await beginReviewPerformanceCollection(page)

        await measureAction(actionDurationsMs, 'createLocalProject', () =>
          createLocalProject(
            page,
            `Review perf ${smallFileCount} ${Date.now().toString(36)}`,
            fixture.projectRoot
          )
        )
        await measureAction(actionDurationsMs, 'sendComposerMessage', async () => {
          await sendComposerMessage(page, 'Open the review performance baseline.')
          await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')
        })
        await measureAction(actionDurationsMs, 'openReviewWorkspace', async () => {
          await openReviewWorkspace(page)
          await expect(reviewWorkspace(page)).toBeVisible()
        })
        const panel = reviewWorkspace(page)
        await measureAction(actionDurationsMs, 'waitForReviewDom', async () => {
          await expect
            .poll(() => panel.locator('[data-review-window-item]').count(), { timeout: 120_000 })
            .toBeGreaterThan(0)
        })
        await settleReviewWork(page)
        await measureAction(actionDurationsMs, 'treeFilterResults', async () => {
          const filter = panel.getByRole('textbox', { name: '筛选文件' })
          await filter.fill('file-0000')
          await expect(panel.getByRole('treeitem', { name: /file-0000/u })).toBeVisible()
        })
        await panel.getByRole('textbox', { name: '筛选文件' }).fill('')
        await settleReviewWork(page)
        await measureAction(actionDurationsMs, 'hideReviewFileTree', async () => {
          await panel.getByRole('button', { name: '隐藏文件树' }).click()
          await expect(panel.getByRole('button', { name: '显示文件树' })).toBeVisible()
        })
        await measureAction(actionDurationsMs, 'firstVisibleDiff', async () => {
          await expect(panel.locator('[data-review-file-diff]').first()).toBeVisible({
            timeout: 120_000
          })
        })
        await measureAction(actionDurationsMs, 'openContentSearch', async () => {
          await panel.focus()
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
          await expect(panel.getByRole('textbox', { name: '在审阅中查找' })).toBeVisible()
        })
        const search = panel.getByRole('textbox', { name: '在审阅中查找' })
        const contentSearchStartedAt = performance.now()
        await search.fill('fixture-file=0000')
        await expect(panel.getByRole('search')).toContainText('查找中')
        actionDurationsMs.contentSearchStatus = Math.round(
          performance.now() - contentSearchStartedAt
        )
        await expect(panel.getByRole('search')).not.toContainText('查找中')
        await expect(panel.getByRole('search')).toContainText(/\d+\/\d+/u)
        await expect(panel.getByRole('search').getByRole('alert')).toHaveCount(0)
        actionDurationsMs.contentSearchResults = Math.round(
          performance.now() - contentSearchStartedAt
        )
        await settleReviewWork(page)
        await clearReviewLongTasks(page)
        await measureAction(actionDurationsMs, 'scrollFiveSeconds', () =>
          scrollReviewForFiveSeconds(page)
        )

        const domFileBlockCount = await panel.locator('[data-review-window-item]').count()
        expect(domFileBlockCount).toBeLessThanOrEqual(60)
        const renderer = await readReviewPerformanceMetrics(page)
        const metrics = buildReviewPerformanceMetrics({
          fixture,
          domFileBlockCount,
          actionDurationsMs,
          renderer
        })
        assertReviewPerformanceMetrics(metrics)
        await attachMetrics(testInfo, smallFileCount, metrics)
      } finally {
        await attachDiagnostics(testInfo, logs, backend, app)
        await closeApp(app)
        await backend.close()
        await cleanupTempDirs([fixture.projectRoot])
      }
    })
  }
})

function reviewWorkspace(page: Page): Locator {
  return page.locator('[data-slot="review-workspace"]')
}

async function openReviewWorkspace(page: Page): Promise<void> {
  const openWorkspace = page.getByRole('button', { name: '打开工作区', exact: true })
  if (await openWorkspace.isVisible().catch(() => false)) await openWorkspace.click()

  const newTab = page.getByRole('button', { name: 'Open workspace tab', exact: true })
  if (await newTab.isVisible().catch(() => false)) {
    await newTab.click()
    await page.getByRole('menuitem', { name: /^Review/ }).click()
    return
  }

  await page.getByRole('button', { name: /^审阅/ }).click()
}

async function measureAction(
  target: Record<string, number>,
  label: string,
  action: () => Promise<void>
): Promise<void> {
  const startedAt = performance.now()
  await action()
  target[label] = Math.round(performance.now() - startedAt)
}

async function beginReviewPerformanceCollection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      reviewLongTaskObserver?: PerformanceObserver
      reviewLongTasks?: number[]
    }
    browserWindow.reviewLongTaskObserver?.disconnect()
    browserWindow.reviewLongTasks = []
    const observer = new PerformanceObserver((list) => {
      browserWindow.reviewLongTasks?.push(...list.getEntries().map((entry) => entry.duration))
    })
    observer.observe({ buffered: true, type: 'longtask' })
    browserWindow.reviewLongTaskObserver = observer
  })
}

async function settleReviewWork(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.setTimeout(() => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve())
          })
        }, 250)
      })
  )
}

async function clearReviewLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { reviewLongTasks?: number[] }).reviewLongTasks = []
  })
}

async function scrollReviewForFiveSeconds(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const container = document.querySelector<HTMLDivElement>('[data-review-diff-scroll-height]')
    if (!container) throw new Error('Missing Review diff scroll container')
    const deadline = performance.now() + 5_000
    while (performance.now() < deadline) {
      const nextScrollTop = Math.min(
        container.scrollTop + Math.max(200, Math.floor(container.clientHeight * 0.75)),
        Math.max(0, container.scrollHeight - container.clientHeight)
      )
      container.scrollTop = nextScrollTop
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    }
  })
}

async function readReviewPerformanceMetrics(
  page: Page
): Promise<ReviewPerformanceMetrics['renderer']> {
  return page.evaluate(() => {
    const browserWindow = window as typeof window & { reviewLongTasks?: number[] }
    const measures = performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('review:'))
      .reduce<Record<string, number[]>>((result, entry) => {
        const values = result[entry.name] ?? []
        values.push(Math.round(entry.duration * 100) / 100)
        result[entry.name] = values
        return result
      }, {})
    const longTasks = browserWindow.reviewLongTasks ?? []
    return {
      longTasks: {
        count: longTasks.length,
        maxDurationMs: Math.round(Math.max(0, ...longTasks) * 100) / 100,
        over200msCount: longTasks.filter((duration) => duration > 200).length,
        totalBlockingMs:
          Math.round(
            longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0) * 100
          ) / 100
      },
      reactCommitCount: performance
        .getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('review:react-commit:')).length,
      reviewMeasuresMs: measures
    }
  })
}

function assertReviewPerformanceMetrics(metrics: ReviewPerformanceMetrics): void {
  expect(metrics.schemaVersion).toBe(1)
  expect(metrics.fixture.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(metrics.fixture.largeDiffBytes).toBe(2 * 1024 * 1024)
  expect(metrics.fixture.changedFileCount).toBe(metrics.fixture.smallFileCount + 1)
  expect(metrics.dom.fileBlockCount).toBeGreaterThanOrEqual(0)
  expect(metrics.dom.fileBlockCount).toBeLessThanOrEqual(60)
  expect(metrics.renderer.reactCommitCount).toBeGreaterThan(0)
  expect(metrics.renderer.longTasks.maxDurationMs).toBeGreaterThanOrEqual(0)
  expect(metrics.renderer.longTasks.totalBlockingMs).toBeGreaterThanOrEqual(0)
  for (const [label, durationMs] of Object.entries(metrics.actionDurationsMs)) {
    expect(label.length).toBeGreaterThan(0)
    expect(Number.isFinite(durationMs)).toBe(true)
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(durationMs).toBeLessThan(180_000)
  }
}

async function attachMetrics(
  testInfo: TestInfo,
  smallFileCount: number,
  metrics: ReviewPerformanceMetrics
): Promise<void> {
  const body = `${JSON.stringify(metrics, null, 2)}\n`
  const metricsPath = testInfo.outputPath(`review-performance-${smallFileCount}.json`)
  await writeFile(metricsPath, body, 'utf8')
  await testInfo.attach(`review-performance-${smallFileCount}.json`, {
    body,
    contentType: 'application/json'
  })
}
