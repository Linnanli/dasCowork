import { describe, expect, it, vi } from 'vitest'

import type { AdminBackendClientModel, FetchLike } from './adminBackendModelClient'
import {
  createModelCatalogServiceFromEnv,
  ModelCatalogService,
  toCodexModel,
  type ModelCatalogSource
} from './modelCatalogService'

const backendModel: AdminBackendClientModel = {
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

const secondaryModel: AdminBackendClientModel = {
  ...backendModel,
  model_id: 'claude-3-5-sonnet',
  display_name: 'Claude 3.5 Sonnet',
  description: 'Text model',
  provider: 'anthropic',
  is_default: false,
  capabilities: ['chat'],
  api_base_url: 'https://api.anthropic.com/v1',
  api_format: 'anthropic'
}

function createSource(models: AdminBackendClientModel[]): ModelCatalogSource {
  return {
    listClientModels: vi.fn(async () => models)
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('toCodexModel', () => {
  it("maps backend model to safe DTO with ['text','image'] for vision/image capability", () => {
    expect(toCodexModel(backendModel)).toEqual({
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      description: 'Multimodal model',
      inputModalities: ['text', 'image'],
      isDefault: true
    })

    expect(toCodexModel({ ...backendModel, capabilities: ['IMAGE'] }).inputModalities).toEqual([
      'text',
      'image'
    ])
  })
})

describe('ModelCatalogService', () => {
  it('listModels does not expose api_key, provider, api_base_url, api_format, or source', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    const result = await service.listModels()

    expect(result).toEqual({
      models: [
        {
          id: 'gpt-4o',
          displayName: 'GPT-4o',
          description: 'Multimodal model',
          inputModalities: ['text', 'image'],
          isDefault: true
        }
      ],
      selectedModelId: 'gpt-4o'
    })
    expect(JSON.stringify(result)).not.toContain('api_key')
    expect(JSON.stringify(result)).not.toContain('provider')
    expect(JSON.stringify(result)).not.toContain('api_base_url')
    expect(JSON.stringify(result)).not.toContain('api_format')
    expect(JSON.stringify(result)).not.toContain('source')
    expect(JSON.stringify(result)).not.toContain('sk-test-key')
  })

  it('fresh cache is reused', async () => {
    let now = 1_000
    const source = createSource([backendModel])
    const service = new ModelCatalogService({
      source,
      cacheTtlMs: 5_000,
      now: () => now
    })

    await service.listModels()
    now = 2_000
    await service.listModels()

    expect(source.listClientModels).toHaveBeenCalledOnce()
  })

  it('stale cache is returned after refresh failure', async () => {
    let now = 1_000
    const source: ModelCatalogSource = {
      listClientModels: vi
        .fn()
        .mockResolvedValueOnce([backendModel])
        .mockRejectedValueOnce(new Error('backend down'))
    }
    const service = new ModelCatalogService({
      source,
      cacheTtlMs: 5,
      now: () => now
    })

    await service.listModels()
    now = 2_000
    await expect(service.listModels()).resolves.toEqual({
      models: [toCodexModel(backendModel)],
      selectedModelId: 'gpt-4o'
    })
    expect(source.listClientModels).toHaveBeenCalledTimes(2)
  })

  it('reuses the previous valid selected model after listModels', async () => {
    const service = new ModelCatalogService({
      source: createSource([backendModel, secondaryModel])
    })

    await service.setSelectedModel('claude-3-5-sonnet')

    await expect(service.listModels()).resolves.toMatchObject({
      selectedModelId: 'claude-3-5-sonnet'
    })
  })

  it('falls back when the previous selected model disappears from a refreshed catalog', async () => {
    let now = 1_000
    const source: ModelCatalogSource = {
      listClientModels: vi
        .fn()
        .mockResolvedValueOnce([backendModel, secondaryModel])
        .mockResolvedValueOnce([backendModel])
    }
    const service = new ModelCatalogService({
      source,
      cacheTtlMs: 5,
      now: () => now
    })

    await service.setSelectedModel('claude-3-5-sonnet')
    now = 2_000

    await expect(service.listModels()).resolves.toMatchObject({
      selectedModelId: 'gpt-4o'
    })
    expect(source.listClientModels).toHaveBeenCalledTimes(2)
  })

  it('selects the default model then first model when no selected model exists', async () => {
    const serviceWithDefault = new ModelCatalogService({
      source: createSource([secondaryModel, backendModel])
    })
    const serviceWithoutDefault = new ModelCatalogService({
      source: createSource([
        { ...backendModel, is_default: false },
        { ...secondaryModel, is_default: false }
      ])
    })

    await expect(serviceWithDefault.listModels()).resolves.toMatchObject({
      selectedModelId: 'gpt-4o'
    })
    await expect(serviceWithoutDefault.listModels()).resolves.toMatchObject({
      selectedModelId: 'gpt-4o'
    })
  })

  it('listModels returns an unavailable reason on cold-start backend failure', async () => {
    const source: ModelCatalogSource = {
      listClientModels: vi.fn().mockRejectedValue(new Error('backend down'))
    }
    const service = new ModelCatalogService({ source })

    await expect(service.listModels()).resolves.toEqual({
      models: [],
      unavailableReason: 'backend down'
    })
  })

  it('defaults invalid direct cacheTtlMs constructor input to 60000', async () => {
    for (const cacheTtlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      let now = 1_000
      const source = createSource([backendModel])
      const service = new ModelCatalogService({
        source,
        cacheTtlMs,
        now: () => now
      })

      await service.listModels()
      now = 2_000
      await service.listModels()

      expect(source.listClientModels).toHaveBeenCalledOnce()
    }
  })

  it('setSelectedModel accepts trimmed model ids', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.setSelectedModel('  gpt-4o  ')).resolves.toEqual({
      selectedModelId: 'gpt-4o'
    })
  })

  it('setSelectedModel rejects blank model ids', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.setSelectedModel('   ')).rejects.toThrow('modelId is required')
  })

  it('setSelectedModel rejects unknown models', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.setSelectedModel('unknown-model')).rejects.toThrow(
      'Unknown model: unknown-model'
    )
  })

  it('resolveClientModel returns full backend model inside main process', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.resolveClientModel('gpt-4o')).resolves.toEqual(backendModel)
  })

  it('resolveClientModel accepts trimmed model ids', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.resolveClientModel('  gpt-4o  ')).resolves.toEqual(backendModel)
  })

  it('resolveClientModel rejects blank model ids', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.resolveClientModel('   ')).rejects.toThrow('modelId is required')
  })

  it('resolveClientModel rejects unknown models', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.resolveClientModel('unknown-model')).rejects.toThrow(
      'Unknown model: unknown-model'
    )
  })

  it('resolveClientModel rejects cold-load failures with the original error', async () => {
    const error = new Error('backend down')
    const service = new ModelCatalogService({
      source: {
        listClientModels: vi.fn().mockRejectedValue(error)
      }
    })

    await expect(service.resolveClientModel('gpt-4o')).rejects.toBe(error)
  })
})

describe('createModelCatalogServiceFromEnv', () => {
  it('returns undefined without ADMIN_BACKEND_URL', () => {
    expect(createModelCatalogServiceFromEnv({})).toBeUndefined()
    expect(createModelCatalogServiceFromEnv({ ADMIN_BACKEND_URL: '   ' })).toBeUndefined()
  })

  it('returns ModelCatalogService with ADMIN_BACKEND_URL, ADMIN_BACKEND_MODEL_USER_ID, ADMIN_BACKEND_MODEL_CACHE_TTL_MS', async () => {
    vi.useFakeTimers()

    try {
      const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(200, [backendModel]))
      vi.stubGlobal('fetch', fetchImpl)
      vi.setSystemTime(0)

      const service = createModelCatalogServiceFromEnv({
        ADMIN_BACKEND_URL: 'https://admin.example.com/backend/',
        ADMIN_BACKEND_MODEL_USER_ID: 'user-1',
        ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '5'
      })

      expect(service).toBeInstanceOf(ModelCatalogService)
      if (!service) throw new Error('expected model catalog service')

      await service.listModels()
      vi.setSystemTime(4)
      await service.listModels()
      vi.setSystemTime(6)
      await service.resolveClientModel('gpt-4o')

      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(String(fetchImpl.mock.calls[0][0])).toBe(
        'https://admin.example.com/backend/api/client-models?user_id=user-1'
      )
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
