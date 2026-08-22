import { expect, test, type ElectronApplication } from '@playwright/test'

import { attachDiagnostics, closeApp, launchApp } from './support/app'
import { ensureLocalProjectSelected, sendComposerMessage } from './support/chatActions'
import { assistantMessageResponse, startMockBackend } from './support/mockBackend'

test('injects one gated desktop app-context into normal and projectless app-server threads', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse(
        'desktop-context-local',
        'desktop-context-local-message',
        'Local reply'
      ),
      assistantMessageResponse(
        'desktop-context-projectless',
        'desktop-context-projectless-message',
        'Projectless reply'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    await ensureLocalProjectSelected(page)
    await sendComposerMessage(page, 'Create a normal local thread.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Local reply')

    await expect.poll(() => outboundDeveloperInstructions(logs).length, { timeout: 10_000 }).toBe(1)
    const localInstructions = outboundDeveloperInstructions(logs)[0]
    expect(localInstructions).toBeDefined()
    assertNormalDesktopContext(localInstructions ?? '')

    await page.evaluate(async () => {
      await window.desktopApp.projects.selectProject({ projectKind: 'projectless' })
    })
    await page.getByRole('button', { name: '新对话', exact: true }).click()
    await sendComposerMessage(page, 'Create a projectless thread.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Projectless reply')

    await expect.poll(() => outboundDeveloperInstructions(logs).length, { timeout: 10_000 }).toBe(2)
    const projectlessInstructions = outboundDeveloperInstructions(logs)[1]
    expect(projectlessInstructions).toBeDefined()
    assertProjectlessDesktopContext(projectlessInstructions ?? '')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
  }
})

function outboundDeveloperInstructions(logs: readonly string[]): string[] {
  return logs.flatMap(parseCodexAspPackets).flatMap(({ message }) => {
    if (message.debug !== 'thread/start') return []

    const developerInstructions = message.data?.developerInstructions
    return typeof developerInstructions === 'string' ? [developerInstructions] : []
  })
}

function parseCodexAspPackets(
  line: string
): Array<{ message: { debug?: string; data?: { developerInstructions?: unknown } } }> {
  const marker = '[codex-asp] '
  const packets = [] as Array<{
    message: { debug?: string; data?: { developerInstructions?: unknown } }
  }>
  let searchFrom = 0

  while (true) {
    const payloadStart = line.indexOf(marker, searchFrom)
    if (payloadStart < 0) return packets

    const packet = parseJsonObjectPrefix(line.slice(payloadStart + marker.length))
    if (packet && typeof packet === 'object' && 'message' in packet) {
      const { message } = packet
      if (message && typeof message === 'object') {
        packets.push({
          message: message as { debug?: string; data?: { developerInstructions?: unknown } }
        })
      }
    }

    searchFrom = payloadStart + marker.length
  }
}

function parseJsonObjectPrefix(input: string): unknown {
  let depth = 0
  let escaped = false
  let inString = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(input.slice(0, index + 1)) as unknown
        } catch {
          return undefined
        }
      }
    }
  }

  return undefined
}

function assertNormalDesktopContext(instructions: string): void {
  assertRequiredDesktopContext(instructions)
  expect(instructions).not.toContain('### Projectless Chat')
}

function assertRequiredDesktopContext(instructions: string): void {
  expect(instructions.match(/<app-context>/gu)).toHaveLength(1)
  expect(instructions).toContain('# DasCowork desktop context')
  expect(instructions).toContain('### Inline Code Comments')
  expect(instructions).not.toContain('load_workspace_dependencies')
  expect(instructions).not.toContain('automation_update')
  expect(instructions).not.toContain(':::writing')
  expect(instructions).not.toContain('::git-*')
  expect(instructions).not.toContain('<heartbeat>')
}

function assertProjectlessDesktopContext(instructions: string): void {
  assertRequiredDesktopContext(instructions)
  expect(instructions).toContain('### Projectless Chat')

  const outputDirectory = instructions.match(/User-facing deliverables directory: (.+)\./u)?.[1]
  expect(outputDirectory).toMatch(/^\//u)
  expect(instructions).toContain(`Store user-facing deliverables only under ${outputDirectory}.`)
  expect(instructions).toContain(`link only files under ${outputDirectory}.`)
}
