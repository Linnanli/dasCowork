import { app, shell, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CodexChatRuntimeService } from './codexChatRuntimeService'
import { installWindowContextMenu } from './contextMenu'
import { createModelCatalogService } from './modelCatalogService'
import type { ProjectApiService } from './projects/ProjectApiService'
import type { WorkspaceFileSearchService } from './projects/WorkspaceFileSearchService'
import { createProjectRuntimeServices } from './projects/projectRuntimeServices'
import { loadDesktopRuntimeConfig } from './runtimeConfig'
import { createMainWindowOptions } from './windowOptions'
import {
  codexChatRequestSchema,
  isExternalHttpUrl,
  codexOpenExternalHttpUrlPayloadSchema,
  projectCreateLocalPayloadSchema,
  projectSelectPayloadSchema,
  codexRespondApprovalPayloadSchema,
  codexSetSelectedModelPayloadSchema,
  workspaceFileSearchPayloadSchema
} from '../shared/codexIpcApi'

let codexRuntime: CodexChatRuntimeService | undefined
let projectApi: ProjectApiService | undefined
let workspaceFileSearch: WorkspaceFileSearchService | undefined

function createCodexRuntime(): CodexChatRuntimeService {
  const projectRuntimeServices = createProjectRuntimeServices({
    userDataPath: app.getPath('userData'),
    pickWorkspaceRoot: pickWorkspaceRootPath
  })
  projectApi = projectRuntimeServices.projectApi
  workspaceFileSearch = projectRuntimeServices.workspaceFileSearch

  return new CodexChatRuntimeService({
    modelCatalog: createModelCatalogService(loadDesktopRuntimeConfig(process.env)),
    projectService: projectRuntimeServices.projectService,
    projectStore: projectRuntimeServices.projectStore
  })
}

async function pickWorkspaceRootPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function openExternalHttpUrl(url: string): Promise<void> {
  if (!isExternalHttpUrl(url)) throw new Error('external URL must be http(s)')
  await shell.openExternal(url)
}

function requireProjectApi(): ProjectApiService {
  if (!projectApi) throw new Error('Project API is not initialized')
  return projectApi
}

function requireWorkspaceFileSearch(): WorkspaceFileSearchService {
  if (!workspaceFileSearch) throw new Error('Workspace file search is not initialized')
  return workspaceFileSearch
}

function broadcastStatus(): void {
  if (!codexRuntime) return
  const status = codexRuntime.getStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:status-change', status)
  }
}

async function broadcastProjectState(): Promise<void> {
  if (!projectApi) return
  const state = await projectApi.getState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:projects-state-change', state)
  }
}

function createWindow(runtime: CodexChatRuntimeService): void {
  const mainWindow = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      icon
    })
  )

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isExternalHttpUrl(details.url)) {
      void shell.openExternal(details.url).catch(() => console.error('failed to open external URL'))
    }
    return { action: 'deny' }
  })
  installWindowContextMenu(mainWindow, Menu)

  const unsubscribeApprovals = runtime.onApprovalRequest((request) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('codex:approval-request', request)
    }
  })
  mainWindow.on('closed', () => unsubscribeApprovals())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const runtime = createCodexRuntime()
  codexRuntime = runtime

  electronApp.setAppUserModelId('com.electron')
  nativeTheme.themeSource = 'system'

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.handle('codex:get-status', () => runtime.getStatus())
  ipcMain.handle('codex:list-models', () => runtime.listModels())
  ipcMain.handle('codex:set-selected-model', (_, payload: unknown) => {
    const request = codexSetSelectedModelPayloadSchema.parse(payload)
    return runtime.setSelectedModel(request.modelId)
  })
  ipcMain.handle('codex:respond-approval', (_, payload: unknown) => {
    const request = codexRespondApprovalPayloadSchema.parse(payload)
    runtime.respondApproval(request.requestId, request.response)
  })
  ipcMain.handle('codex:open-external-http-url', (_, payload: unknown) => {
    const request = codexOpenExternalHttpUrlPayloadSchema.parse(payload)
    return openExternalHttpUrl(request.url)
  })
  ipcMain.handle('codex:projects:get-state', () => requireProjectApi().getState())
  ipcMain.handle('codex:projects:pick-workspace-root', async () => {
    const option = await requireProjectApi().pickWorkspaceRoot()
    await broadcastProjectState()
    return option ?? null
  })
  ipcMain.handle('codex:projects:create-local', async (_, payload: unknown) => {
    const request = projectCreateLocalPayloadSchema.parse(payload)
    const project = await requireProjectApi().createLocalProject(request)
    await broadcastProjectState()
    return project
  })
  ipcMain.handle('codex:projects:select', async (_, payload: unknown) => {
    const request = projectSelectPayloadSchema.parse(payload)
    const state = await requireProjectApi().selectProject(request)
    await broadcastProjectState()
    return state
  })
  ipcMain.handle('codex:projects:create-fuzzy-file-search-session', (_, payload: unknown) => {
    const request = workspaceFileSearchPayloadSchema.parse(payload)
    return requireWorkspaceFileSearch().createFuzzyFileSearchSession(request)
  })
  ipcMain.on('codex-chat:start', (event, payload: unknown) => {
    const port = event.ports[0]
    if (!port) return
    const request = codexChatRequestSchema.parse(payload)
    void runtime.startChatStream(request, port).finally(broadcastStatus)
    broadcastStatus()
  })

  createWindow(runtime)
  broadcastStatus()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(runtime)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void codexRuntime?.stop()
})
