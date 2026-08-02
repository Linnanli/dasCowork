import {
  mcpServerListRequestSchema,
  mcpServerListResultSchema,
  type McpServerListResult
} from '../shared/mcpServerStatus'
import type { DesktopCodexApi } from '../shared/codexIpcApi'

type Invoke = (channel: string, payload: unknown) => Promise<unknown>

export function createMcpServerStatusBridge(
  invoke: Invoke
): Pick<DesktopCodexApi, 'listMcpServers'> {
  return {
    listMcpServers: (input) =>
      invoke(
        'codex:list-mcp-servers',
        mcpServerListRequestSchema.parse(input, { jitless: true })
      ).then((result) =>
        mcpServerListResultSchema.parse(result, { jitless: true })
      ) as Promise<McpServerListResult>
  }
}
