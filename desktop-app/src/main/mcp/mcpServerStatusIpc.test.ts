import { describe, expect, it, vi } from 'vitest'

import { createListMcpServersHandler } from './mcpServerStatusIpc'

describe('MCP server status IPC handlers', () => {
  it('validates payloads and result DTOs around the service', async () => {
    const service = {
      list: vi.fn(async () => ({
        version: 1 as const,
        generatedAt: '2026-08-01T00:00:00.000Z',
        servers: []
      }))
    }
    const handler = createListMcpServersHandler(service)

    await expect(handler(undefined, { version: 1, threadId: 'thread-1' })).resolves.toEqual({
      version: 1,
      generatedAt: '2026-08-01T00:00:00.000Z',
      servers: []
    })
    expect(service.list).toHaveBeenCalledWith({ version: 1, threadId: 'thread-1' })
    await expect(
      handler(undefined, { version: 1, threadId: '', method: 'raw/list' })
    ).rejects.toThrow()
  })
})
