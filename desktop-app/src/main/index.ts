import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session
} from 'electron'
import { stat } from 'node:fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  createCodexContextCatalogClient,
  type CodexContextCatalogClient
} from '@janole/ai-sdk-provider-codex-asp'
import icon from '../../resources/icon.png?asset'
import { CodexChatRuntimeService } from './codexChatRuntimeService'
import { resolveCodexAppServerLaunchOptions } from './codexAppServerLaunch'
import { AppServerThreadClient } from './conversations/AppServerThreadClient'
import {
  ConversationApiService,
  type ObservedStartedThread
} from './conversations/ConversationApiService'
import { installWindowContextMenu } from './contextMenu'
import { createPickLocalContextHandler } from './localContextPicker'
import { createOpenLocalPathHandler } from './localPathOpen'
import {
  createAppRendererUrl,
  registerAppProtocol,
  registerAppSchemePrivileges
} from './localMediaProtocol'
import { createModelCatalogService } from './modelCatalogService'
import { ComposerContextCatalogService } from './composerContext/ComposerContextCatalogService'
import { ComposerContextChangeBroker } from './composerContext/ComposerContextChangeBroker'
import {
  createListComposerContextHandler,
  createRefreshComposerContextHandler
} from './composerContext/composerContextIpc'
import { LiveAgentRegistry } from './composerContext/LiveAgentRegistry'
import { createValidateLocalAttachmentsHandler } from './composerContext/localAttachmentValidation'
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
  type ComposerContextCatalogChangeEvent,
  sidebarConversationActionPayloadSchema,
  sidebarConversationRenamePayloadSchema,
  sidebarPreferencesPatchSchema,
  workspaceFileSearchPayloadSchema
} from '../shared/codexIpcApi'

let codexRuntime: CodexChatRuntimeService | undefined
let projectApi: ProjectApiService | undefined
let workspaceFileSearch: WorkspaceFileSearchService | undefined
let conversationApi: ConversationApiService | undefined
let composerContextCatalog: ComposerContextCatalogService | undefined
let composerContextChanges: ComposerContextChangeBroker | undefined
let composerContextClient: CodexContextCatalogClient | undefined
const convergingConversationThreadIds = new Set<string>()

const e2eUserDataPath = process.env.DASCOWORK_E2E_USER_DATA_DIR?.trim()
if (e2eUserDataPath) app.setPath('userData', e2eUserDataPath)
registerAppSchemePrivileges(protocol)

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
  const threadClient = new AppServerThreadClient({ launch })
  conversationApi = new ConversationApiService({
    threadClient,
    projectStore: projectRuntimeServices.projectStore
  })
  const liveAgents = new LiveAgentRegistry(threadClient)
  composerContextClient = createCodexContextCatalogClient({
    clientInfo: {
      name: 'dascowork_desktop_composer_context',
      title: 'dasCowork Desktop Composer Context',
      version: '1.0.0'
    },
    experimentalApi: true,
    transport: {
      type: 'stdio',
      stdio: {
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.env
      }
    }
  })
  composerContextCatalog = new ComposerContextCatalogService({
    provider: composerContextClient,
    conversations: conversationApi,
    workspaceSearch: projectRuntimeServices.workspaceFileSearch,
    liveAgents,
    defaultCwd: app.getAppPath()
  })
  composerContextChanges?.dispose()
  composerContextChanges = new ComposerContextChangeBroker({
    publish: broadcastComposerContextChange
  })

  return new CodexChatRuntimeService({
    launch,
    modelCatalog: createModelCatalogService(loadDesktopRuntimeConfig(process.env)),
    projectService: projectRuntimeServices.projectService,
    projectStore: projectRuntimeServices.projectStore,
    onAgentLifecycle: (event) => {
      liveAgents.observe(event)
      composerContextChanges?.notify({
        sectionIds: ['agents'],
        scope: { threadId: event.threadId }
      })
    }
  })
}

async function pickWorkspaceRootPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function chooseLocalContextPickerKind(): Promise<'files' | 'folders' | null> {
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '选择文件文件夹',
    message: '请选择要添加的内容',
    buttons: ['选择文件', '选择文件夹', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })

  if (result.response === 0) return 'files'
  if (result.response === 1) return 'folders'
  return null
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

function requireComposerContextCatalog(): ComposerContextCatalogService {
  if (!composerContextCatalog) throw new Error('Composer context catalog is not initialized')
  return composerContextCatalog
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
  const conversationState = conversationApi?.applyProjectState(state)
  if (conversationState?.loaded) sendConversationState(conversationState)
}

function broadcastComposerContextChange(event: ComposerContextCatalogChangeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:composer-context-change', event)
  }
}

async function broadcastConversationState(
  options: {
    awaitThreadId?: string
    discardStartedObservationOnConvergenceFailure?: boolean
  } = {}
): Promise<void> {
  if (!conversationApi) return
  if (options.awaitThreadId) {
    // Immediately broadcast with ensure so the sidebar shows the thread right away,
    // even if thread/list hasn't caught up yet.
    const ensuredState = await conversationApi.refreshConversationList({
      ensureThreadIds: [options.awaitThreadId]
    })
    sendConversationState(ensuredState)
    // In the background, wait for thread/list to converge (include the thread
    // naturally), then broadcast the converged state.
    startConversationListConvergence(options.awaitThreadId, {
      discardStartedObservationOnFailure:
        options.discardStartedObservationOnConvergenceFailure ?? false
    })
  } else {
    const state = await conversationApi.refreshConversationList()
    sendConversationState(state)
  }
}

function broadcastStartedConversation(threadId: string, thread: ObservedStartedThread): void {
  if (!conversationApi) return
  const api = conversationApi
  sendConversationState(api.observeStartedThreadSnapshot(thread))
  void api
    .observeStartedThread(thread)
    .then(sendConversationState)
    .catch((error: unknown) => {
      console.error(`failed to publish started thread ${threadId}`, error)
      void broadcastConversationState({ awaitThreadId: threadId })
    })
  startConversationListConvergence(threadId, { discardStartedObservationOnFailure: false })
}

function sendConversationState(
  state: Awaited<ReturnType<ConversationApiService['refreshConversationList']>>
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('codex:conversations-state-change', state)
  }
  composerContextChanges?.notify({ sectionIds: ['chats'] })
}

function startConversationListConvergence(
  threadId: string,
  options: { discardStartedObservationOnFailure: boolean }
): void {
  if (convergingConversationThreadIds.has(threadId)) return
  convergingConversationThreadIds.add(threadId)
  void convergeConversationList(threadId, options)
    .catch((error: unknown) => {
      console.error(`failed to converge thread/list for ${threadId}`, error)
    })
    .finally(() => {
      convergingConversationThreadIds.delete(threadId)
    })
}

async function convergeConversationList(
  awaitThreadId: string,
  options: { discardStartedObservationOnFailure: boolean }
): Promise<void> {
  if (!conversationApi) return
  const maxAttempts = 8
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await delay(150 * attempt)
    if (await conversationApi.hasThreadInList(awaitThreadId)) {
      const state = await conversationApi.refreshConversationList()
      sendConversationState(state)
      return
    }
  }
  console.warn(`thread/list did not include ${awaitThreadId} after ${maxAttempts} attempts`)
  if (!options.discardStartedObservationOnFailure) return
  const state = await conversationApi.discardStartedThreadObservation(awaitThreadId)
  sendConversationState(state)
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
    mainWindow.loadURL(createAppRendererUrl())
  }
}

app.whenReady().then(() => {
  registerAppProtocol({
    protocol,
    session: session.defaultSession,
    rendererRoot: join(__dirname, '../renderer'),
    devRendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
    netFetch: (url, init) => net.fetch(url, init),
    logger: console
  })
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
  ipcMain.handle(
    'codex:open-local-path',
    createOpenLocalPathHandler((path) => shell.openPath(path))
  )
  ipcMain.handle(
    'codex:pick-local-context',
    createPickLocalContextHandler({
      choosePickerKind: process.platform === 'darwin' ? undefined : chooseLocalContextPickerKind,
      showOpenDialog: (options) => dialog.showOpenDialog(options),
      stat
    })
  )
  ipcMain.handle(
    'codex:composer-context:list',
    createListComposerContextHandler(requireComposerContextCatalog())
  )
  ipcMain.handle(
    'codex:composer-context:refresh',
    createRefreshComposerContextHandler(requireComposerContextCatalog())
  )
  ipcMain.handle(
    'codex:composer-context:validate-local-attachments',
    createValidateLocalAttachmentsHandler({ stat })
  )
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
        onThreadIdAvailable: (threadId, thread) => {
          if (thread) {
            broadcastStartedConversation(threadId, thread)
            return
          }
          void broadcastConversationState({ awaitThreadId: threadId })
        }
      })
      .then((result) =>
        broadcastConversationState({
          awaitThreadId: result.threadId,
          discardStartedObservationOnConvergenceFailure: true
        })
      )
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
  composerContextChanges?.dispose()
  void codexRuntime?.stop()
  void composerContextClient?.shutdown()
})
