import { describe, expect, it, vi } from 'vitest'

import {
  AdminBackendModelClient,
  normalizeAdminBackendBaseUrl
} from './adminBackendModelClient'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const validModel = {
  model_id: 'gpt-4o',
  display_name: 'GPT-4o',
  description: 'Multimodal model',
  provider: 'openai',
  is_default: true,
  capabilities: ['chat', 'vision'],
  api_base_url: 'https://api.openai.com/v1',
  api_key: 'sk-test-key',
  api_format: 'openai',
  source: 'admin'
}

describe('AdminBackendModelClient', () => {
  it('normalizes root URLs without removing path prefixes', () => {
    expect(normalizeAdminBackendBaseUrl(' https://admin.example.com/ ')).toBe(
      'https://admin.example.com'
    )
    expect(normalizeAdminBackendBaseUrl('https://admin.example.com/backend/')).toBe(
      'https://admin.example.com/backend'
    )
  })

  it('rejects non-http backend URLs', () => {
    expect(() => normalizeAdminBackendBaseUrl('file:///tmp/backend')).toThrow(
      'ADMIN_BACKEND_URL must use http or https'
    )
  })

  it('fetches client models with user_id and parses the backend contract', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [validModel]))
    const client = new AdminBackendModelClient({
      baseUrl: 'https://admin.example.com/backend/',
      userId: '00000000-0000-0000-0000-000000000001',
      fetchImpl
    })

    await expect(client.listClientModels()).resolves.toEqual([validModel])

    const requestedUrl = String(fetchImpl.mock.calls[0][0])
    expect(requestedUrl).toBe(
      'https://admin.example.com/backend/api/client-models?user_id=00000000-0000-0000-0000-000000000001'
    )
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { accept: 'application/json' }
    })
  })

  it('throws a readable error for non-2xx responses without echoing the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'secret sk-test-key' }))
    const client = new AdminBackendModelClient({
      baseUrl: 'https://admin.example.com',
      fetchImpl
    })

    const error = await client.listClientModels().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Failed to fetch admin backend models: HTTP 500')
    expect((error as Error).message).not.toContain('sk-test-key')
  })

  it('rejects malformed model payloads', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [{ ...validModel, capabilities: 'chat' }])
    )
    const client = new AdminBackendModelClient({
      baseUrl: 'https://admin.example.com',
      fetchImpl
    })

    await expect(client.listClientModels()).rejects.toThrow(
      'Invalid admin backend model response'
    )
  })
})
