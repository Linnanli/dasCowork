import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { attachDiagnostics, closeApp, collectRendererLogs, launchApp } from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'
import {
  assistantMessageResponse,
  deferred,
  functionCallOutputText,
  isResponsesUrl,
  providerResponseBodies,
  shellCommandResponse,
  startMockBackend
} from './support/mockBackend'

const fdeSkillsRoot = '/Users/nallylin/Documents/code/fde-skills'

type ToolGroupSnapshot = {
  kind: string | null
  state: string | null
  key: string | null
  targetId: string | null
  triggerText: string
  visibleText: string
  contentText: string
}

test('keeps adjacent tool activity in one group while analyzing fde-skills', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  test.skip(!existsSync(fdeSkillsRoot), `Missing diagnostic project: ${fdeSkillsRoot}`)

  const releaseSecondTool = deferred()
  const releaseFinal = deferred()
  const backend = await startMockBackend({
    responses: [
      shellCommandResponse('resp-fde-read', 'call-fde-readme', {
        command: 'cat README.md',
        timeout_ms: 5000
      }),
      {
        ...shellCommandResponse('resp-fde-slow-list', 'call-fde-slow-list', {
          command:
            'python3 -c "import time; time.sleep(2); print(\\"README.md\\\\nfront/README.md\\\\nproduct/README.md\\")"',
          timeout_ms: 5000
        }),
        beforeResponse: () => releaseSecondTool.promise
      },
      {
        ...assistantMessageResponse(
          'resp-fde-final',
          'msg-fde-final',
          'fde-skills diagnostic complete'
        ),
        beforeResponse: () => releaseFinal.promise
      }
    ]
  })
  const logs: string[] = []
  const snapshots: Record<string, ToolGroupSnapshot[]> = {}
  const thinkingSnapshots: Record<string, string> = {}
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)

    await expect(page.locator('body')).toContainText('qwen3.7-plus')
    await createLocalProject(page, 'FDE Skills Diagnostic', fdeSkillsRoot)
    await expect(page.locator('body')).toContainText('Working in: FDE Skills Diagnostic')

    await sendComposerMessage(page, '分析一下当前项目')

    await waitForResponsesRequestCount(backend, 2)
    await expect(page.locator('[data-slot="tool-group-unit"]')).toBeVisible()
    snapshots.afterFirstToolBeforeSecondResponse = await snapshotToolGroups(page)
    thinkingSnapshots.afterFirstToolBeforeSecondResponse = await snapshotMessageThinking(page)

    releaseSecondTool.resolve()
    await expect
      .poll(
        async () => {
          const groups = await snapshotToolGroups(page)
          return groups.length === 1 && groups[0]?.triggerText.includes('正在')
        },
        { timeout: 5000 }
      )
      .toBe(true)
    snapshots.whileSecondToolRunning = await snapshotToolGroups(page)
    thinkingSnapshots.whileSecondToolRunning = await snapshotMessageThinking(page)

    await waitForResponsesRequestCount(backend, 3)
    snapshots.afterSecondToolBeforeFinalResponse = await snapshotToolGroups(page)
    thinkingSnapshots.afterSecondToolBeforeFinalResponse = await snapshotMessageThinking(page)

    releaseFinal.resolve()
    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'fde-skills diagnostic complete'
    )
    snapshots.afterFinalResponse = await snapshotToolGroups(page)
    thinkingSnapshots.afterFinalResponse = await snapshotMessageThinking(page)

    const providerBodies = providerResponseBodies(backend)
    const diagnostic = {
      projectRoot: fdeSkillsRoot,
      prompt: '分析一下当前项目',
      snapshots,
      thinkingSnapshots,
      functionOutputs: {
        readme: outputExcerpt(functionCallOutputText(providerBodies[1], 'call-fde-readme')),
        slowList: outputExcerpt(functionCallOutputText(providerBodies[2], 'call-fde-slow-list'))
      },
      responseRequestCount: backend.requests.filter(
        (request) => request.method === 'POST' && isResponsesUrl(request.url)
      ).length
    }
    const diagnosticsPath = testInfo.outputPath('tool-groups-diagnostic.json')
    await writeFile(diagnosticsPath, JSON.stringify(diagnostic, null, 2), 'utf8')
    await testInfo.attach('tool-groups-diagnostic.json', {
      contentType: 'application/json',
      path: diagnosticsPath
    })

    expect(snapshots.afterFirstToolBeforeSecondResponse[0]?.triggerText).toContain('已探索')
    expect(snapshots.afterFirstToolBeforeSecondResponse[0]?.triggerText).not.toContain('正在思考')
    expect(thinkingSnapshots.afterFirstToolBeforeSecondResponse).toContain('正在思考')
    expect(snapshots.whileSecondToolRunning).toHaveLength(1)
    expect(snapshots.whileSecondToolRunning[0]?.triggerText).toContain('正在')
    expect(thinkingSnapshots.whileSecondToolRunning).toBe('')
    expect(snapshots.afterSecondToolBeforeFinalResponse).toHaveLength(1)
    expect(snapshots.afterSecondToolBeforeFinalResponse[0]?.triggerText).toContain(
      '已读取 1 个文件'
    )
    expect(snapshots.afterSecondToolBeforeFinalResponse[0]?.triggerText).toContain(
      '已运行 1 条命令'
    )
    expect(snapshots.afterSecondToolBeforeFinalResponse[0]?.triggerText).not.toContain('正在思考')
    expect(thinkingSnapshots.afterSecondToolBeforeFinalResponse).toContain('正在思考')
    expect(thinkingSnapshots.afterFinalResponse).toBe('')
  } finally {
    releaseSecondTool.resolve()
    releaseFinal.resolve()
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

async function waitForResponsesRequestCount(
  backend: Awaited<ReturnType<typeof startMockBackend>>,
  count: number
): Promise<void> {
  await expect
    .poll(
      () =>
        backend.requests.filter(
          (request) => request.method === 'POST' && isResponsesUrl(request.url)
        ).length,
      { timeout: 20_000 }
    )
    .toBeGreaterThanOrEqual(count)
}

async function snapshotMessageThinking(page: Page): Promise<string> {
  const labels = await page.locator('[data-slot="message-thinking-unit"]').allInnerTexts()
  return labels.map((label) => label.trim()).join('\n')
}

async function snapshotToolGroups(page: Page): Promise<ToolGroupSnapshot[]> {
  return page.locator('[data-slot="tool-group-unit"]').evaluateAll((groups) =>
    groups.map((group) => {
      const trigger = group.querySelector<HTMLElement>('[data-slot="tool-group-trigger"]')
      const content = group.querySelector<HTMLElement>('[data-slot="tool-group-content"]')
      return {
        kind: group.getAttribute('data-tool-group-kind'),
        state: group.getAttribute('data-state'),
        key: group.getAttribute('data-render-unit-key'),
        targetId: group.getAttribute('data-render-target-id'),
        triggerText: trigger?.innerText.trim() ?? '',
        visibleText: (group as HTMLElement).innerText.trim(),
        contentText: content?.innerText.trim() ?? ''
      }
    })
  )
}

function outputExcerpt(output: string | undefined): string | undefined {
  if (!output) return undefined
  return output.slice(0, 1000)
}
