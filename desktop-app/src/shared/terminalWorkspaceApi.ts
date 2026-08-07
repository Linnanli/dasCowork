import { z } from 'zod'

export const TERMINAL_WORKSPACE_API_VERSION = 1 as const

const workspaceIdSchema = z.string().min(1).max(256)
const terminalSessionIdSchema = z.string().min(1).max(256)

export const terminalWorkspaceIpcChannels = {
  create: 'right-workspace:terminal:create',
  write: 'right-workspace:terminal:write',
  resize: 'right-workspace:terminal:resize',
  kill: 'right-workspace:terminal:kill',
  list: 'right-workspace:terminal:list',
  event: 'right-workspace:terminal:event'
} as const

export const terminalWorkspaceSessionStatusSchema = z.enum(['starting', 'running', 'exited'])
export type TerminalWorkspaceSessionStatus = z.infer<typeof terminalWorkspaceSessionStatusSchema>

export const terminalWorkspaceCreateRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    workspaceId: workspaceIdSchema,
    cols: z.number().int().min(1).max(1000).optional(),
    rows: z.number().int().min(1).max(1000).optional()
  })
  .strict()
export type TerminalWorkspaceCreateRequest = z.infer<typeof terminalWorkspaceCreateRequestSchema>

export const terminalWorkspaceWriteRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    data: z.string().min(1).max(1_000_000)
  })
  .strict()
export type TerminalWorkspaceWriteRequest = z.infer<typeof terminalWorkspaceWriteRequestSchema>

export const terminalWorkspaceResizeRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000)
  })
  .strict()
export type TerminalWorkspaceResizeRequest = z.infer<typeof terminalWorkspaceResizeRequestSchema>

export const terminalWorkspaceKillRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema
  })
  .strict()
export type TerminalWorkspaceKillRequest = z.infer<typeof terminalWorkspaceKillRequestSchema>

export const terminalWorkspaceListRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    workspaceId: workspaceIdSchema.optional()
  })
  .strict()
export type TerminalWorkspaceListRequest = z.infer<typeof terminalWorkspaceListRequestSchema>

export const terminalWorkspaceSessionSnapshotSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    workspaceId: workspaceIdSchema,
    status: terminalWorkspaceSessionStatusSchema,
    cwd: z.string().min(1).max(32_768).optional(),
    shell: z.string().min(1).max(32_768).optional(),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().min(1).max(128).nullable().optional(),
    scrollback: z.string().max(2_000_000).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict()
export type TerminalWorkspaceSessionSnapshot = z.infer<
  typeof terminalWorkspaceSessionSnapshotSchema
>

export const terminalWorkspaceListResultSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessions: z.array(terminalWorkspaceSessionSnapshotSchema)
  })
  .strict()
export type TerminalWorkspaceListResult = z.infer<typeof terminalWorkspaceListResultSchema>

export const terminalWorkspaceEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
      type: z.literal('created'),
      session: terminalWorkspaceSessionSnapshotSchema
    })
    .strict(),
  z
    .object({
      version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
      type: z.literal('data'),
      sessionId: terminalSessionIdSchema,
      data: z.string().max(1_000_000)
    })
    .strict(),
  z
    .object({
      version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
      type: z.literal('updated'),
      session: terminalWorkspaceSessionSnapshotSchema
    })
    .strict(),
  z
    .object({
      version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
      type: z.literal('exited'),
      session: terminalWorkspaceSessionSnapshotSchema
    })
    .strict()
])
export type TerminalWorkspaceEvent = z.infer<typeof terminalWorkspaceEventSchema>
