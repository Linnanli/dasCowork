import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexChatRequest,
  CodexChatStreamCallbacks,
  CodexChatStreamEvent,
  CodexModelList,
  CodexStatus,
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  WorkspaceRootOption
} from '../shared/projects/projectTypes'

const activePorts = new Map<string, MessagePort>()

const desktopCodex: DesktopCodexApi = {
  getStatus: () => ipcRenderer.invoke('codex:get-status') as Promise<CodexStatus>,
  listModels: () => ipcRenderer.invoke('codex:list-models') as Promise<CodexModelList>,
  setSelectedModel: (modelId: string) =>
    ipcRenderer.invoke('codex:set-selected-model', { modelId }) as Promise<{
      selectedModelId: string
    }>,
  respondApproval: (requestId: string, response: CodexApprovalResponse) =>
    ipcRenderer.invoke('codex:respond-approval', { requestId, response }) as Promise<void>,
  openExternalHttpUrl: (url: string) =>
    ipcRenderer.invoke('codex:open-external-http-url', { url }) as Promise<void>,
  onStatusChange: (callback: (status: CodexStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CodexStatus): void =>
      callback(status)
    ipcRenderer.on('codex:status-change', listener)
    return () => ipcRenderer.removeListener('codex:status-change', listener)
  },
  onApprovalRequest: (callback: (request: CodexApprovalRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: CodexApprovalRequest): void =>
      callback(request)
    ipcRenderer.on('codex:approval-request', listener)
    return () => ipcRenderer.removeListener('codex:approval-request', listener)
  }
}

const desktopCodexChat: DesktopCodexChatApi = {
  startChatStream: (request: CodexChatRequest, callbacks: CodexChatStreamCallbacks) => {
    const streamId = crypto.randomUUID()
    const channel = new MessageChannel()
    activePorts.set(streamId, channel.port1)
    channel.port1.onmessage = (event: MessageEvent<CodexChatStreamEvent>) => {
      const message = event.data
      if (message.type === 'chunk') callbacks.onChunk(message.chunk)
      if (message.type === 'finish') {
        callbacks.onFinish()
        activePorts.delete(streamId)
        channel.port1.close()
      }
      if (message.type === 'aborted') {
        callbacks.onAbort()
        activePorts.delete(streamId)
        channel.port1.close()
      }
      if (message.type === 'error') {
        callbacks.onError(message.error)
        activePorts.delete(streamId)
        channel.port1.close()
      }
    }
    ipcRenderer.postMessage('codex-chat:start', request, [channel.port2])
    return streamId
  },
  abortChatStream: (streamId: string) => {
    const port = activePorts.get(streamId)
    if (!port) return
    port.postMessage({ type: 'abort' })
  }
}

const desktopProjects: DesktopProjectsApi = {
  getState: () => ipcRenderer.invoke('codex:projects:get-state') as Promise<ProjectState>,
  pickWorkspaceRoot: () =>
    ipcRenderer.invoke('codex:projects:pick-workspace-root') as Promise<WorkspaceRootOption | null>,
  createLocalProject: (input) =>
    ipcRenderer.invoke('codex:projects:create-local', input) as Promise<LocalProject>,
  selectProject: (input: ProjectSelection) =>
    ipcRenderer.invoke('codex:projects:select', input) as Promise<ProjectState>,
  onStateChange: (callback: (state: ProjectState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ProjectState): void =>
      callback(state)
    ipcRenderer.on('codex:projects-state-change', listener)
    return () => ipcRenderer.removeListener('codex:projects-state-change', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('desktopCodex', desktopCodex)
    contextBridge.exposeInMainWorld('desktopCodexChat', desktopCodexChat)
    contextBridge.exposeInMainWorld('desktopProjects', desktopProjects)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.desktopCodex = desktopCodex
  // @ts-ignore (define in dts)
  window.desktopCodexChat = desktopCodexChat
  // @ts-ignore (define in dts)
  window.desktopProjects = desktopProjects
}
