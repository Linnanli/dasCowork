import { describe, expect, it, vi } from 'vitest'

import { createMcpServerStatusBridge } from './mcpServerStatusBridge'

describe('createMcpServerStatusBridge', () => {
  it('exposes only the fixed MCP server list channel and validates payloads', async () => {
    const invoke = vi.fn(async () => ({
      version: 1,
      generatedAt: '2026-08-01T00:00:00.000Z',
      servers: []
    }))
    const bridge = createMcpServerStatusBridge(invoke)

    await bridge.listMcpServers({ version: 1, threadId: 'thread-1' })

    expect(invoke).toHaveBeenCalledWith('codex:list-mcp-servers', {
      version: 1,
      threadId: 'thread-1'
    })
    expect(() => bridge.listMcpServers({ version: 1, method: 'raw/list' } as never)).toThrow()
  })

  it('validates main-process results before resolving', async () => {
    const bridge = createMcpServerStatusBridge(
      vi.fn(async () => ({
        version: 1,
        generatedAt: '2026-08-01T00:00:00.000Z',
        servers: [{ name: 'github', connected: true, authStatus: 'oAuth', toolCount: 1, tools: {} }]
      }))
    )

    await expect(bridge.listMcpServers({ version: 1 })).rejects.toThrow()
  })
})
