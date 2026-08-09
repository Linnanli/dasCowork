import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import { toAppMediaUrl } from '../../src/main/localMediaProtocol'
import { closeApp, launchApp } from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'
import { assistantMessageResponse } from './support/mockBackend'
import { startMockBackend, type MockBackend } from './support/mockBackend'

const packagedExecutable = process.env.DASCOWORK_PACKAGED_APP_EXECUTABLE

test.describe('packaged local media smoke', () => {
  test.skip(!packagedExecutable, 'run through npm run test:e2e:packaged')

  let app: ElectronApplication | undefined
  let backend: MockBackend
  let tempDir: string

  test.afterEach(async () => {
    await closeApp(app)
    await backend?.close()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('loads asar assets, local media, and a real packaged terminal session', async () => {
    backend = await startMockBackend({
      responses: [
        assistantMessageResponse('packaged-terminal-thread', 'packaged-terminal-message', 'Ready')
      ]
    })
    tempDir = await mkdtemp(join(tmpdir(), 'dascowork-packaged-media-'))
    const projectRoot = join(tempDir, 'project')
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'README.md'), '# Packaged terminal smoke\n', 'utf8')
    const imagePath = join(tempDir, 'packaged-smoke.png')
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )

    app = await launchApp(backend, [], {
      executablePath: packagedExecutable,
      args: [],
      cwd: process.cwd()
    })
    const page = await app.firstWindow()

    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await expect.poll(() => page.url()).toBe('app://-/index.html')
    await expect(
      page.evaluate(() => ({
        scripts: [...document.scripts].map((script) => script.src),
        styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (link) => (link as HTMLLinkElement).href
        )
      }))
    ).resolves.toMatchObject({
      scripts: [expect.stringMatching(/^app:\/\/-\/assets\/.+\.js$/)],
      styles: [expect.stringMatching(/^app:\/\/-\/assets\/.+\.css$/)]
    })

    await expect(
      page.evaluate(
        (url) =>
          new Promise((resolve) => {
            const image = new Image()
            image.onload = () => resolve({ loaded: true, width: image.naturalWidth })
            image.onerror = () => resolve({ loaded: false, width: 0 })
            image.src = url
          }),
        toAppMediaUrl(imagePath)!
      )
    ).resolves.toEqual({ loaded: true, width: 1 })

    await createLocalProject(page, `Packaged smoke ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open packaged terminal smoke.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Ready')
    await openRightWorkspace(page)
    await openWorkspaceMenuItem(page, 'Terminal')
    const terminalStarted = await startVisibleTerminalIfAvailable(page)
    expect(terminalStarted, 'packaged app must load the unpacked node-pty ABI').toBe(true)
    const terminalSessionId = await activeTerminalSessionId(page)

    await typeVisibleTerminalCommand(page, 'echo PACKAGED_NODE_PTY_ABI_OK')
    await expectTerminalSnapshot(page, terminalSessionId, ['PACKAGED_NODE_PTY_ABI_OK'])
  })
})

async function openRightWorkspace(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '打开工作区', exact: true })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.getByRole('button', { name: '关闭工作区', exact: true })).toBeVisible()
}

async function openWorkspaceMenuItem(page: Page, label: string): Promise<void> {
  const menuTrigger = page.getByRole('button', { name: 'Open workspace tab', exact: true })
  if (await menuTrigger.isVisible().catch(() => false)) {
    await menuTrigger.click()
    await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
    return
  }
  await page.getByRole('button', { name: label === 'Terminal' ? /^终端/u : label }).click()
}

async function startVisibleTerminalIfAvailable(page: Page): Promise<boolean> {
  const xterm = page.locator('.xterm')
  const unavailable = page.getByText(/终端原生模块不可用|无法启动终端|node-pty/u)
  return Promise.race([
    xterm.waitFor({ state: 'visible', timeout: 7_500 }).then(() => true),
    unavailable.waitFor({ state: 'visible', timeout: 7_500 }).then(() => false)
  ])
}

async function activeTerminalSessionId(page: Page): Promise<string> {
  const tabId = await page
    .locator('[role="tab"][aria-selected="true"][data-workspace-tab-id^="terminal:"]')
    .getAttribute('data-workspace-tab-id')
  if (!tabId?.startsWith('terminal:')) throw new Error('Missing active terminal tab id')
  return tabId.slice('terminal:'.length)
}

async function typeVisibleTerminalCommand(page: Page, command: string): Promise<void> {
  const terminalInput = page.locator('.xterm-helper-textarea').last()
  await terminalInput.focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

async function expectTerminalSnapshot(
  page: Page,
  sessionId: string,
  expectedFragments: string[]
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const snapshot = await window.desktopApp.workspace.terminal.snapshot({
            version: 2,
            sessionId: id
          })
          return snapshot.output
        }, sessionId),
      { timeout: 10_000 }
    )
    .toEqual(expect.stringContaining(expectedFragments.at(-1) ?? ''))
}
