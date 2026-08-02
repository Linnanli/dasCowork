import { z } from 'zod'

export const MCP_SERVER_STATUS_VERSION = 1 as const

export const mcpServerAuthStatusSchema = z.enum([
  'unsupported',
  'notLoggedIn',
  'bearerToken',
  'oAuth'
])

export type McpServerAuthStatus = z.infer<typeof mcpServerAuthStatusSchema>

export const mcpServerListRequestSchema = z
  .object({
    version: z.literal(MCP_SERVER_STATUS_VERSION),
    threadId: z.string().min(1).optional()
  })
  .strict()

export type McpServerListRequest = z.infer<typeof mcpServerListRequestSchema>

export const mcpServerSummarySchema = z
  .object({
    name: z.string().min(1),
    connected: z.boolean(),
    authStatus: mcpServerAuthStatusSchema,
    toolCount: z.number().int().nonnegative()
  })
  .strict()

export type McpServerSummary = z.infer<typeof mcpServerSummarySchema>

export const mcpServerListResultSchema = z
  .object({
    version: z.literal(MCP_SERVER_STATUS_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    servers: z.array(mcpServerSummarySchema)
  })
  .strict()

export type McpServerListResult = z.infer<typeof mcpServerListResultSchema>
