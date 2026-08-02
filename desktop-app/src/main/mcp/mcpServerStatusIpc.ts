import {
  mcpServerListRequestSchema,
  mcpServerListResultSchema,
  type McpServerListResult
} from '../../shared/mcpServerStatus'
import type { McpServerStatusService } from './McpServerStatusService'

type McpServerStatusServiceLike = Pick<McpServerStatusService, 'list'>

export function createListMcpServersHandler(
  service: McpServerStatusServiceLike
): (_event: unknown, payload: unknown) => Promise<McpServerListResult> {
  return async (_event, payload) => {
    const request = mcpServerListRequestSchema.parse(payload)
    const result = await service.list(request)
    return mcpServerListResultSchema.parse(result)
  }
}
