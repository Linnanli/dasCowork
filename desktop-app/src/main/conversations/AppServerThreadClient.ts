import { AppServerClient, StdioTransport } from '@janole/ai-sdk-provider-codex-asp'
import { z } from 'zod'

import type { CodexAppServerLaunchOptions } from '../codexAppServerLaunch'

export type AppServerThreadRow = {
  id: string
  title: string | null
  preview: string
  createdAt?: string
  updatedAt?: string
  archived: boolean
  running: boolean
  cwd: string | null
  turns?: unknown[]
}

export type AppServerJsonRpcClientLike = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  notification(method: string, params?: unknown): Promise<void>
  request<T = unknown>(method: string, params?: unknown): Promise<T>
}

export type AppServerThreadClientOptions = {
  launch?: CodexAppServerLaunchOptions
  createClient?: () => AppServerJsonRpcClientLike
}

const threadStatusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notLoaded') }).passthrough(),
  z.object({ type: z.literal('idle') }).passthrough(),
  z.object({ type: z.literal('systemError') }).passthrough(),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.unknown()) }).passthrough()
])

const appServerThreadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    preview: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    status: threadStatusSchema,
    cwd: z.string().nullable(),
    turns: z.array(z.unknown()).optional()
  })
  .catchall(z.unknown())

const threadListResponseSchema = z.object({
  data: z.array(appServerThreadSchema),
  nextCursor: z.string().nullable().optional()
})

const threadReadResponseSchema = z.object({
  thread: appServerThreadSchema
})

export class AppServerThreadClient {
  constructor(private readonly options: AppServerThreadClientOptions) {}

  async listThreads(input: {
    includeArchived: boolean
    sortKey?: 'updated_at' | 'created_at'
  }): Promise<AppServerThreadRow[]> {
    return this.withClient(async (client) => {
      const rows: AppServerThreadRow[] = []
      let cursor: string | undefined

      do {
        const response = threadListResponseSchema.parse(
          await client.request('thread/list', {
            cursor,
            limit: 100,
            sortKey: input.sortKey === 'created_at' ? 'created_at' : 'updated_at',
            sortDirection: 'desc',
            ...(input.includeArchived ? { archived: true } : {})
          })
        )
        rows.push(...response.data.map((thread) => toThreadRow(thread, input.includeArchived)))
        cursor = response.nextCursor ?? undefined
      } while (cursor)

      return rows
    })
  }

  async readThread(
    threadId: string,
    input: { includeTurns?: boolean } = {}
  ): Promise<AppServerThreadRow> {
    return this.withClient(async (client) => {
      const response = threadReadResponseSchema.parse(
        await client.request('thread/read', { threadId, includeTurns: input.includeTurns ?? false })
      )
      return toThreadRow(response.thread, false)
    })
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.withClient((client) => client.request('thread/archive', { threadId }))
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.withClient((client) => client.request('thread/unarchive', { threadId }))
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    await this.withClient((client) => client.request('thread/name/set', { threadId, name }))
  }

  private async withClient<T>(
    callback: (client: AppServerJsonRpcClientLike) => Promise<T>
  ): Promise<T> {
    const client = this.createClient()
    await client.connect()
    try {
      await client.request('initialize', {
        clientInfo: {
          name: 'dascowork_desktop_sidebar',
          title: 'dasCowork Desktop Sidebar',
          version: '1.0.0'
        },
        capabilities: { experimentalApi: true }
      })
      await client.notification('initialized')
      return await callback(client)
    } finally {
      await client.disconnect()
    }
  }

  private createClient(): AppServerJsonRpcClientLike {
    if (this.options.createClient) return this.options.createClient()
    if (!this.options.launch) throw new Error('Codex app-server launch options are required')
    return new AppServerClient(
      new StdioTransport({
        command: this.options.launch.command,
        args: this.options.launch.args,
        cwd: this.options.launch.cwd,
        env: this.options.launch.env
      })
    )
  }
}

function toThreadRow(
  thread: z.infer<typeof appServerThreadSchema>,
  archived: boolean
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
    ...(thread.turns ? { turns: thread.turns } : {})
  }
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title ? title : null
}

function fromUnixSeconds(value: number | undefined): string | undefined {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined
}
