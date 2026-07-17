import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import electronExecutable from 'electron'
import { _electron as electron, type ElectronApplication } from 'playwright'
import type { MockBackend } from './mockBackend'

export const appRoot = resolve(__dirname, '..', '..', '..')
export const repoRoot = resolve(appRoot, '..')

export type LaunchAppOptions = {
  configureCodexHome?: (codexHomeDir: string) => Promise<void>
  userDataDir?: string
  codexHomeDir?: string
  preserveDataDirectories?: boolean
  executablePath?: string
  args?: string[]
  cwd?: string
}

const appTempDirs = new WeakMap<ElectronApplication, string[]>()

export async function launchApp(
  backend: MockBackend,
  logs: string[],
  options: LaunchAppOptions = {}
): Promise<ElectronApplication> {
  const userDataDir =
    options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'dascowork-e2e-user-data-')))
  const codexHomeDir =
    options.codexHomeDir ?? (await mkdtemp(join(tmpdir(), 'dascowork-e2e-codex-home-')))
  const dataDirectories = [userDataDir, codexHomeDir]
  const documentsDir = join(userDataDir, 'Documents')
  let app: ElectronApplication | undefined

  try {
    await mkdir(documentsDir, { recursive: true })
    await options.configureCodexHome?.(codexHomeDir)
    app = await electron.launch({
      executablePath: options.executablePath ?? electronExecutable,
      args: options.args ?? ['.'],
      cwd: options.cwd ?? appRoot,
      env: {
        ...process.env,
        ADMIN_BACKEND_URL: backend.baseUrl,
        ADMIN_BACKEND_MODEL_USER_ID: 'e2e-user',
        ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '1000',
        CODEX_ASP_DEBUG_PACKETS: '1',
        CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: '1',
        CODEX_HOME: codexHomeDir,
        DASCOWORK_E2E_DOCUMENTS_DIR: documentsDir,
        DASCOWORK_E2E_USER_DATA_DIR: userDataDir,
        ELECTRON_ENABLE_LOGGING: '1'
      }
    })
  } catch (error) {
    if (!options.preserveDataDirectories) await cleanupTempDirs(dataDirectories)
    throw error
  }

  appTempDirs.set(app, options.preserveDataDirectories ? [] : dataDirectories)
  app.process().stdout?.on('data', (chunk) => logs.push(`[main:stdout] ${String(chunk)}`))
  app.process().stderr?.on('data', (chunk) => logs.push(`[main:stderr] ${String(chunk)}`))
  return app
}

export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return
  const tempDirs = appTempDirs.get(app) ?? []
  await app.close().catch(() => undefined)
  appTempDirs.delete(app)
  await cleanupTempDirs(tempDirs)
}

export async function cleanupTempDirs(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  )
}

export function collectRendererLogs(page: Page, logs: string[]): void {
  page.on('console', (message) => {
    logs.push(`[renderer:${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    logs.push(`[renderer:pageerror] ${error.stack ?? error.message}`)
  })
}

export async function attachDiagnostics(
  testInfo: TestInfo,
  logs: string[],
  backend: MockBackend,
  app: ElectronApplication | undefined
): Promise<void> {
  let status: unknown = undefined
  if (app) {
    const windows = app.windows()
    const page = windows[0]
    if (page) {
      status = await page
        .evaluate(async () => window.desktopApp?.codex?.getStatus?.())
        .catch((error: unknown) => `status unavailable: ${errorMessage(error)}`)
    }
  }

  const diagnosticsPath = testInfo.outputPath('desktop-chat-diagnostics.json')
  await writeFile(
    diagnosticsPath,
    JSON.stringify(
      {
        status,
        backendRequests: backend.requests,
        logs
      },
      null,
      2
    )
  )
  await testInfo.attach('desktop-chat-diagnostics.json', {
    contentType: 'application/json',
    path: diagnosticsPath
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
