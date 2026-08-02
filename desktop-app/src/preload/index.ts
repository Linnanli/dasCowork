import { contextBridge, ipcRenderer } from 'electron'
import { config as configureZod, type ZodType } from 'zod'
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
  DesktopGitApi,
  DesktopProjectsApi,
  LocalContextPickerKind,
  LocalContextReference,
  FollowUpQueueChangeEvent,
  ProjectCreateBlankResult,
  WorkspaceRecoveryPayload,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarPreferences
} from '../shared/codexIpcApi'
import {
  gitIpcChannels,
  gitResolveRepositoryTargetRequestSchema,
  localGitBranchRequestSchema,
  localGitBranchSearchRequestSchema,
  localGitChangeEventSchema,
  localGitCheckoutBranchRequestSchema,
  localGitCreateBranchRequestSchema,
  localGitGetFileDiffRequestSchema,
  localGitGetReviewSnapshotRequestSchema,
  localGitRefreshReviewFilesRequestSchema,
  localGitListCommitsRequestSchema,
  localGitGetSummaryRequestSchema,
  localGitReviewMutationRequestSchema,
  localCommitRequestSchema,
  localGitResolveMergeBaseRequestSchema,
  turnPatchRequestSchema
} from '../shared/localGitApi'
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
import { createMcpServerStatusBridge } from './mcpServerStatusBridge'

// Electron's renderer CSP disallows Zod's optional dynamic parser compilation.
// Set this globally before any IPC payload is parsed, including the schemas
// imported by this preload bundle.
configureZod({ jitless: true })

const desktopEnvironment = {
  platform: process.platform
}

const desktopCodex: DesktopCodexApi = {
  getStatus: () => ipcRenderer.invoke('codex:get-status') as Promise<CodexStatus>,
  listModels: () => ipcRenderer.invoke('codex:list-models') as Promise<CodexModelList>,
  ...createMcpServerStatusBridge((channel, payload) => ipcRenderer.invoke(channel, payload)),
  setSelectedModel: (modelId: string) =>
    ipcRenderer.invoke('codex:set-selected-model', { modelId }) as Promise<{
      selectedModelId: string
    }>,
  listPendingApprovals: () =>
    ipcRenderer.invoke('codex:list-pending-approvals') as Promise<CodexApprovalRequest[]>,
  respondApproval: (requestId: string, response: CodexApprovalResponse) =>
    ipcRenderer.invoke('codex:respond-approval', { requestId, response }) as Promise<void>,
  snoozeApprovalAutoResolution: (requestId: string) =>
    ipcRenderer.invoke('codex:snooze-approval-auto-resolution', { requestId }) as Promise<boolean>,
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
  hasActiveRun: (conversationId) =>
    ipcRenderer.invoke('codex-chat:has-active-run', { conversationId }),
  getActiveRun: (conversationId) =>
    ipcRenderer.invoke('codex-chat:get-active-run', { conversationId }),
  getActiveRuns: () => ipcRenderer.invoke('codex-chat:get-active-runs'),
  getActiveSnapshot: (conversationId) =>
    ipcRenderer.invoke('codex-chat:get-active-snapshot', { conversationId }),
  postStart: (request: CodexChatRequest, streamId: string, port: MessagePort) => {
    ipcRenderer.postMessage('codex-chat:start', { streamId, request }, [port])
  },
  postAttach: (conversationId, streamId, port, runId, afterSequence) => {
    ipcRenderer.postMessage(
      'codex-chat:attach',
      { conversationId, streamId, ...(runId ? { runId } : {}), afterSequence },
      [port]
    )
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
  getWorkspaceRecovery: (input: WorkspaceRecoveryPayload) =>
    ipcRenderer.invoke('codex:projects:get-workspace-recovery', input),
  restoreWorkspace: (input: WorkspaceRecoveryPayload) =>
    ipcRenderer.invoke('codex:projects:restore-workspace', input),
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

const desktopGit: DesktopGitApi = {
  resolveRepositoryTarget: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.resolveRepositoryTarget,
      parseGitPayload(gitResolveRepositoryTargetRequestSchema, input)
    ),
  getSummary: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.getSummary,
      parseGitPayload(localGitGetSummaryRequestSchema, input)
    ),
  listCommits: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.listCommits,
      parseGitPayload(localGitListCommitsRequestSchema, input)
    ),
  getReviewSnapshot: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.getReviewSnapshot,
      parseGitPayload(localGitGetReviewSnapshotRequestSchema, input)
    ),
  refreshReviewFiles: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.refreshReviewFiles,
      parseGitPayload(localGitRefreshReviewFilesRequestSchema, input)
    ),
  getFileDiff: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.getFileDiff,
      parseGitPayload(localGitGetFileDiffRequestSchema, input)
    ),
  applyReviewAction: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.applyReviewAction,
      parseGitPayload(localGitReviewMutationRequestSchema, input)
    ),
  applyTurnPatch: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.applyTurnPatch,
      parseGitPayload(turnPatchRequestSchema, input)
    ),
  listBranches: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.listBranches,
      parseGitPayload(localGitBranchRequestSchema, input)
    ),
  searchBranches: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.searchBranches,
      parseGitPayload(localGitBranchSearchRequestSchema, input)
    ),
  resolveMergeBase: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.resolveMergeBase,
      parseGitPayload(localGitResolveMergeBaseRequestSchema, input)
    ),
  createBranch: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.createBranch,
      parseGitPayload(localGitCreateBranchRequestSchema, input)
    ),
  checkoutBranch: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.checkoutBranch,
      parseGitPayload(localGitCheckoutBranchRequestSchema, input)
    ),
  commitChanges: (input) =>
    ipcRenderer.invoke(
      gitIpcChannels.commitChanges,
      parseGitPayload(localCommitRequestSchema, input)
    ),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = localGitChangeEventSchema.safeParse(payload, { jitless: true })
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.send(`${gitIpcChannels.changed}:subscribe`)
    ipcRenderer.on(gitIpcChannels.changed, listener)
    return () => {
      ipcRenderer.removeListener(gitIpcChannels.changed, listener)
      ipcRenderer.send(`${gitIpcChannels.changed}:unsubscribe`)
    }
  }
}

function parseGitPayload<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input, { jitless: true })
  if (!parsed.success) throw parsed.error
  return parsed.data
}

const desktopApp = {
  environment: desktopEnvironment,
  codex: desktopCodex,
  chat: desktopCodexChat,
  composerContext: desktopComposerContext,
  projects: desktopProjects,
  conversations: desktopConversations,
  followUps: desktopFollowUps,
  git: desktopGit
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
