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
  DesktopConversationsApi,
  DesktopProjectsApi,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarPreferences,
  WorkspaceFileSearchPayload,
  WorkspaceFileSearchResponse
} from '../shared/codexIpcApi'
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
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
        callbacks.onFinish(message.threadId)
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
  createRemoteProject: (input) =>
    ipcRenderer.invoke('codex:projects:create-remote', input) as Promise<RemoteProject>,
  selectProject: (input: ProjectSelection) =>
    ipcRenderer.invoke('codex:projects:select', input) as Promise<ProjectState>,
  removeProject: (input: ProjectSelection) =>
    ipcRenderer.invoke('codex:projects:remove', input) as Promise<ProjectState>,
  renameProject: (input) =>
    ipcRenderer.invoke('codex:projects:rename', input) as Promise<ProjectState>,
  createFuzzyFileSearchSession: (input: WorkspaceFileSearchPayload) =>
    ipcRenderer.invoke(
      'codex:projects:create-fuzzy-file-search-session',
      input
    ) as Promise<WorkspaceFileSearchResponse>,
  onStateChange: (callback: (state: ProjectState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ProjectState): void =>
      callback(state)
    ipcRenderer.on('codex:projects-state-change', listener)
    return () => ipcRenderer.removeListener('codex:projects-state-change', listener)
  }
}

const desktopConversations: DesktopConversationsApi = {
  getConversationList: () =>
    ipcRenderer.invoke('codex:conversations:get-list') as Promise<SidebarConversationListState>,
  refreshConversationList: () =>
    ipcRenderer.invoke('codex:conversations:refresh-list') as Promise<SidebarConversationListState>,
  openConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:open', input) as Promise<SidebarConversationOpenResult>,
  archiveConversation: (input) =>
    ipcRenderer.invoke(
      'codex:conversations:archive',
      input
    ) as Promise<SidebarConversationListState>,
  unarchiveConversation: (input) =>
    ipcRenderer.invoke(
      'codex:conversations:unarchive',
      input
    ) as Promise<SidebarConversationListState>,
  renameConversation: (input) =>
    ipcRenderer.invoke(
      'codex:conversations:rename',
      input
    ) as Promise<SidebarConversationListState>,
  interruptConversation: (input) =>
    ipcRenderer.invoke('codex:conversations:interrupt', input) as Promise<void>,
  getPreferences: () =>
    ipcRenderer.invoke('codex:conversations:get-preferences') as Promise<SidebarPreferences>,
  setPreferences: (input) =>
    ipcRenderer.invoke('codex:conversations:set-preferences', input) as Promise<SidebarPreferences>,
  onConversationListChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: SidebarConversationListState
    ): void => callback(state)
    ipcRenderer.on('codex:conversations-state-change', listener)
    return () => ipcRenderer.removeListener('codex:conversations-state-change', listener)
  }
}

const desktopApp = {
  electron: electronAPI,
  codex: desktopCodex,
  chat: desktopCodexChat,
  projects: desktopProjects,
  conversations: desktopConversations
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('desktopApp', desktopApp)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as typeof window & { desktopApp: typeof desktopApp }).desktopApp = desktopApp
}
