import { contextBridge, ipcRenderer } from 'electron'
import { codexChatTerminalFallbackSchema } from '../shared/codexIpcApi'
import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexChatRequest,
  CodexModelList,
  CodexStatus,
  DesktopCodexApi,
  DesktopCodexFollowUpApi,
  DesktopComposerContextApi,
  DesktopConversationsApi,
  DesktopProjectsApi,
  LocalContextPickerKind,
  LocalContextReference,
  FollowUpQueueChangeEvent,
  ProjectCreateBlankResult,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarPreferences
} from '../shared/codexIpcApi'
import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  WorkspaceRootOption
} from '../shared/projects/projectTypes'
import { createChatStreamBridge } from './chatStreamBridge'
import { createComposerContextBridge } from './composerContextBridge'
import { assertFollowUpSnapshotFitsIpc } from './followUpPayloadGuard'

const desktopEnvironment = {
  platform: process.platform
}

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
  openLocalPath: (input) => ipcRenderer.invoke('codex:open-local-path', input) as Promise<void>,
  pickLocalContext: (kind: LocalContextPickerKind) =>
    ipcRenderer.invoke('codex:pick-local-context', { kind }) as Promise<LocalContextReference[]>,
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
  },
  onApprovalSettled: (callback: (requestId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: unknown): void => {
      if (typeof requestId === 'string' && requestId.length > 0) callback(requestId)
    }
    ipcRenderer.on('codex:approval-settled', listener)
    return () => ipcRenderer.removeListener('codex:approval-settled', listener)
  }
}

const desktopCodexChat = createChatStreamBridge({
  createStreamId: () => crypto.randomUUID(),
  createMessageChannel: () => new MessageChannel(),
  postStart: (request: CodexChatRequest, streamId: string, port: MessagePort) => {
    ipcRenderer.postMessage('codex-chat:start', { streamId, request }, [port])
  },
  postDetached: (streamId, request) => {
    ipcRenderer.send('codex-chat:port-detached', { streamId, chatId: request.chatId })
  },
  subscribeTerminal: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = codexChatTerminalFallbackSchema.safeParse(payload, { jitless: true })
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on('codex-chat:terminal', listener)
    return () => ipcRenderer.removeListener('codex-chat:terminal', listener)
  }
})

window.addEventListener('beforeunload', () => {
  desktopCodexChat.detachActiveStreams()
})

const desktopComposerContext: DesktopComposerContextApi = createComposerContextBridge(
  (channel, payload) => ipcRenderer.invoke(channel, payload),
  (channel, callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
)

const desktopProjects: DesktopProjectsApi = {
  getState: () => ipcRenderer.invoke('codex:projects:get-state') as Promise<ProjectState>,
  pickWorkspaceRoot: () =>
    ipcRenderer.invoke('codex:projects:pick-workspace-root') as Promise<WorkspaceRootOption | null>,
  createBlankProject: (input) =>
    ipcRenderer.invoke('codex:projects:create-blank', input) as Promise<ProjectCreateBlankResult>,
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

const desktopFollowUps: DesktopCodexFollowUpApi = {
  getState: (conversationKey) =>
    ipcRenderer.invoke('codex:follow-ups:get-state', { conversationKey }),
  enqueue: (conversationKey, snapshot, preferredMode) => {
    assertFollowUpSnapshotFitsIpc(snapshot)
    return ipcRenderer.invoke('codex:follow-ups:enqueue', {
      conversationKey,
      snapshot,
      preferredMode
    })
  },
  edit: (conversationKey, itemId, replacementSnapshot) => {
    assertFollowUpSnapshotFitsIpc(replacementSnapshot)
    return ipcRenderer.invoke('codex:follow-ups:edit', {
      conversationKey,
      itemId,
      replacementSnapshot
    })
  },
  beginEdit: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:begin-edit', { conversationKey, itemId }),
  commitEdit: (conversationKey, itemId, replacementSnapshot) => {
    assertFollowUpSnapshotFitsIpc(replacementSnapshot)
    return ipcRenderer.invoke('codex:follow-ups:commit-edit', {
      conversationKey,
      itemId,
      replacementSnapshot
    })
  },
  cancelEdit: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:cancel-edit', { conversationKey, itemId }),
  delete: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:delete', { conversationKey, itemId }),
  reorder: (conversationKey, itemId, position) =>
    ipcRenderer.invoke('codex:follow-ups:reorder', {
      conversationKey,
      itemId,
      ...position
    }),
  requestSendNow: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:send-now', { conversationKey, itemId }),
  retry: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:retry', { conversationKey, itemId }),
  resume: (conversationKey) => ipcRenderer.invoke('codex:follow-ups:resume', { conversationKey }),
  clear: (conversationKey) => ipcRenderer.invoke('codex:follow-ups:clear', { conversationKey }),
  setDefaultMode: (mode) => ipcRenderer.invoke('codex:follow-ups:set-default-mode', { mode }),
  prepareNextTurn: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:prepare-next-turn', {
      conversationKey,
      ...(itemId ? { itemId } : {})
    }),
  materializeItem: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:materialize-item', {
      conversationKey,
      itemId
    }),
  steerNext: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:steer-next', {
      conversationKey,
      ...(itemId ? { itemId } : {})
    }),
  steerItem: (conversationKey, itemId) =>
    ipcRenderer.invoke('codex:follow-ups:steer-item', {
      conversationKey,
      itemId
    }),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FollowUpQueueChangeEvent): void =>
      callback(payload)
    ipcRenderer.on('codex:follow-ups:changed', listener)
    return () => ipcRenderer.removeListener('codex:follow-ups:changed', listener)
  }
}

const desktopApp = {
  environment: desktopEnvironment,
  codex: desktopCodex,
  chat: desktopCodexChat,
  composerContext: desktopComposerContext,
  projects: desktopProjects,
  conversations: desktopConversations,
  followUps: desktopFollowUps
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
