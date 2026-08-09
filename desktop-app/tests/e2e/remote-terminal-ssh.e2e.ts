import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

import {
  appRoot,
  attachDiagnostics,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { sendComposerMessage } from './support/chatActions'
import { startLocalSshServer, type LocalSshServer } from './support/local-ssh-server'
import { assistantMessageResponse, startMockBackend } from './support/mockBackend'

test('RW-E2E-09 runs a remote terminal through system ssh and a loopback ssh2 server', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  test.skip(
    process.platform === 'win32',
    'The loopback ssh2 wrapper currently targets OpenSSH on macOS/Linux'
  )

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-remote-terminal-'))
  const tracePath = join(projectRoot, 'remote-terminal-trace.jsonl')
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse(
        'remote-terminal-thread',
        'remote-terminal-message',
        'Remote terminal ready'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined
  let sshServer: LocalSshServer | undefined

  try {
    await writeFile(join(projectRoot, 'README.md'), '# Remote terminal SSH smoke\n', 'utf8')
    sshServer = await startLocalSshServer({
      appServerPath: join(appRoot, 'tests/e2e/support/remote-git-app-server.mjs'),
      terminalTracePath: tracePath
    })
    app = await launchApp(backend, logs, {
      environment: {
        PATH: `${sshServer.sshBinDirectory}:${process.env.PATH ?? ''}`,
        DASCOWORK_E2E_REAL_SSH_PATH: sshServer.realSshPath,
        DASCOWORK_E2E_SSH_CONFIG: sshServer.sshConfigPath,
        DASCOWORK_REMOTE_CODEX_COMMAND: 'codex'
      }
    })
    const page = await app.firstWindow()
    await page.evaluate(() => window.localStorage.clear())
    collectRendererLogs(page, logs)
    await createRemoteProject(page, `SSH2 remote terminal ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open the remote terminal SSH smoke test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Remote terminal ready')

    await openRightWorkspace(page)
    await openWorkspaceMenuItem(page, 'Terminal')
    await expect(page.locator('.xterm')).toBeVisible()
    await expect.poll(() => sshServer?.authenticatedConnectionCount() ?? 0).toBeGreaterThan(0)
    await expect
      .poll(() => sshServer?.remoteCommands ?? [])
      .toContain("exec 'codex' app-server --listen stdio://")
    await expect.poll(() => traceMethods(tracePath)).toContain('process/spawn')
    const rightPanel = page.locator('[data-slot="right-workspace-shell"]')
    const sessionId = await activeTerminalSessionId(rightPanel)

    await typeVisibleTerminalCommand(page, 'printf SSH2_LOCAL_SMOKE_OK')
    await expectTerminalSnapshot(page, sessionId, ['SSH2_LOCAL_SMOKE_OK'])
    await page.evaluate(async (id) => {
      await window.desktopApp.workspace.terminal.resize({
        version: 2,
        sessionId: id,
        cols: 101,
        rows: 37
      })
    }, sessionId)

    await expect
      .poll(() => traceMethods(tracePath))
      .toEqual(expect.arrayContaining(['process/spawn', 'process/writeStdin', 'process/resizePty']))
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await sshServer?.close()
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

async function createRemoteProject(page: Page, label: string, path: string): Promise<void> {
  await page.evaluate(
    async ({ projectLabel, remotePath }) => {
      await window.desktopApp.projects.createRemoteProject({
        hostId: 'e2e-remote',
        label: projectLabel,
        remotePath
      })
    },
    { projectLabel: label, remotePath: path }
  )
  await expect(page.locator('[data-slot="composer-project-card"]')).toContainText(label)
}

async function openRightWorkspace(page: Page): Promise<void> {
  const openToggle = page.getByRole('button', { name: '打开工作区', exact: true })
  await expect(openToggle).toBeVisible()
  await openToggle.click()
  await expect(page.getByRole('button', { name: '关闭工作区', exact: true })).toBeVisible()
}

async function openWorkspaceMenuItem(page: Page, label: string): Promise<void> {
  const menuTrigger = page.getByRole('button', { name: 'Open workspace tab', exact: true })
  if (await menuTrigger.isVisible().catch(() => false)) {
    await menuTrigger.click()
    await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
    return
  }
  await page
    .getByRole('button', { name: new RegExp(`^${label === 'Terminal' ? '终端' : label}`) })
    .click()
}

async function activeTerminalSessionId(panel: Locator): Promise<string> {
  const tabId = await panel
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
        page
          .evaluate(async (id) => {
            const snapshot = await window.desktopApp.workspace.terminal.snapshot({
              version: 2,
              sessionId: id
            })
            return snapshot.output
          }, sessionId)
          .catch(() => ''),
      { timeout: 10_000 }
    )
    .toEqual(expect.stringContaining(expectedFragments.at(-1) ?? ''))
}

async function traceMethods(tracePath: string): Promise<string[]> {
  try {
    const trace = await readFile(tracePath, 'utf8')
    return trace
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: unknown })
      .flatMap((entry) => (typeof entry.method === 'string' ? [entry.method] : []))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
