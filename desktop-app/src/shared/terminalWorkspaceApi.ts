import { z } from 'zod'

export const TERMINAL_WORKSPACE_API_VERSION = 2 as const
export const TERMINAL_REPLAY_TAIL_MAX_CHARACTERS = 16_000
export const TERMINAL_DATA_EVENT_MAX_CHARACTERS = 64 * 1024

const workspaceIdSchema = z.string().min(1).max(256)
const conversationIdSchema = z.string().min(1).max(256)
const threadIdSchema = z.string().min(1).max(256)
const terminalSessionIdSchema = z.string().min(1).max(256)
const terminalViewIdSchema = z.string().min(1).max(256)
const shellIdSchema = z.string().min(1).max(128)

export const terminalWorkspaceIpcChannels = {
  create: 'right-workspace:terminal:create',
  attach: 'right-workspace:terminal:attach',
  detach: 'right-workspace:terminal:detach',
  write: 'right-workspace:terminal:write',
  resize: 'right-workspace:terminal:resize',
  setTitle: 'right-workspace:terminal:set-title',
  runAction: 'right-workspace:terminal:run-action',
  restart: 'right-workspace:terminal:restart',
  close: 'right-workspace:terminal:close',
  list: 'right-workspace:terminal:list',
  snapshot: 'right-workspace:terminal:snapshot',
  listShells: 'right-workspace:terminal:list-shells',
  event: 'right-workspace:terminal:event'
} as const

export const terminalWorkspaceSessionStatusSchema = z.enum([
  'starting',
  'running',
  'exited',
  'error',
  'connection-lost'
])
export type TerminalWorkspaceSessionStatus = z.infer<typeof terminalWorkspaceSessionStatusSchema>

export const terminalWorkspaceBackendKindSchema = z.enum(['local-pty', 'remote-process'])
export type TerminalWorkspaceBackendKind = z.infer<typeof terminalWorkspaceBackendKindSchema>

export const terminalWorkspacePurposeSchema = z.enum(['interactive', 'action'])
export type TerminalWorkspacePurpose = z.infer<typeof terminalWorkspacePurposeSchema>

export const terminalWorkspaceShellKindSchema = z.enum([
  'posix',
  'powershell',
  'command-prompt',
  'wsl'
])
export type TerminalWorkspaceShellKind = z.infer<typeof terminalWorkspaceShellKindSchema>

export const terminalWorkspaceTargetSchema = z
  .object({
    conversationId: conversationIdSchema,
    threadId: threadIdSchema.optional()
  })
  .strict()
export type TerminalWorkspaceTarget = z.infer<typeof terminalWorkspaceTargetSchema>

const dimensionsSchema = {
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000)
}

export const terminalWorkspaceCreateRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    workspaceId: workspaceIdSchema,
    target: terminalWorkspaceTargetSchema,
    cols: dimensionsSchema.cols.optional(),
    rows: dimensionsSchema.rows.optional(),
    shellId: shellIdSchema.optional(),
    purpose: terminalWorkspacePurposeSchema.optional()
  })
  .strict()
export type TerminalWorkspaceCreateRequest = z.infer<typeof terminalWorkspaceCreateRequestSchema>

export const terminalWorkspaceAttachRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    workspaceId: workspaceIdSchema,
    target: terminalWorkspaceTargetSchema,
    viewId: terminalViewIdSchema,
    allowConversationFallback: z.boolean().optional(),
    nextSessionId: terminalSessionIdSchema.optional(),
    forceCwdSync: z.boolean().optional()
  })
  .strict()
export type TerminalWorkspaceAttachRequest = z.infer<typeof terminalWorkspaceAttachRequestSchema>

export const terminalWorkspaceDetachRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    viewId: terminalViewIdSchema
  })
  .strict()
export type TerminalWorkspaceDetachRequest = z.infer<typeof terminalWorkspaceDetachRequestSchema>

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
    ...dimensionsSchema
  })
  .strict()
export type TerminalWorkspaceResizeRequest = z.infer<typeof terminalWorkspaceResizeRequestSchema>

export const terminalWorkspaceSetTitleRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    rawShellTitle: z.string().max(1024)
  })
  .strict()
export type TerminalWorkspaceSetTitleRequest = z.infer<typeof terminalWorkspaceSetTitleRequestSchema>

export const terminalWorkspaceRunActionRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    command: z.string().min(1).max(32_768),
    title: z.string().max(256).optional()
  })
  .strict()
export type TerminalWorkspaceRunActionRequest = z.infer<typeof terminalWorkspaceRunActionRequestSchema>

export const terminalWorkspaceRestartReasonSchema = z.enum(['retry', 'cwd-sync', 'manual'])
export type TerminalWorkspaceRestartReason = z.infer<typeof terminalWorkspaceRestartReasonSchema>

export const terminalWorkspaceRestartRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema,
    workspaceId: workspaceIdSchema.optional(),
    target: terminalWorkspaceTargetSchema.optional(),
    viewId: terminalViewIdSchema.optional(),
    reason: terminalWorkspaceRestartReasonSchema.optional()
  })
  .strict()
export type TerminalWorkspaceRestartRequest = z.infer<typeof terminalWorkspaceRestartRequestSchema>

export const terminalWorkspaceCloseRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema
  })
  .strict()
export type TerminalWorkspaceCloseRequest = z.infer<typeof terminalWorkspaceCloseRequestSchema>

export const terminalWorkspaceListRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    workspaceId: workspaceIdSchema.optional(),
    target: terminalWorkspaceTargetSchema.optional()
  })
  .strict()
export type TerminalWorkspaceListRequest = z.infer<typeof terminalWorkspaceListRequestSchema>

export const terminalWorkspaceSnapshotRequestSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessionId: terminalSessionIdSchema
  })
  .strict()
export type TerminalWorkspaceSnapshotRequest = z.infer<typeof terminalWorkspaceSnapshotRequestSchema>

export const terminalWorkspaceAckSchema = z.object({ accepted: z.literal(true) }).strict()
export type TerminalWorkspaceAck = z.infer<typeof terminalWorkspaceAckSchema>

export const terminalWorkspaceSessionSnapshotSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    workspaceId: workspaceIdSchema,
    conversationId: conversationIdSchema,
    threadId: threadIdSchema.optional(),
    hostId: z.string().min(1).max(256),
    backendKind: terminalWorkspaceBackendKindSchema,
    purpose: terminalWorkspacePurposeSchema,
    cwd: z.string().min(1).max(32_768),
    shell: z.string().min(1).max(32_768),
    shellKind: terminalWorkspaceShellKindSchema,
    rawShellTitle: z.string().max(512).optional(),
    fixedTitle: z.string().max(512).optional(),
    title: z.string().min(1).max(512),
    ...dimensionsSchema,
    status: terminalWorkspaceSessionStatusSchema,
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().min(1).max(128).nullable().optional(),
    truncated: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    exitedAt: z.string().datetime({ offset: true }).optional()
  })
  .strict()
export type TerminalWorkspaceSessionSnapshot = z.infer<
  typeof terminalWorkspaceSessionSnapshotSchema
>

export const terminalWorkspaceSnapshotSchema = z
  .object({
    session: terminalWorkspaceSessionSnapshotSchema,
    output: z.string().max(TERMINAL_REPLAY_TAIL_MAX_CHARACTERS),
    truncated: z.boolean()
  })
  .strict()
export type TerminalWorkspaceSnapshot = z.infer<typeof terminalWorkspaceSnapshotSchema>

export const terminalWorkspaceListResultSchema = z
  .object({
    version: z.literal(TERMINAL_WORKSPACE_API_VERSION),
    sessions: z.array(terminalWorkspaceSessionSnapshotSchema)
  })
  .strict()
export type TerminalWorkspaceListResult = z.infer<typeof terminalWorkspaceListResultSchema>

export const terminalWorkspaceShellOptionSchema = z
  .object({
    id: shellIdSchema,
    label: z.string().min(1).max(256),
    isDefault: z.boolean()
  })
  .strict()
export type TerminalWorkspaceShellOption = z.infer<typeof terminalWorkspaceShellOptionSchema>

const terminalEventBase = { version: z.literal(TERMINAL_WORKSPACE_API_VERSION) }
export const terminalWorkspaceEventSchema = z.discriminatedUnion('type', [
  z
    .object({ ...terminalEventBase, type: z.literal('attached'), session: terminalWorkspaceSessionSnapshotSchema })
    .strict(),
  z
    .object({
      ...terminalEventBase,
      type: z.literal('init'),
      session: terminalWorkspaceSessionSnapshotSchema,
      output: z.string().max(TERMINAL_REPLAY_TAIL_MAX_CHARACTERS),
      truncated: z.boolean()
    })
    .strict(),
  z
    .object({
      ...terminalEventBase,
      type: z.literal('data'),
      sessionId: terminalSessionIdSchema,
      data: z.string().max(TERMINAL_DATA_EVENT_MAX_CHARACTERS),
      sequence: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({ ...terminalEventBase, type: z.literal('title'), session: terminalWorkspaceSessionSnapshotSchema })
    .strict(),
  z
    .object({ ...terminalEventBase, type: z.literal('status'), session: terminalWorkspaceSessionSnapshotSchema })
    .strict(),
  z
    .object({ ...terminalEventBase, type: z.literal('exit'), session: terminalWorkspaceSessionSnapshotSchema })
    .strict(),
  z
    .object({
      ...terminalEventBase,
      type: z.literal('error'),
      session: terminalWorkspaceSessionSnapshotSchema,
      message: z.string().min(1).max(2_000)
    })
    .strict()
])
export type TerminalWorkspaceEvent = z.infer<typeof terminalWorkspaceEventSchema>
