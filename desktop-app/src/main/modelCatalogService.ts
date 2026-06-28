import type { CodexModel, CodexModelList } from '../shared/codexIpcApi'
import { AdminBackendModelClient, type AdminBackendClientModel } from './adminBackendModelClient'

export type ModelCatalogSource = {
  listClientModels(): Promise<AdminBackendClientModel[]>
}

export type ModelCatalogServiceOptions = {
  source: ModelCatalogSource
  cacheTtlMs?: number
  now?: () => number
}

export type ModelCatalogServiceConfig = {
  adminBackendUrl?: string
  adminBackendModelUserId?: string
  adminBackendModelCacheTtlMs?: number
}

type ModelCache = {
  models: AdminBackendClientModel[]
  loadedAt: number
}

export class ModelCatalogService {
  private readonly source: ModelCatalogSource
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private cache: ModelCache | undefined
  private selectedModelId: string | undefined

  constructor(options: ModelCatalogServiceOptions) {
    this.source = options.source
    this.cacheTtlMs = normalizeCacheTtlMs(options.cacheTtlMs)
    this.now = options.now ?? Date.now
  }

  async listModels(force = false): Promise<CodexModelList> {
    const models = await this.loadModels(force).catch((error: unknown) => {
      return {
        error
      }
    })

    if (!Array.isArray(models)) {
      return {
        models: [],
        unavailableReason: errorMessage(models.error)
      }
    }

    const selectedModelId = this.resolveSelectedModelId(models)
    this.selectedModelId = selectedModelId

    return {
      models: models.map(toCodexModel),
      selectedModelId
    }
  }

  async setSelectedModel(modelId: string): Promise<{ selectedModelId: string }> {
    const selectedModel = await this.resolveClientModel(modelId)
    this.selectedModelId = selectedModel.model_id

    return { selectedModelId: selectedModel.model_id }
  }

  async resolveClientModel(modelId: string): Promise<AdminBackendClientModel> {
    const trimmed = modelId.trim()
    if (!trimmed) throw new Error('modelId is required')

    const models = await this.loadModels(false)
    const model = models.find((candidate) => candidate.model_id === trimmed)
    if (!model) throw new Error(`Unknown model: ${trimmed}`)

    return model
  }

  private async loadModels(force: boolean): Promise<AdminBackendClientModel[]> {
    if (!force && this.cache && this.now() - this.cache.loadedAt < this.cacheTtlMs) {
      return this.cache.models
    }

    try {
      const models = await this.source.listClientModels()
      this.cache = { models, loadedAt: this.now() }
      return models
    } catch (error) {
      // Fail open after a successful load so transient backend outages do not
      // strand an already-running desktop session without model validation data.
      if (this.cache) return this.cache.models
      throw error
    }
  }

  private resolveSelectedModelId(models: AdminBackendClientModel[]): string | undefined {
    if (
      this.selectedModelId &&
      models.some((candidate) => candidate.model_id === this.selectedModelId)
    ) {
      return this.selectedModelId
    }

    return (
      models.find((candidate) => candidate.is_default)?.model_id ?? models[0]?.model_id ?? undefined
    )
  }
}

export function toCodexModel(model: AdminBackendClientModel): CodexModel {
  const capabilities = model.capabilities.map((capability) => capability.toLowerCase())
  const inputModalities = ['text']

  if (capabilities.includes('vision') || capabilities.includes('image')) {
    inputModalities.push('image')
  }

  return {
    id: model.model_id,
    displayName: model.display_name || model.model_id,
    description: model.description ?? undefined,
    inputModalities,
    isDefault: model.is_default
  }
}

export function createModelCatalogService(
  config: ModelCatalogServiceConfig
): ModelCatalogService | undefined {
  const baseUrl = config.adminBackendUrl?.trim()
  if (!baseUrl) return undefined

  return new ModelCatalogService({
    source: new AdminBackendModelClient({
      baseUrl,
      userId: config.adminBackendModelUserId
    }),
    cacheTtlMs: config.adminBackendModelCacheTtlMs
  })
}

function normalizeCacheTtlMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 60_000

  return value
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
