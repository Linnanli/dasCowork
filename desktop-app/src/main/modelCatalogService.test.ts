import { describe, expect, it, vi } from 'vitest'

import type { AdminBackendClientModel } from './adminBackendModelClient'
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

function createSource(models: AdminBackendClientModel[]): ModelCatalogSource {
  return {
    listClientModels: vi.fn(async () => models)
  }
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

  it('resolveClientModel rejects unknown models', async () => {
    const service = new ModelCatalogService({ source: createSource([backendModel]) })

    await expect(service.resolveClientModel('unknown-model')).rejects.toThrow(
      'Unknown model: unknown-model'
    )
  })
})

describe('createModelCatalogServiceFromEnv', () => {
  it('returns undefined without ADMIN_BACKEND_URL', () => {
    expect(createModelCatalogServiceFromEnv({})).toBeUndefined()
    expect(createModelCatalogServiceFromEnv({ ADMIN_BACKEND_URL: '   ' })).toBeUndefined()
  })

  it('returns ModelCatalogService with ADMIN_BACKEND_URL, ADMIN_BACKEND_MODEL_USER_ID, ADMIN_BACKEND_MODEL_CACHE_TTL_MS', async () => {
    const service = createModelCatalogServiceFromEnv({
      ADMIN_BACKEND_URL: 'https://admin.example.com',
      ADMIN_BACKEND_MODEL_USER_ID: 'user-1',
      ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '2500'
    })

    expect(service).toBeInstanceOf(ModelCatalogService)
  })
})
