import {
  BrowserWindow,
  WebContentsView,
  type IpcMain,
  type IpcMainInvokeEvent,
  shell
} from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, sep } from 'node:path'

import {
  browserWorkspaceIpcChannels,
  browserWorkspaceCreateRequestSchema,
  browserWorkspaceListRequestSchema,
  browserWorkspaceNavigateRequestSchema,
  browserWorkspaceSetBoundsRequestSchema,
  browserWorkspaceViewRequestSchema
} from '../../shared/browserWorkspaceApi'
import {
  fileWorkspaceListDirectoryRequestSchema,
  fileWorkspaceEventSchema,
  fileWorkspaceRelativePathSchema,
  fileWorkspaceMetadataRequestSchema,
  fileWorkspaceReadFileRequestSchema,
  fileWorkspaceSearchRequestSchema,
  fileWorkspaceSearchSessionStartRequestSchema,
  fileWorkspaceSearchSessionStopRequestSchema,
  fileWorkspaceSearchSessionUpdateRequestSchema
} from '../../shared/fileWorkspaceApi'
import {
  rightWorkspaceIpcChannels,
  rightWorkspaceDisposeRequestSchema,
  rightWorkspacePrepareFileRootRequestSchema
} from '../../shared/rightWorkspaceApi'
import {
  terminalWorkspaceIpcChannels,
  terminalWorkspaceCreateRequestSchema,
  terminalWorkspaceKillRequestSchema,
  terminalWorkspaceListRequestSchema,
  terminalWorkspaceResizeRequestSchema,
  terminalWorkspaceWriteRequestSchema,
  type TerminalWorkspaceEvent
} from '../../shared/terminalWorkspaceApi'
import type { ProjectService } from '../projects/ProjectService'
import {
  BrowserWorkspaceService,
  type BrowserWorkspaceHostAdapter,
  type BrowserWorkspaceViewAdapter
} from './BrowserWorkspaceService'
import {
  FileWorkspaceService,
  type FileWorkspacePathSearchProviderLike
} from './FileWorkspaceService'
import {
  TerminalWorkspaceService,
  type SpawnTerminalAdapter,
  type TerminalProcessAdapter
} from './TerminalWorkspaceService'

type WorkspaceRoot = { path: string; label: string }

const requireNodeModule = createRequire(__filename)

type WindowWorkspaceServices = {
  window: BrowserWindow
  roots: Map<string, WorkspaceRoot>
  rootWatchers: Map<string, FSWatcher>
  files: FileWorkspaceService
  terminal: TerminalWorkspaceService
  browser: BrowserWorkspaceService
  dispose(): void
}

export type RightWorkspaceIpcRegistration = {
  attachWindow(window: BrowserWindow): void
  disposeWindow(webContentsId: number): void
  dispose(): void
}

export function registerRightWorkspaceIpc({
  ipcMain,
  projectService,
  fileSearchProvider,
  spawnTerminal = spawnNodePty
}: {
  ipcMain: IpcMain
  projectService: ProjectService
  fileSearchProvider: FileWorkspacePathSearchProviderLike
  spawnTerminal?: SpawnTerminalAdapter
}): RightWorkspaceIpcRegistration {
  const servicesByOwner = new Map<number, WindowWorkspaceServices>()

  const requireServices = (event: IpcMainInvokeEvent): WindowWorkspaceServices => {
    const services = servicesByOwner.get(event.sender.id)
    if (!services || services.window.isDestroyed())
      throw new Error('Right workspace is unavailable')
    return services
  }
  const requireOwnedRoot = (event: IpcMainInvokeEvent, rootId: string): WindowWorkspaceServices => {
    const services = requireServices(event)
    if (!services.roots.has(rootId)) throw new Error('Workspace root is unavailable')
    return services
  }

  ipcMain.handle(rightWorkspaceIpcChannels.prepareFileRoot, async (event, payload: unknown) => {
    const request = rightWorkspacePrepareFileRootRequestSchema.parse(payload)
    const services = requireServices(event)
    const resolved = await projectService.resolveExistingThreadTarget({
      conversationId: request.target.conversationId,
      threadId: request.target.threadId,
      allowActiveProjectFallback: true,
      allowActiveProjectFallbackForUnboundThread: true
    })
    if (!resolved?.cwd || resolved.hostId !== 'local') {
      throw new Error('This task does not have a local workspace available.')
    }
    const root = { path: resolved.cwd, label: basename(resolved.cwd) || resolved.cwd }
    await services.files.stopSearchSessionsForRoot(request.workspaceId)
    services.roots.set(request.workspaceId, root)
    watchWorkspaceRoot(services, request.workspaceId, root.path)
    return { rootId: request.workspaceId, label: root.label }
  })
  ipcMain.handle(rightWorkspaceIpcChannels.disposeWorkspace, async (event, payload: unknown) => {
    const request = rightWorkspaceDisposeRequestSchema.parse(payload)
    const services = requireServices(event)
    services.terminal.disposeWorkspace(request.workspaceId)
    services.browser.disposeWorkspace(request.workspaceId)
    await services.files.stopSearchSessionsForRoot(request.workspaceId)
    services.roots.delete(request.workspaceId)
    closeRootWatcher(services, request.workspaceId)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.listDirectory, (event, payload: unknown) => {
    const request = fileWorkspaceListDirectoryRequestSchema.parse(payload)
    return requireOwnedRoot(event, request.rootId).files.listDirectory(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.metadata, (event, payload: unknown) => {
    const request = fileWorkspaceMetadataRequestSchema.parse(payload)
    return requireOwnedRoot(event, request.rootId).files.metadata(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.readFile, (event, payload: unknown) => {
    const request = fileWorkspaceReadFileRequestSchema.parse(payload)
    return requireOwnedRoot(event, request.rootId).files.readFile(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.searchFiles, (event, payload: unknown) => {
    const request = fileWorkspaceSearchRequestSchema.parse(payload)
    return requireOwnedRoot(event, request.rootId).files.search(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.startFileSearch, (event, payload: unknown) => {
    const request = fileWorkspaceSearchSessionStartRequestSchema.parse(payload)
    const services = requireOwnedRoot(event, request.rootId)
    return services.files.startSearchSession(request, (searchEvent) => {
      if (!services.window.isDestroyed()) {
        services.window.webContents.send(rightWorkspaceIpcChannels.fileSearchEvent, searchEvent)
      }
    })
  })
  ipcMain.handle(rightWorkspaceIpcChannels.updateFileSearch, (event, payload: unknown) => {
    const request = fileWorkspaceSearchSessionUpdateRequestSchema.parse(payload)
    return requireServices(event).files.updateSearchSession(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.stopFileSearch, (event, payload: unknown) => {
    const request = fileWorkspaceSearchSessionStopRequestSchema.parse(payload)
    return requireServices(event).files.stopSearchSession(request)
  })
  ipcMain.handle(rightWorkspaceIpcChannels.openWithSystem, async (event, payload: unknown) => {
    const request = fileWorkspaceMetadataRequestSchema.parse(payload)
    const path = await requireOwnedRoot(event, request.rootId).files.resolveFileForSystemOpen(
      request
    )
    const error = await shell.openPath(path)
    if (error) throw new Error(`Unable to open workspace file: ${error}`)
  })

  ipcMain.handle(terminalWorkspaceIpcChannels.create, (event, payload: unknown) => {
    const request = terminalWorkspaceCreateRequestSchema.parse(payload)
    return requireOwnedRoot(event, request.workspaceId).terminal.create(request)
  })
  ipcMain.handle(terminalWorkspaceIpcChannels.write, (event, payload: unknown) => {
    const request = terminalWorkspaceWriteRequestSchema.parse(payload)
    return requireServices(event).terminal.write(request)
  })
  ipcMain.handle(terminalWorkspaceIpcChannels.resize, (event, payload: unknown) => {
    const request = terminalWorkspaceResizeRequestSchema.parse(payload)
    return requireServices(event).terminal.resize(request)
  })
  ipcMain.handle(terminalWorkspaceIpcChannels.kill, (event, payload: unknown) => {
    const request = terminalWorkspaceKillRequestSchema.parse(payload)
    return requireServices(event).terminal.kill(request)
  })
  ipcMain.handle(terminalWorkspaceIpcChannels.list, (event, payload: unknown) => {
    const request = terminalWorkspaceListRequestSchema.parse(payload)
    return requireServices(event).terminal.list(request)
  })

  ipcMain.handle(browserWorkspaceIpcChannels.create, (event, payload: unknown) => {
    const request = browserWorkspaceCreateRequestSchema.parse(payload)
    return requireServices(event).browser.create(request)
  })
  ipcMain.handle(browserWorkspaceIpcChannels.navigate, (event, payload: unknown) => {
    const request = browserWorkspaceNavigateRequestSchema.parse(payload)
    return requireServices(event).browser.navigate(request)
  })
  ipcMain.handle(browserWorkspaceIpcChannels.setBounds, (event, payload: unknown) => {
    const request = browserWorkspaceSetBoundsRequestSchema.parse(payload)
    return requireServices(event).browser.setBounds(request)
  })
  ipcMain.handle(browserWorkspaceIpcChannels.goBack, (event, payload: unknown) => {
    return requireServices(event).browser.goBack(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.goForward, (event, payload: unknown) => {
    return requireServices(event).browser.goForward(
      browserWorkspaceViewRequestSchema.parse(payload)
    )
  })
  ipcMain.handle(browserWorkspaceIpcChannels.reload, (event, payload: unknown) => {
    return requireServices(event).browser.reload(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.stop, (event, payload: unknown) => {
    return requireServices(event).browser.stop(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.show, (event, payload: unknown) => {
    return requireServices(event).browser.show(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.hide, (event, payload: unknown) => {
    return requireServices(event).browser.hide(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.destroy, (event, payload: unknown) => {
    return requireServices(event).browser.destroy(browserWorkspaceViewRequestSchema.parse(payload))
  })
  ipcMain.handle(browserWorkspaceIpcChannels.list, (event, payload: unknown) => {
    return requireServices(event).browser.list(browserWorkspaceListRequestSchema.parse(payload))
  })

  return {
    attachWindow(window) {
      const ownerId = window.webContents.id
      const existing = servicesByOwner.get(ownerId)
      existing?.dispose()
      servicesByOwner.set(ownerId, createWindowServices(window, fileSearchProvider, spawnTerminal))
    },
    disposeWindow(webContentsId) {
      const services = servicesByOwner.get(webContentsId)
      if (!services) return
      services.dispose()
      servicesByOwner.delete(webContentsId)
    },
    dispose() {
      for (const [ownerId, services] of servicesByOwner) {
        services.dispose()
        servicesByOwner.delete(ownerId)
      }
      for (const channel of Object.values({
        ...rightWorkspaceIpcChannels,
        ...terminalWorkspaceIpcChannels,
        ...browserWorkspaceIpcChannels
      })) {
        ipcMain.removeHandler(channel)
      }
    }
  }
}

function createWindowServices(
  window: BrowserWindow,
  fileSearchProvider: FileWorkspacePathSearchProviderLike,
  spawnTerminal: SpawnTerminalAdapter
): WindowWorkspaceServices {
  const roots = new Map<string, WorkspaceRoot>()
  const rootWatchers = new Map<string, FSWatcher>()
  const files = new FileWorkspaceService({
    resolveRoot: async (rootId) => roots.get(rootId)?.path ?? null,
    pathSearch: fileSearchProvider
  })
  const terminal = new TerminalWorkspaceService({
    spawnTerminal,
    resolveStartOptions: (workspaceId) => {
      const root = roots.get(workspaceId)
      if (!root) throw new Error('Workspace root is unavailable')
      return terminalStartOptions(root.path)
    }
  })
  const browser = new BrowserWorkspaceService({ host: createBrowserHost(window) })

  const sendTerminalEvent = (event: TerminalWorkspaceEvent): void => {
    if (!window.isDestroyed()) window.webContents.send(terminalWorkspaceIpcChannels.event, event)
  }
  const removeTerminalListener = terminal.onEvent(sendTerminalEvent)
  const removeBrowserListener = browser.onEvent((event) => {
    if (!window.isDestroyed()) window.webContents.send(browserWorkspaceIpcChannels.event, event)
  })

  return {
    window,
    roots,
    rootWatchers,
    files,
    terminal,
    browser,
    dispose() {
      removeTerminalListener()
      removeBrowserListener()
      terminal.dispose()
      browser.dispose()
      void files.dispose()
      for (const watcher of rootWatchers.values()) watcher.close()
      rootWatchers.clear()
      roots.clear()
    }
  }
}

function watchWorkspaceRoot(
  services: WindowWorkspaceServices,
  rootId: string,
  rootPath: string
): void {
  closeRootWatcher(services, rootId)
  let pendingPaths = new Set<string | undefined>()
  let debounceTimer: NodeJS.Timeout | undefined
  const flush = (): void => {
    debounceTimer = undefined
    const paths = pendingPaths
    pendingPaths = new Set()
    for (const path of paths) {
      const event = fileWorkspaceEventSchema.parse({
        version: 1,
        type: 'changed',
        rootId,
        ...(path ? { path } : {})
      })
      if (!services.window.isDestroyed()) {
        services.window.webContents.send(rightWorkspaceIpcChannels.fileEvent, event)
      }
    }
  }
  const schedule = (filename: string | Buffer | null): void => {
    pendingPaths.add(toWorkspaceRelativePath(filename))
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, 120)
  }
  try {
    const watcher = watch(rootPath, { recursive: true }, (_event, filename) => schedule(filename))
    watcher.on('error', () => schedule(null))
    services.rootWatchers.set(rootId, watcher)
  } catch {
    const watcher = watch(rootPath, (_event, filename) => schedule(filename))
    watcher.on('error', () => schedule(null))
    services.rootWatchers.set(rootId, watcher)
  }
}

function closeRootWatcher(services: WindowWorkspaceServices, rootId: string): void {
  services.rootWatchers.get(rootId)?.close()
  services.rootWatchers.delete(rootId)
}

function toWorkspaceRelativePath(filename: string | Buffer | null): string | undefined {
  if (!filename) return undefined
  const value = filename.toString().split(sep).join('/')
  return fileWorkspaceRelativePathSchema.safeParse(value).success ? value : undefined
}

function terminalStartOptions(cwd: string): {
  shell: string
  args: string[]
  cwd: string
  env: Record<string, string>
} {
  const shell =
    process.platform === 'win32'
      ? (process.env.ComSpec ?? 'cmd.exe')
      : (process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'))
  const env = pickTerminalEnvironment(process.env)
  return {
    shell,
    args: process.platform === 'win32' ? [] : ['-l'],
    cwd,
    env: { ...env, TERM: 'xterm-256color' }
  }
}

function pickTerminalEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = [
    'HOME',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TERM_PROGRAM',
    'TMPDIR',
    'USER'
  ]
  return Object.fromEntries(
    allowed.flatMap((key) => (environment[key] ? [[key, environment[key]!]] : []))
  )
}

function spawnNodePty(input: {
  shell?: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  cols: number
  rows: number
}): TerminalProcessAdapter {
  let pty: {
    spawn(
      file: string,
      args: string[],
      options: {
        cwd?: string
        env?: Record<string, string>
        cols: number
        rows: number
        name: string
      }
    ): {
      write(data: string): void
      resize(cols: number, rows: number): void
      kill(): void
      onData(listener: (data: string) => void): void
      onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
    }
  }
  try {
    // node-pty is intentionally loaded in the main process only. Electron-builder packages this native module.
    pty = requireNodeModule('node-pty') as typeof pty
  } catch (error) {
    throw new Error(
      `Terminal support is unavailable because node-pty could not be loaded: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const process = pty.spawn(input.shell ?? '/bin/sh', input.args, {
    cwd: input.cwd,
    env: input.env,
    cols: input.cols,
    rows: input.rows,
    name: 'xterm-256color'
  })
  return {
    write: (data) => process.write(data),
    resize: (cols, rows) => process.resize(cols, rows),
    kill: () => process.kill(),
    onData: (listener) => process.onData(listener),
    onExit: (listener) =>
      process.onExit((event) => listener(event.exitCode, event.signal?.toString() ?? null))
  }
}

function createBrowserHost(window: BrowserWindow): BrowserWorkspaceHostAdapter {
  const nativeViews = new WeakMap<BrowserWorkspaceViewAdapter, WebContentsView>()
  return {
    createView: ({
      bounds
    }: {
      viewId: string
      bounds: { x: number; y: number; width: number; height: number }
    }) => {
      const nativeView = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          partition: `right-workspace-${window.webContents.id}-${crypto.randomUUID()}`
        }
      })
      nativeView.setBounds(bounds)
      nativeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      nativeView.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedBrowserUrl(url)) event.preventDefault()
      })
      nativeView.webContents.on('will-redirect', (event, url) => {
        if (!isAllowedBrowserUrl(url)) event.preventDefault()
      })
      nativeView.webContents.session.on('will-download', (event) => event.preventDefault())
      nativeView.webContents.on(
        'certificate-error',
        (event, _url, _error, _certificate, callback) => {
          event.preventDefault()
          callback(false)
        }
      )
      nativeView.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false)
      )
      nativeView.webContents.session.setPermissionCheckHandler(() => false)
      const adapter: BrowserWorkspaceViewAdapter = {
        loadURL: (url: string) => nativeView.webContents.loadURL(url),
        setBounds: (nextBounds: { x: number; y: number; width: number; height: number }) =>
          nativeView.setBounds(nextBounds),
        goBack: () => nativeView.webContents.navigationHistory.goBack(),
        goForward: () => nativeView.webContents.navigationHistory.goForward(),
        reload: () => nativeView.webContents.reload(),
        stop: () => nativeView.webContents.stop(),
        destroy: () => nativeView.webContents.close(),
        canGoBack: () => nativeView.webContents.navigationHistory.canGoBack(),
        canGoForward: () => nativeView.webContents.navigationHistory.canGoForward(),
        getTitle: () => nativeView.webContents.getTitle(),
        onDidStartLoading: (listener: () => void) =>
          nativeView.webContents.on('did-start-loading', listener),
        onDidFinishLoad: (listener: () => void) =>
          nativeView.webContents.on('did-finish-load', listener),
        onDidFailLoad: (listener: (error?: string) => void) =>
          nativeView.webContents.on('did-fail-load', (_event, errorCode, errorDescription) =>
            listener(`${errorDescription} (${errorCode})`)
          ),
        onFaviconUpdated: (listener: (faviconUrls: string[]) => void) =>
          nativeView.webContents.on('page-favicon-updated', (_event, faviconUrls) =>
            listener(faviconUrls)
          )
      }
      nativeViews.set(adapter, nativeView)
      return adapter
    },
    attachView: (view: BrowserWorkspaceViewAdapter) => {
      const nativeView = nativeViews.get(view)
      if (!nativeView) throw new Error('Browser view is unavailable')
      window.contentView.addChildView(nativeView)
    },
    detachView: (view: BrowserWorkspaceViewAdapter) => {
      const nativeView = nativeViews.get(view)
      if (!nativeView) return
      window.contentView.removeChildView(nativeView)
    },
    openExternal: (url: string) => shell.openExternal(url)
  }
}

function isAllowedBrowserUrl(value: string): boolean {
  if (value === 'about:blank') return true
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
