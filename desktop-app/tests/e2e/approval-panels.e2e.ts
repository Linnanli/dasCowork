import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { sendMessage } from './support/chatActions'
import { startMockBackend } from './support/mockBackend'

test.describe.configure({ timeout: 90_000 })

test('P0-06 E2E renders file diff approval and returns the session decision', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('file', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Update the fixture file.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('编辑文件')
    await expect(panel).toContainText('是否允许 ChatGPT 编辑以下文件？')
    await expect(panel).toContainText('p0-06-approval.e2e.ts')
    await expect(panel).toContainText('+1')
    await expect(panel).toContainText('−1')
    await expect(panel.locator('details')).toHaveCount(1)
    await expect(panel).not.toContainText('Update the E2E fixture')
    await expect(panel).not.toContainText('来自：')
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await attachApprovalScreenshots(page, testInfo, 'file')

    await panel.getByRole('button', { name: '更多允许选项' }).click()
    await page.getByRole('menuitem', { name: /允许所有修改/ }).click()

    await expect(panel).toBeHidden()
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        decision: 'acceptForSession'
      })
  })
})

test('P0-06 E2E renders the reference network approval and returns the advertised amendment', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('network', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Push the branch.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('网络访问')
    await expect(panel).toContainText('https://github.com')
    await expect(panel).toContainText('github.com 不在当前网络允许列表中')
    await expect(panel).toContainText('请求原因')
    await expect(panel).toContainText('Push the approved branch')
    await expect(panel).toContainText('当前目标范围')
    await expect(panel).toContainText('可用规则范围')
    await expect(panel).toContainText('允许访问 github.com')
    await expect(panel).not.toContainText('git push origin main')
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await attachApprovalScreenshots(page, testInfo, 'network')

    await panel.getByRole('button', { name: '更多允许选项' }).click()
    await page.getByRole('menuitem', { name: '允许访问 github.com，并记住该规则' }).click()

    await expect(panel).toBeHidden()
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: 'github.com', action: 'allow' }
          }
        }
      })
  })
})

test('P0-06 E2E keeps Other mutually exclusive with an option and preserves secret input', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('tool', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Ask for deployment input.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    const secretInput = panel.locator('input[type="password"]')
    await expect(panel).toContainText('Choose an environment')
    await expect(panel).toContainText('第 1 / 2 题')
    await expect(panel).not.toContainText('Environment')
    await expect(secretInput).toHaveCount(0)
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await attachApprovalScreenshots(page, testInfo, 'tool-input')
    await panel.getByLabel('staging').click()
    await page.waitForTimeout(250)
    await expect(panel).toContainText('Choose an environment')
    await expect(secretInput).toHaveCount(0)
    await panel.getByLabel('其他回答').fill('preview')
    await panel.getByRole('button', { name: '继续' }).click()
    await expect(panel).toContainText('Enter a deployment token')
    await expect(secretInput).toHaveCount(1)
    await secretInput.fill('p0-06-secret')
    await panel.getByRole('button', { name: '提交回答' }).click()

    await expect(panel).toBeHidden()
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        answers: {
          environment: { answers: ['preview'] },
          token: { answers: ['p0-06-secret'] }
        }
      })
  })
})

test('P0-06 E2E handles a missing file diff without exposing session approval', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('file-cache-miss', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Update a fixture whose diff is unavailable.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('暂未收到可展示的文件 diff')
    await expect(panel.getByRole('button', { name: '更多允许选项' })).toHaveCount(0)
    await panel.getByRole('button', { name: '允许一次' }).click()

    await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ decision: 'accept' })
  })
})

test('P0-06 E2E preserves MCP multi-select, number, and boolean fields', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('mcp', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Ask the deployment MCP server for settings.')

    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('Choose deployment settings')
    await expect(panel).toContainText('deployments 请求输入')
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(0)
    await attachApprovalScreenshots(page, testInfo, 'mcp')
    await panel.getByLabel('Logs').click()
    await panel.getByLabel('Metrics').click()
    await panel.getByLabel('Replicas').fill('3')
    await panel.getByRole('button', { name: '提交' }).click()

    await expect(panel).toBeHidden()
    await expect(page.locator('[data-slot="aui_composer-shell"]')).toHaveCount(1)
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        action: 'accept',
        content: { features: ['logs', 'metrics'], replicas: 3, dryRun: true },
        _meta: null
      })
  })
})

test('P0-07 E2E preserves App Server command decision semantics', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'command-decisions-missing',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Use legacy command decisions.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel.getByRole('button', { name: '拒绝并停止' })).toBeVisible()
      await expect(panel.getByRole('button', { name: '拒绝并继续' })).toHaveCount(0)
      await panel.getByRole('button', { name: '拒绝并停止' }).click()
      await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ decision: 'cancel' })
    }
  )

  await withApprovalScenario(
    'command-decisions-empty-auto-cancel',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Auto-cancel an empty command decision list.')
      await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ decision: 'cancel' })
      await expect(page.locator('[data-slot="server-request-panel"]')).toHaveCount(0)
    }
  )

  await withApprovalScenario(
    'command-decline-versus-cancel',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Choose how to reject the command.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel.getByRole('button', { name: '拒绝并继续' })).toBeVisible()
      await expect(panel.getByRole('button', { name: '拒绝并停止' })).toBeVisible()
      await panel.getByRole('button', { name: '拒绝并继续' }).click()
      await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ decision: 'decline' })
    }
  )
})

test('P0-07 E2E clears terminal option timers and omits optional numeric blanks', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'tool-option-terminal-timer-race',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Reject immediately after choosing an option.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('Choose an environment')
      await panel.evaluate((element) => {
        const option = element.querySelector<HTMLButtonElement>('[data-slot="radio-group-item"]')
        const reject = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === '拒绝'
        )
        option?.click()
        reject?.click()
      })
      await page.waitForTimeout(300)
      await expect.poll(() => readApprovalResponses(responsePath)).toHaveLength(1)
      await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ answers: {} })
    }
  )

  await withApprovalScenario(
    'mcp-optional-number-empty',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Clear an optional numeric field.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      const replicas = panel.getByLabel('Replicas')
      await expect(replicas).toHaveValue('2')
      await replicas.fill('')
      await panel.getByRole('button', { name: '提交' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({ action: 'accept', content: {}, _meta: null })
    }
  )
})

test('P0-07 E2E renders an explainable network permission request and returns only turn scope', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'permission-network-turn',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Request network permission.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('网络访问')
      await expect(panel).toContainText('连接')
      await expect(panel).toContainText('网络访问')
      await expect(panel).toContainText('允许本轮')
      await expect(panel).toContainText('本次会话允许')
      await attachApprovalScreenshots(page, testInfo, 'permission-network-turn')
      await panel.getByRole('button', { name: '允许本轮' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({
          permissions: { network: { enabled: true }, fileSystem: null },
          scope: 'turn'
        })
    }
  )
})

test('P0-07 E2E returns session scope while preserving the original filesystem profile', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'permission-filesystem-session',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Request filesystem permission.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('请求权限')
      await expect(panel).toContainText('/private/tmp/e2e-approval')
      await expect(panel).toContainText('扫描深度 ≤ 3')
      await panel.getByRole('button', { name: '本次会话允许' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({
          permissions: {
            network: null,
            fileSystem: {
              entries: [
                { path: { type: 'path', path: '/private/tmp/e2e-approval' }, access: 'read' },
                { path: { type: 'glob_pattern', pattern: '/private/tmp/**/*.ts' }, access: 'write' }
              ],
              globScanMaxDepth: 3
            }
          },
          scope: 'session'
        })
    }
  )
})

test('P0-07 E2E auto-resolves tool input once after Main-held deadline', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('tool-auto-resolve', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Ask a timed question.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('自动跳过')
    await attachApprovalScreenshots(page, testInfo, 'tool-auto-resolve')
    await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ answers: {} })
    await expect(panel).toBeHidden()
  })
})

test('P0-07 E2E declines a mixed permission request without returning renderer-provided permissions', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'permission-mixed-decline',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Decline a mixed permission request.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('网络访问')
      await expect(panel).toContainText('临时目录')
      await attachApprovalScreenshots(page, testInfo, 'permission-mixed-decline')
      await panel.getByRole('button', { name: '拒绝' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({ permissions: {}, scope: 'turn' })
    }
  )
})

test('P0-07 E2E explains command additional permissions but preserves the command decision', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'command-additional-permissions',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Run the permissioned command.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('是否允许执行以下命令？')
      await expect(panel).toContainText('/private/tmp/e2e-command')
      await expect(panel).toContainText('网络访问')
      await attachApprovalScreenshots(page, testInfo, 'command-additional-permissions')
      await panel.getByRole('button', { name: '允许一次' }).click()
      await expect.poll(() => readApprovalResponse(responsePath)).toEqual({ decision: 'accept' })
    }
  )
})

test('P0-07 E2E snoozes a tool auto-resolution timer after interaction', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'tool-auto-resolve-snooze',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Answer a timed question.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('自动跳过')
      await attachApprovalScreenshots(page, testInfo, 'tool-auto-resolve-snooze')
      await panel.getByLabel('Where should this run?').fill('preview')
      await page.waitForTimeout(1_100)
      await expect.poll(() => readApprovalResponse(responsePath)).toBeNull()
      await panel.getByRole('button', { name: '提交回答' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({
          answers: { target: { answers: ['preview'] } }
        })
    }
  )
})

test('P0-07 E2E maps MCP typed cancel and OpenAI form actions distinctly', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('mcp-typed-cancel', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Cancel a typed MCP request.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('Typed cancellation')
    await attachApprovalScreenshots(page, testInfo, 'mcp-typed-cancel')
    await panel.getByRole('button', { name: '取消' }).click()
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({ action: 'cancel', content: null, _meta: null })
  })

  await new Promise((resolve) => setTimeout(resolve, 2_000))

  await withApprovalScenario('mcp-openai-supported', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Submit a supported OpenAI MCP form.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('OpenAI deployment')
    await attachApprovalScreenshots(page, testInfo, 'mcp-openai-supported')
    await panel.getByLabel('Email').fill('operator@example.com')
    await expect(panel.getByRole('radio', { name: 'Light' }).locator('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,AA=='
    )
    await panel.getByRole('radio', { name: 'Light' }).click()
    await panel.getByRole('button', { name: '提交' }).click()
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        action: 'accept',
        content: { email: 'operator@example.com', replicas: 2, theme: 'light' },
        _meta: null
      })
  })
})

test('P0-07 E2E distinguishes unsupported OpenAI form skip and dismiss', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario(
    'mcp-openai-unsupported-skip',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Skip an unsupported OpenAI MCP form.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await expect(panel).toContainText('当前版本无法安全显示此请求')
      await attachApprovalScreenshots(page, testInfo, 'mcp-openai-unsupported-skip')
      await panel.getByRole('button', { name: '拒绝' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({
          action: 'decline',
          content: null,
          _meta: { reason: 'Rejected from desktop UI' }
        })
    }
  )

  await withApprovalScenario(
    'mcp-openai-unsupported-dismiss',
    testInfo,
    async ({ page, responsePath }) => {
      await sendMessage(page, 'Dismiss an unsupported OpenAI MCP form.')
      const panel = page.locator('[data-slot="server-request-panel"]')
      await attachApprovalScreenshots(page, testInfo, 'mcp-openai-unsupported-dismiss')
      await panel.getByRole('button', { name: '取消' }).click()
      await expect
        .poll(() => readApprovalResponse(responsePath))
        .toEqual({ action: 'cancel', content: null, _meta: null })
    }
  )
})

test('P0-07 E2E requires opening an MCP URL before continuing and rejects invalid URLs', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  await withApprovalScenario('mcp-url-open-continue', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Complete browser sign in.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('http://127.0.0.1:9/e2e-auth')
    await attachApprovalScreenshots(page, testInfo, 'mcp-url-open-continue')
    await panel.getByRole('button', { name: '打开链接' }).click()
    await expect(panel.getByRole('button', { name: '继续' })).toBeVisible()
    await expect.poll(() => readApprovalResponse(responsePath)).toBeNull()
    await panel.getByRole('button', { name: '继续' }).click()
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({ action: 'accept', content: null, _meta: null })
  })

  await withApprovalScenario('mcp-url-invalid', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Reject an invalid browser sign in.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('外部地址无效')
    await attachApprovalScreenshots(page, testInfo, 'mcp-url-invalid')
    await expect(panel.getByRole('button', { name: '打开链接' })).toHaveCount(0)
    await panel.getByRole('button', { name: '拒绝' }).click()
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        action: 'decline',
        content: null,
        _meta: { reason: 'Rejected from desktop UI' }
      })
  })

  await withApprovalScenario('mcp-url-decline', testInfo, async ({ page, responsePath }) => {
    await sendMessage(page, 'Reject a browser sign in request.')
    const panel = page.locator('[data-slot="server-request-panel"]')
    await expect(panel).toContainText('http://127.0.0.1:9/e2e-auth')
    await expect(panel.getByRole('button', { name: '取消' })).toHaveCount(0)
    await panel.getByRole('button', { name: '拒绝' }).click()
    await expect
      .poll(() => readApprovalResponse(responsePath))
      .toEqual({
        action: 'decline',
        content: null,
        _meta: { reason: 'Rejected from desktop UI' }
      })
  })
})

type ApprovalScenario =
  | 'file'
  | 'file-cache-miss'
  | 'network'
  | 'tool'
  | 'mcp'
  | 'permission-network-turn'
  | 'permission-filesystem-session'
  | 'permission-mixed-decline'
  | 'command-additional-permissions'
  | 'command-decisions-missing'
  | 'command-decisions-empty-auto-cancel'
  | 'command-decline-versus-cancel'
  | 'tool-auto-resolve'
  | 'tool-auto-resolve-snooze'
  | 'tool-option-terminal-timer-race'
  | 'mcp-typed-cancel'
  | 'mcp-optional-number-empty'
  | 'mcp-openai-supported'
  | 'mcp-openai-unsupported-skip'
  | 'mcp-openai-unsupported-dismiss'
  | 'mcp-url-open-continue'
  | 'mcp-url-invalid'
  | 'mcp-url-decline'

async function withApprovalScenario(
  scenario: ApprovalScenario,
  testInfo: Parameters<typeof attachDiagnostics>[0],
  run: (input: {
    page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
    responsePath: string
  }) => Promise<void>
): Promise<void> {
  const serverStateDir = await mkdtemp(join(tmpdir(), `dascowork-e2e-approval-${scenario}-`))
  const responsePath = join(serverStateDir, 'approval-response.json')
  const backend = await startMockBackend({ responses: [] })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs, {
      environment: {
        CODEX_APP_SERVER_BIN: join(appRoot, 'tests/e2e/support/approval-panel-app-server.mjs'),
        DASCOWORK_E2E_APPROVAL_RESPONSE_PATH: responsePath,
        DASCOWORK_E2E_APPROVAL_SCENARIO: scenario
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await run({ page, responsePath })
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([serverStateDir])
  }
}

async function readApprovalResponse(responsePath: string): Promise<unknown> {
  try {
    const content = await readFile(responsePath, 'utf8')
    return JSON.parse(content.trim())
  } catch {
    return null
  }
}

async function readApprovalResponses(responsePath: string): Promise<unknown[]> {
  try {
    const content = await readFile(responsePath, 'utf8')
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

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
