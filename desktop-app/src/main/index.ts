import { app, shell, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CodexChatRuntimeService } from './codexChatRuntimeService'
import { resolveCodexAppServerLaunchOptions } from './codexAppServerLaunch'
import { AppServerThreadClient } from './conversations/AppServerThreadClient'
import { ConversationApiService } from './conversations/ConversationApiService'
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
  projectCreateRemotePayloadSchema,
  projectRenamePayloadSchema,
  projectSelectPayloadSchema,
  codexRespondApprovalPayloadSchema,
  codexSetSelectedModelPayloadSchema,
  sidebarConversationActionPayloadSchema,
  sidebarConversationRenamePayloadSchema,
  sidebarPreferencesPatchSchema,
  workspaceFileSearchPayloadSchema
} from '../shared/codexIpcApi'

let codexRuntime: CodexChatRuntimeService | undefined
let projectApi: ProjectApiService | undefined
let workspaceFileSearch: WorkspaceFileSearchService | undefined
let conversationApi: ConversationApiService | undefined

function createCodexRuntime(): CodexChatRuntimeService {
  const projectRuntimeServices = createProjectRuntimeServices({
    userDataPath: app.getPath('userData'),
    pickWorkspaceRoot: pickWorkspaceRootPath
  })
  projectApi = projectRuntimeServices.projectApi
  workspaceFileSearch = projectRuntimeServices.workspaceFileSearch
  const launch = resolveCodexAppServerLaunchOptions({
    env: process.env,
    isPackaged: app.isPackaged,
    mainDir: __dirname,
    resourcesPath: process.resourcesPath
  })
  conversationApi = new ConversationApiService({
    threadClient: new AppServerThreadClient({ launch }),
    projectStore: projectRuntimeServices.projectStore
  })

  return new CodexChatRuntimeService({
    launch,
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

function requireConversationApi(): ConversationApiService {
  if (!conversationApi) throw new Error('Conversation API is not initialized')
  return conversationApi
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

async function broadcastConversationState(options: { awaitThreadId?: string } = {}): Promise<void> {
  if (!conversationApi) return
  const state = await refreshConversationListForBroadcast(options.awaitThreadId)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:conversations-state-change', state)
  }
}

async function refreshConversationListForBroadcast(
  awaitThreadId?: string
): Promise<Awaited<ReturnType<ConversationApiService['refreshConversationList']>>> {
  if (!conversationApi) throw new Error('Conversation API is not initialized')

  const maxAttempts = awaitThreadId ? 8 : 1
  let state = await conversationApi.refreshConversationList({
    ensureThreadIds: awaitThreadId ? [awaitThreadId] : []
  })
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    if (!awaitThreadId || hasConversationThread(state, awaitThreadId)) return state
    await delay(150 * attempt)
    state = await conversationApi.refreshConversationList({ ensureThreadIds: [awaitThreadId] })
  }
  return state
}

function hasConversationThread(
  state: Awaited<ReturnType<ConversationApiService['refreshConversationList']>>,
  threadId: string
): boolean {
  return state.conversations.some(
    (conversation) => conversation.id === threadId || conversation.threadId === threadId
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  ipcMain.handle('codex:projects:create-remote', async (_, payload: unknown) => {
    const request = projectCreateRemotePayloadSchema.parse(payload)
    const project = await requireProjectApi().createRemoteProject(request)
    await broadcastProjectState()
    return project
  })
  ipcMain.handle('codex:projects:select', async (_, payload: unknown) => {
    const request = projectSelectPayloadSchema.parse(payload)
    const state = await requireProjectApi().selectProject(request)
    await broadcastProjectState()
    return state
  })
  ipcMain.handle('codex:projects:remove', async (_, payload: unknown) => {
    const request = projectSelectPayloadSchema.parse(payload)
    const state = await requireProjectApi().removeProject(request)
    await broadcastProjectState()
    return state
  })
  ipcMain.handle('codex:projects:rename', async (_, payload: unknown) => {
    const request = projectRenamePayloadSchema.parse(payload)
    const state = await requireProjectApi().renameProject(request)
    await broadcastProjectState()
    return state
  })
  ipcMain.handle('codex:projects:create-fuzzy-file-search-session', (_, payload: unknown) => {
    const request = workspaceFileSearchPayloadSchema.parse(payload)
    return requireWorkspaceFileSearch().createFuzzyFileSearchSession(request)
  })
  ipcMain.handle('codex:conversations:get-list', () =>
    requireConversationApi().getConversationList()
  )
  ipcMain.handle('codex:conversations:refresh-list', async () => {
    const state = await requireConversationApi().refreshConversationList()
    await broadcastConversationState()
    return state
  })
  ipcMain.handle('codex:conversations:open', (_, payload: unknown) => {
    const request = sidebarConversationActionPayloadSchema.parse(payload)
    return requireConversationApi().openConversation(request)
  })
  ipcMain.handle('codex:conversations:archive', async (_, payload: unknown) => {
    const request = sidebarConversationActionPayloadSchema.parse(payload)
    const state = await requireConversationApi().archiveConversation(request)
    await broadcastConversationState()
    return state
  })
  ipcMain.handle('codex:conversations:unarchive', async (_, payload: unknown) => {
    const request = sidebarConversationActionPayloadSchema.parse(payload)
    const state = await requireConversationApi().unarchiveConversation(request)
    await broadcastConversationState()
    return state
  })
  ipcMain.handle('codex:conversations:rename', async (_, payload: unknown) => {
    const request = sidebarConversationRenamePayloadSchema.parse(payload)
    const state = await requireConversationApi().renameConversation(request)
    await broadcastConversationState()
    return state
  })
  ipcMain.handle('codex:conversations:interrupt', (_, payload: unknown) => {
    const request = sidebarConversationActionPayloadSchema.parse(payload)
    return runtime.interruptConversation(request.conversationId)
  })
  ipcMain.handle('codex:conversations:get-preferences', () =>
    requireConversationApi().getPreferences()
  )
  ipcMain.handle('codex:conversations:set-preferences', (_, payload: unknown) => {
    const request = sidebarPreferencesPatchSchema.parse(payload)
    return requireConversationApi().setPreferences(request)
  })
  ipcMain.on('codex-chat:start', (event, payload: unknown) => {
    const port = event.ports[0]
    if (!port) return
    const request = codexChatRequestSchema.parse(payload)
    void runtime
      .startChatStream(request, port, {
        onThreadIdAvailable: (threadId) => {
          void broadcastConversationState({ awaitThreadId: threadId })
        }
      })
      .then((result) => broadcastConversationState({ awaitThreadId: result.threadId }))
      .catch((error: unknown) => {
        console.error('failed to complete codex chat stream', error)
      })
      .finally(() => {
        broadcastStatus()
      })
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
