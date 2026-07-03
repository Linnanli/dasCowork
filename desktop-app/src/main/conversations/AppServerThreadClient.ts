import {
  createCodexHistoryClient,
  mapCodexThreadToUiMessages,
  type CodexHistoryClient,
  type CodexThreadForUi
} from '@janole/ai-sdk-provider-codex-asp'
import type { UIMessage } from 'ai'

import type { CodexAppServerLaunchOptions } from '../codexAppServerLaunch'

type AppServerHistoryThread = CodexThreadForUi & {
  id: string
  name: string | null
  preview: string
  createdAt: number
  updatedAt: number
  status: { type: string }
  cwd: string | null
}

export type AppServerThreadRow = {
  id: string
  title: string | null
  preview: string
  createdAt?: string
  updatedAt?: string
  archived: boolean
  running: boolean
  cwd: string | null
  turns?: CodexThreadForUi['turns']
  messages?: UIMessage[]
}

export type AppServerHistoryClientLike = {
  listAllThreads(input: {
    archived?: boolean
    sortKey?: 'updated_at' | 'created_at'
    sortDirection?: 'asc' | 'desc'
    modelProviders?: string[]
  }): Promise<AppServerHistoryThread[]>
  readThread(threadId: string, input?: { includeTurns?: boolean }): Promise<AppServerHistoryThread>
  archiveThread(threadId: string): Promise<void>
  unarchiveThread(threadId: string): Promise<void>
  renameThread(threadId: string, name: string): Promise<void>
}

export type AppServerThreadClientOptions = {
  launch?: CodexAppServerLaunchOptions
  historyClient?: AppServerHistoryClientLike
  createHistoryClient?: () => AppServerHistoryClientLike
}

export class AppServerThreadClient {
  constructor(private readonly options: AppServerThreadClientOptions) {}

  async listThreads(input: {
    includeArchived: boolean
    sortKey?: 'updated_at' | 'created_at'
  }): Promise<AppServerThreadRow[]> {
    return this.withHistoryClient(async (client) => {
      const threads = await client.listAllThreads({
        // Empty means all providers; omitting this would filter to the
        // sidebar app-server process's default provider.
        modelProviders: [],
        sortKey: input.sortKey === 'created_at' ? 'created_at' : 'updated_at',
        sortDirection: 'desc',
        ...(input.includeArchived ? { archived: true } : {})
      })
      return threads.map((thread) => toThreadRow(thread, input.includeArchived))
    })
  }

  async readThread(
    threadId: string,
    input: { includeTurns?: boolean } = {}
  ): Promise<AppServerThreadRow> {
    return this.withHistoryClient(async (client) => {
      const thread = await client.readThread(threadId, {
        includeTurns: input.includeTurns ?? false
      })
      return toThreadRow(thread, false, { includeMessages: input.includeTurns ?? false })
    })
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.withHistoryClient((client) => client.archiveThread(threadId))
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.withHistoryClient((client) => client.unarchiveThread(threadId))
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    await this.withHistoryClient((client) => client.renameThread(threadId, name))
  }

  private async withHistoryClient<T>(
    callback: (client: AppServerHistoryClientLike) => Promise<T>
  ): Promise<T> {
    return callback(this.createHistoryClient())
  }

  private createHistoryClient(): AppServerHistoryClientLike {
    if (this.options.historyClient) return this.options.historyClient
    if (this.options.createHistoryClient) return this.options.createHistoryClient()
    if (!this.options.launch) throw new Error('Codex app-server launch options are required')
    return createCodexHistoryClient({
      clientInfo: {
        name: 'dascowork_desktop_sidebar',
        title: 'dasCowork Desktop Sidebar',
        version: '1.0.0'
      },
      experimentalApi: true,
      transport: {
        type: 'stdio',
        stdio: {
          command: this.options.launch.command,
          args: this.options.launch.args,
          cwd: this.options.launch.cwd,
          env: this.options.launch.env
        }
      }
    }) satisfies CodexHistoryClient
  }
}

function toThreadRow(
  thread: AppServerHistoryThread,
  archived: boolean,
  options: { includeMessages?: boolean } = {}
): AppServerThreadRow {
  const title = cleanTitle(thread.name) ?? cleanTitle(thread.preview) ?? null
  return {
    id: thread.id,
    title,
    preview: thread.preview ?? '',
    createdAt: fromUnixSeconds(thread.createdAt),
    updatedAt: fromUnixSeconds(thread.updatedAt),
    archived,
    running: thread.status.type === 'active',
    cwd: thread.cwd,
    ...(thread.turns.length > 0 ? { turns: thread.turns } : {}),
    ...(options.includeMessages ? { messages: mapCodexThreadToUiMessages(thread) } : {})
  }
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title ? title : null
}

function fromUnixSeconds(value: number | undefined): string | undefined {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined
}
