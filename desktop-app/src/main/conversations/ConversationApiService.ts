import {
  type CodexTurnInputItem,
  userInputText as codexUserInputText
} from '@janole/ai-sdk-provider-codex-asp'
import type {
  SidebarConversationActionPayload,
  SidebarConversationListState,
  SidebarConversationOpenResult,
  SidebarConversationRenamePayload,
  SidebarPreferences
} from '../../shared/codexIpcApi'
import type { ProjectState, ThreadProjectAssignment } from '../../shared/projects/projectTypes'
import type { AppServerThreadRow } from './AppServerThreadClient'

export type ConversationThreadClientLike = {
  listThreads(input: {
    includeArchived: boolean
    sortKey?: 'updated_at' | 'created_at'
  }): Promise<AppServerThreadRow[]>
  readThread(threadId: string, input?: { includeTurns?: boolean }): Promise<AppServerThreadRow>
  archiveThread(threadId: string): Promise<void>
  unarchiveThread(threadId: string): Promise<void>
  renameThread(threadId: string, name: string): Promise<void>
}

export type ConversationProjectStoreLike = {
  getState(): Promise<ProjectState>
}

export type ConversationApiServiceOptions = {
  threadClient: ConversationThreadClientLike
  projectStore: ConversationProjectStoreLike
}

const defaultPreferences: SidebarPreferences = {
  organizeMode: 'project',
  sortKey: 'updated_at',
  collapsedSectionIds: [],
  collapsedGroupIds: []
}

export class ConversationApiService {
  private preferences: SidebarPreferences = defaultPreferences
  private lastState: SidebarConversationListState = {
    conversations: [],
    archivedConversationIds: [],
    loaded: false
  }

  constructor(private readonly options: ConversationApiServiceOptions) {}

  async getConversationList(): Promise<SidebarConversationListState> {
    return this.refreshConversationList()
  }

  /**
   * Checks whether a thread appears in the raw `thread/list` result without
   * updating `lastState`. Used by the convergence loop to detect when
   * `thread/list` has caught up to a newly created thread.
   */
  async hasThreadInList(threadId: string): Promise<boolean> {
    const threads = await this.options.threadClient.listThreads({
      includeArchived: false,
      sortKey: this.preferences.sortKey
    })
    return threads.some((thread) => thread.id === threadId)
  }

  async refreshConversationList(
    input: { ensureThreadIds?: string[] } = {}
  ): Promise<SidebarConversationListState> {
    try {
      const [projectState, threads] = await Promise.all([
        this.options.projectStore.getState(),
        this.options.threadClient.listThreads({
          includeArchived: false,
          sortKey: this.preferences.sortKey
        })
      ])
      const conversations = await this.includeRequiredThreads({
        threads,
        requiredThreadIds: input.ensureThreadIds
      })
      this.lastState = {
        conversations: conversations.map((thread) => ({
          id: thread.id,
          threadId: thread.id,
          title: conversationTitle(thread),
          projectAssignment: resolveAssignment(projectState, thread),
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          archived: thread.archived,
          running: thread.running,
          cwd: thread.cwd
        })),
        archivedConversationIds: conversations
          .filter((thread) => thread.archived)
          .map((thread) => thread.id),
        loaded: true,
        error: undefined
      }
      return this.lastState
    } catch (error) {
      this.lastState = {
        ...this.lastState,
        loaded: this.lastState.loaded,
        error: errorMessage(error)
      }
      return this.lastState
    }
  }

  async openConversation(
    input: SidebarConversationActionPayload
  ): Promise<SidebarConversationOpenResult> {
    const [projectState, thread] = await Promise.all([
      this.options.projectStore.getState(),
      this.options.threadClient.readThread(input.conversationId, { includeTurns: true })
    ])
    return {
      conversationId: thread.id,
      threadId: thread.id,
      title: thread.title,
      messages: thread.messages ?? [],
      projectAssignment: resolveAssignment(projectState, thread),
      cwd: thread.cwd
    }
  }

  async archiveConversation(
    input: SidebarConversationActionPayload
  ): Promise<SidebarConversationListState> {
    await this.options.threadClient.archiveThread(input.conversationId)
    return this.refreshConversationList()
  }

  async unarchiveConversation(
    input: SidebarConversationActionPayload
  ): Promise<SidebarConversationListState> {
    await this.options.threadClient.unarchiveThread(input.conversationId)
    return this.refreshConversationList()
  }

  async renameConversation(
    input: SidebarConversationRenamePayload
  ): Promise<SidebarConversationListState> {
    await this.options.threadClient.renameThread(input.conversationId, input.title.trim())
    return this.refreshConversationList()
  }

  getPreferences(): SidebarPreferences {
    return this.preferences
  }

  setPreferences(input: Partial<SidebarPreferences>): SidebarPreferences {
    this.preferences = {
      ...this.preferences,
      ...input,
      collapsedSectionIds: input.collapsedSectionIds ?? this.preferences.collapsedSectionIds,
      collapsedGroupIds: input.collapsedGroupIds ?? this.preferences.collapsedGroupIds
    }
    return this.preferences
  }

  private async includeRequiredThreads({
    threads,
    requiredThreadIds = []
  }: {
    threads: AppServerThreadRow[]
    requiredThreadIds?: string[]
  }): Promise<AppServerThreadRow[]> {
    const rows = [...threads]
    const rowsById = new Map(threads.map((thread) => [thread.id, thread]))
    const requiredMissingThreadIds = uniqueThreadIds(requiredThreadIds).filter(
      (threadId) => !rowsById.has(threadId)
    )

    for (const threadId of requiredMissingThreadIds) {
      const thread = await this.options.threadClient.readThread(threadId, { includeTurns: true })
      if (rowsById.has(thread.id)) continue
      if (thread.archived) continue
      rowsById.set(thread.id, thread)
      rows.unshift(thread)
    }

    return rows
  }
}

function uniqueThreadIds(threadIds: (string | undefined)[]): string[] {
  return [...new Set(threadIds.filter((threadId): threadId is string => Boolean(threadId)))]
}

function conversationTitle(thread: AppServerThreadRow): string | null {
  return cleanTitle(thread.title) ?? cleanTitle(firstTurnText(thread)) ?? null
}

function firstTurnText(thread: AppServerThreadRow): string | null {
  for (const turn of thread.turns ?? []) {
    const items = isRecord(turn) && Array.isArray(turn.items) ? turn.items : []
    for (const item of items) {
      if (!isRecord(item)) continue
      if (item.type === 'userMessage') return cleanTitle(userInputText(item.content))
      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        return cleanTitle(item.text)
      }
    }
  }
  return null
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title ? title : null
}

function resolveAssignment(
  projectState: ProjectState,
  thread: AppServerThreadRow
): ThreadProjectAssignment | undefined {
  const explicit = projectState.threadProjectAssignments[thread.id]
  if (explicit) return explicit

  if (projectState.projectlessThreadIds.includes(thread.id)) {
    const hints = projectState.projectlessHints[thread.id]
    return {
      projectKind: 'projectless',
      cwd: thread.cwd,
      workspaceRoot: hints?.workspaceRoot ?? thread.cwd,
      outputDirectory:
        hints?.outputDirectory ?? projectState.threadProjectlessOutputDirectories[thread.id] ?? null
    }
  }

  const workspaceRootHint = projectState.threadWorkspaceRootHints[thread.id]?.[0]
  if (workspaceRootHint) {
    return {
      projectKind: 'local',
      projectId: `path:${workspaceRootHint}`,
      path: workspaceRootHint,
      cwd: thread.cwd ?? workspaceRootHint
    }
  }

  const localProject = Object.values(projectState.localProjects).find((project) =>
    project.writableRoots.some((root) => root === thread.cwd)
  )
  if (localProject) {
    return {
      projectKind: 'local',
      projectId: localProject.id,
      cwd: thread.cwd ?? localProject.defaultCwd ?? null
    }
  }

  return undefined
}

function userInputText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const inputs = value
    .map(toCodexTurnInputItem)
    .filter((entry): entry is CodexTurnInputItem => Boolean(entry))
  return codexUserInputText(inputs)
}

function toCodexTurnInputItem(entry: unknown): CodexTurnInputItem | null {
  if (!isRecord(entry)) return null

  switch (entry.type) {
    case 'text':
      return typeof entry.text === 'string'
        ? {
            type: 'text',
            text: entry.text,
            text_elements: Array.isArray(entry.text_elements) ? entry.text_elements : []
          }
        : null
    case 'skill':
    case 'mention':
      return typeof entry.name === 'string'
        ? {
            type: entry.type,
            name: entry.name,
            path: typeof entry.path === 'string' ? entry.path : ''
          }
        : null
    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
