# Admin Backend Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `desktop-app` model selection to `admin-backend` `GET /api/client-models` through Electron main process without exposing backend model secrets to renderer code.

**Architecture:** Electron main gets a new `AdminBackendModelClient` for HTTP contract handling and a `ModelCatalogService` for caching, normalization, default selection, selected-model validation, and main-process-only model resolution. `CodexChatRuntimeService` uses the catalog when configured, validates chat request model ids against it, and keeps its existing provider model-list fallback when `ADMIN_BACKEND_URL` is absent. Renderer code keeps using the existing `window.desktopCodex.listModels()` and `setSelectedModel()` IPC surface.

**Tech Stack:** Electron main process, TypeScript, zod, Node/Electron `fetch`, Vitest, existing `CodexChatRuntimeService` IPC bridge.

---

## Scope Check

This plan covers one subsystem: model catalog integration for `desktop-app`. It does not change chat streaming, `codex-app-server` launch, renderer `ModelSelector`, or admin-backend routes. The backend route already exists at `GET /api/client-models` and returns `ClientModelConfig[]`.

This is Phase 1: backend-backed model listing and selection validation. It does not make admin-backend `provider`, `api_base_url`, `api_key`, or `api_format` drive inference yet. Chat still runs through the existing Codex ASP provider path (`provider.chat(modelId)`), after the selected/requested `modelId` has been validated against the catalog. A future multi-provider runtime needs a separate `ModelRouter` / provider-adapter layer.

## File Structure

- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.ts`
  - Owns the backend HTTP contract.
  - Builds `/api/client-models` URLs with optional `user_id`.
  - Applies timeout, HTTP status checks, and zod response validation.
  - Does not echo backend error bodies into thrown errors, because future backend bodies could contain sensitive values.
  - Returns full backend `ClientModelConfig` objects, including `api_key`, only inside main process.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.test.ts`
  - Verifies URL construction, parsing, HTTP error messages, timeout behavior, and schema rejection.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.ts`
  - Owns cache, default selection, selected-model validation, safe renderer DTO mapping, and environment bootstrap.
  - Exposes only `CodexModelList` to callers that cross IPC.
  - Exposes `resolveClientModel(modelId)` for main-process runtime validation and future provider routing.
- Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.test.ts`
  - Verifies normalization, secret stripping, cache TTL behavior, stale-cache fallback, selected-model validation, and env bootstrap.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`
  - Adds optional catalog dependency.
  - Uses catalog for `listModels()` and `setSelectedModel()` when configured.
  - Calls `modelCatalog.resolveClientModel(modelId)` before streaming when catalog mode is enabled, including when renderer sends `request.modelId` directly.
  - Keeps existing provider fallback when catalog is absent.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts`
  - Adds regression coverage for catalog-backed listing, selected default model, and unknown model rejection.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`
  - Wires `createModelCatalogServiceFromEnv(process.env)` into `CodexChatRuntimeService`.
- Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/README.md`
  - Documents `ADMIN_BACKEND_URL`, optional `ADMIN_BACKEND_MODEL_USER_ID`, and cache TTL.

## Data Contract

Backend response shape from `/Users/nallylin/Documents/code/x-claw/admin-backend/src/models.rs::ClientModelConfig`:

```ts
export type AdminBackendClientModel = {
  model_id: string
  display_name: string
  description: string | null
  provider: string
  is_default: boolean
  capabilities: string[]
  api_base_url: string | null
  api_key: string | null
  api_format: string
  source: string
}
```

Safe renderer DTO already defined in `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/shared/codexIpcApi.ts`:

```ts
export type CodexModel = {
  id: string
  displayName: string
  description?: string
  inputModalities: string[]
  isDefault: boolean
}

export type CodexModelList = {
  models: CodexModel[]
  selectedModelId?: string
  unavailableReason?: string
}
```

No renderer IPC response may include `provider`, `api_base_url`, `api_key`, `api_format`, or `source`.

## Security Boundary

- `ADMIN_BACKEND_URL` should be HTTPS outside local development because `/api/client-models` returns full provider credentials to Electron main process.
- `/api/client-models` should be protected by a client/device/JWT/mTLS/signature mechanism before production use. This plan only consumes the existing endpoint; it does not change admin-backend authentication.
- Main process must not forward backend response bodies or full model configs to renderer. Renderer gets only `CodexModelList`.

---

### Task 1: Admin Backend HTTP Client

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.test.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.ts`

- [ ] **Step 1: Write the failing client tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the client tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/adminBackendModelClient.test.ts
```

Expected:

```text
FAIL  src/main/adminBackendModelClient.test.ts
Error: Failed to resolve import "./adminBackendModelClient"
```

- [ ] **Step 3: Implement `AdminBackendModelClient`**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/adminBackendModelClient.ts`:

```ts
import { z } from 'zod'

const adminBackendClientModelSchema = z.object({
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().nullable(),
  provider: z.string().min(1),
  is_default: z.boolean(),
  capabilities: z.array(z.string()),
  api_base_url: z.string().nullable(),
  api_key: z.string().nullable(),
  api_format: z.string().min(1),
  source: z.string().min(1)
})

const adminBackendClientModelsSchema = z.array(adminBackendClientModelSchema)

export type AdminBackendClientModel = z.infer<typeof adminBackendClientModelSchema>
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type AdminBackendModelClientOptions = {
  baseUrl: string
  userId?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

export class AdminBackendModelClient {
  private readonly baseUrl: string
  private readonly userId: string | undefined
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number

  constructor(options: AdminBackendModelClientOptions) {
    this.baseUrl = normalizeAdminBackendBaseUrl(options.baseUrl)
    this.userId = options.userId?.trim() || undefined
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async listClientModels(): Promise<AdminBackendClientModel[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(this.buildClientModelsUrl(), {
        headers: { accept: 'application/json' },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch admin backend models: HTTP ${response.status}`)
      }

      const payload = await response.json()
      const parsed = adminBackendClientModelsSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(
          `Invalid admin backend model response: ${parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')}`
        )
      }

      return parsed.data
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out fetching admin backend models after ${this.timeoutMs}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildClientModelsUrl(): URL {
    const url = new URL(this.baseUrl)
    const basePath = url.pathname.replace(/\/+$/, '')
    url.pathname = `${basePath}/api/client-models`
    url.search = ''
    if (this.userId) url.searchParams.set('user_id', this.userId)
    return url
  }
}

export function normalizeAdminBackendBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new Error('ADMIN_BACKEND_URL is required')

  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ADMIN_BACKEND_URL must use http or https')
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/adminBackendModelClient.test.ts
```

Expected:

```text
PASS  src/main/adminBackendModelClient.test.ts
```

- [ ] **Step 5: Commit the client**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork
git add desktop-app/src/main/adminBackendModelClient.ts desktop-app/src/main/adminBackendModelClient.test.ts
git commit -m "feat: add admin backend model client"
```

Expected:

```text
[<branch> <sha>] feat: add admin backend model client
```

---

### Task 2: Model Catalog Service

**Files:**
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.test.ts`
- Create: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.ts`

- [ ] **Step 1: Write the failing catalog tests**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import type { AdminBackendClientModel } from './adminBackendModelClient'
import {
  createModelCatalogServiceFromEnv,
  ModelCatalogService,
  toCodexModel
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

function createSource(models: AdminBackendClientModel[]) {
  return {
    listClientModels: vi.fn(async () => models)
  }
}

describe('ModelCatalogService', () => {
  it('maps backend models to renderer-safe Codex models', () => {
    expect(toCodexModel(backendModel)).toEqual({
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      description: 'Multimodal model',
      inputModalities: ['text', 'image'],
      isDefault: true
    })
  })

  it('does not expose backend secrets through listModels', async () => {
    const source = createSource([backendModel])
    const service = new ModelCatalogService({ source, cacheTtlMs: 60_000 })

    await expect(service.listModels()).resolves.toEqual({
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

    const response = await service.listModels()
    expect(JSON.stringify(response)).not.toContain('sk-test-key')
    expect(JSON.stringify(response)).not.toContain('api_base_url')
    expect(JSON.stringify(response)).not.toContain('openai')
    expect(JSON.stringify(response)).not.toContain('api_format')
    expect(JSON.stringify(response)).not.toContain('admin')
  })

  it('uses cache while it is fresh', async () => {
    let now = 1_000
    const source = createSource([backendModel])
    const service = new ModelCatalogService({
      source,
      cacheTtlMs: 60_000,
      now: () => now
    })

    await service.listModels()
    now = 2_000
    await service.listModels()

    expect(source.listClientModels).toHaveBeenCalledTimes(1)
  })

  it('falls back to stale cache after a refresh failure', async () => {
    let now = 1_000
    const source = {
      listClientModels: vi
        .fn()
        .mockResolvedValueOnce([backendModel])
        .mockRejectedValueOnce(new Error('backend down'))
    }
    const service = new ModelCatalogService({
      source,
      cacheTtlMs: 1,
      now: () => now
    })

    await service.listModels()
    now = 2_000

    await expect(service.listModels()).resolves.toMatchObject({
      selectedModelId: 'gpt-4o'
    })
    expect(source.listClientModels).toHaveBeenCalledTimes(2)
  })

  it('rejects selecting a model that is not in the catalog', async () => {
    const source = createSource([backendModel])
    const service = new ModelCatalogService({ source })

    await expect(service.setSelectedModel('missing-model')).rejects.toThrow(
      'Unknown model: missing-model'
    )
  })

  it('resolves a known full client model inside main process only', async () => {
    const source = createSource([backendModel])
    const service = new ModelCatalogService({ source })

    await expect(service.resolveClientModel('gpt-4o')).resolves.toEqual(backendModel)
  })

  it('rejects resolving a model that is not in the catalog', async () => {
    const source = createSource([backendModel])
    const service = new ModelCatalogService({ source })

    await expect(service.resolveClientModel('missing-model')).rejects.toThrow(
      'Unknown model: missing-model'
    )
  })

  it('creates no catalog when ADMIN_BACKEND_URL is missing', () => {
    expect(createModelCatalogServiceFromEnv({})).toBeUndefined()
  })

  it('creates a catalog when ADMIN_BACKEND_URL is present', () => {
    expect(
      createModelCatalogServiceFromEnv({
        ADMIN_BACKEND_URL: 'https://admin.example.com',
        ADMIN_BACKEND_MODEL_USER_ID: '00000000-0000-0000-0000-000000000001',
        ADMIN_BACKEND_MODEL_CACHE_TTL_MS: '120000'
      })
    ).toBeInstanceOf(ModelCatalogService)
  })
})
```

- [ ] **Step 2: Run the catalog tests to verify they fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/modelCatalogService.test.ts
```

Expected:

```text
FAIL  src/main/modelCatalogService.test.ts
Error: Failed to resolve import "./modelCatalogService"
```

- [ ] **Step 3: Implement `ModelCatalogService`**

Create `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/modelCatalogService.ts`:

```ts
import type { CodexModel, CodexModelList } from '../shared/codexIpcApi'
import {
  AdminBackendModelClient,
  type AdminBackendClientModel
} from './adminBackendModelClient'

export type ModelCatalogSource = {
  listClientModels(): Promise<AdminBackendClientModel[]>
}

export type ModelCatalogServiceOptions = {
  source: ModelCatalogSource
  cacheTtlMs?: number
  now?: () => number
}

type ModelCache = {
  models: AdminBackendClientModel[]
  fetchedAt: number
}

export class ModelCatalogService {
  private readonly source: ModelCatalogSource
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private cache: ModelCache | undefined
  private selectedModelId: string | undefined

  constructor(options: ModelCatalogServiceOptions) {
    this.source = options.source
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  async listModels(force = false): Promise<CodexModelList> {
    const backendModels = await this.loadModels(force)
    const models = backendModels.map(toCodexModel)
    const selectedModelId = this.resolveSelectedModelId(models)
    this.selectedModelId = selectedModelId
    return { models, selectedModelId }
  }

  async setSelectedModel(modelId: string): Promise<{ selectedModelId: string }> {
    const trimmed = modelId.trim()
    if (!trimmed) throw new Error('modelId is required')

    await this.resolveClientModel(trimmed)

    this.selectedModelId = trimmed
    return { selectedModelId: trimmed }
  }

  async resolveClientModel(modelId: string): Promise<AdminBackendClientModel> {
    const trimmed = modelId.trim()
    if (!trimmed) throw new Error('modelId is required')

    const models = await this.loadModels(false)
    const model = models.find((item) => item.model_id === trimmed)
    if (!model) throw new Error(`Unknown model: ${trimmed}`)
    return model
  }

  private async loadModels(force: boolean): Promise<AdminBackendClientModel[]> {
    if (!force && this.cache && this.isCacheFresh()) return this.cache.models

    try {
      const models = await this.source.listClientModels()
      this.cache = { models, fetchedAt: this.now() }
      return models
    } catch (error) {
      if (this.cache) return this.cache.models
      throw error
    }
  }

  private isCacheFresh(): boolean {
    return Boolean(this.cache && this.now() - this.cache.fetchedAt < this.cacheTtlMs)
  }

  private resolveSelectedModelId(models: readonly CodexModel[]): string | undefined {
    if (this.selectedModelId && models.some((model) => model.id === this.selectedModelId)) {
      return this.selectedModelId
    }
    return models.find((model) => model.isDefault)?.id ?? models[0]?.id
  }
}

export function toCodexModel(model: AdminBackendClientModel): CodexModel {
  return {
    id: model.model_id,
    displayName: model.display_name || model.model_id,
    description: model.description ?? undefined,
    inputModalities: toInputModalities(model.capabilities),
    isDefault: model.is_default
  }
}

export function createModelCatalogServiceFromEnv(
  env: NodeJS.ProcessEnv
): ModelCatalogService | undefined {
  const baseUrl = env['ADMIN_BACKEND_URL']?.trim()
  if (!baseUrl) return undefined

  return new ModelCatalogService({
    source: new AdminBackendModelClient({
      baseUrl,
      userId: env['ADMIN_BACKEND_MODEL_USER_ID']
    }),
    cacheTtlMs: parsePositiveInteger(env['ADMIN_BACKEND_MODEL_CACHE_TTL_MS']) ?? 60_000
  })
}

function toInputModalities(capabilities: readonly string[]): string[] {
  const normalized = new Set(capabilities.map((capability) => capability.toLowerCase()))
  const modalities = ['text']
  if (normalized.has('vision') || normalized.has('image')) modalities.push('image')
  return modalities
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
```

- [ ] **Step 4: Run the catalog tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/modelCatalogService.test.ts
```

Expected:

```text
PASS  src/main/modelCatalogService.test.ts
```

- [ ] **Step 5: Commit the catalog**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork
git add desktop-app/src/main/modelCatalogService.ts desktop-app/src/main/modelCatalogService.test.ts
git commit -m "feat: add desktop model catalog service"
```

Expected:

```text
[<branch> <sha>] feat: add desktop model catalog service
```

---

### Task 3: Runtime Catalog Integration

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`

- [ ] **Step 1: Add failing runtime tests for catalog-backed models**

Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.test.ts` by adding these tests inside the existing `describe('CodexChatRuntimeService', () => { ... })` block:

```ts
  it('uses the configured model catalog for listModels', async () => {
    const modelCatalog = {
      listModels: vi.fn(async () => ({
        models: [
          {
            id: 'backend-model',
            displayName: 'Backend Model',
            inputModalities: ['text'],
            isDefault: true
          }
        ],
        selectedModelId: 'backend-model'
      })),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog
    })

    await expect(service.listModels()).resolves.toEqual({
      models: [
        {
          id: 'backend-model',
          displayName: 'Backend Model',
          inputModalities: ['text'],
          isDefault: true
        }
      ],
      selectedModelId: 'backend-model'
    })
    expect(modelCatalog.listModels).toHaveBeenCalledTimes(1)
  })

  it('uses the catalog selected model when chat requests omit modelId', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () =>
        (async function* () {
          yield { type: 'text-start' as const, id: 'text-1' }
          yield { type: 'text-end' as const, id: 'text-1' }
        })()
    }))
    const modelCatalog = {
      listModels: vi.fn(async () => ({
        models: [
          {
            id: 'backend-default',
            displayName: 'Backend Default',
            inputModalities: ['text'],
            isDefault: true
          }
        ],
        selectedModelId: 'backend-default'
      })),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn(async () => ({
        model_id: 'backend-default',
        display_name: 'Backend Default',
        description: null,
        provider: 'openai',
        is_default: true,
        capabilities: ['chat'],
        api_base_url: null,
        api_key: null,
        api_format: 'openai',
        source: 'admin'
      }))
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog,
      streamText
    })

    await service.listModels()
    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: []
      },
      port
    )

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'backend-default' })
    )
    expect(modelCatalog.resolveClientModel).toHaveBeenCalledWith('backend-default')
    expect(port.messages.at(-1)).toEqual({ type: 'finish' })
  })

  it('rejects chat request modelId values that are not in the catalog', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () =>
        (async function* () {
          yield { type: 'text-start' as const, id: 'text-1' }
          yield { type: 'text-end' as const, id: 'text-1' }
        })()
    }))
    const modelCatalog = {
      listModels: vi.fn(),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn(async () => {
        throw new Error('Unknown model: unknown-model')
      })
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog,
      streamText
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'unknown-model'
      },
      port
    )

    expect(modelCatalog.resolveClientModel).toHaveBeenCalledWith('unknown-model')
    expect(streamText).not.toHaveBeenCalled()
    expect(port.messages).toEqual([{ type: 'error', error: 'Unknown model: unknown-model' }])
  })

  it('delegates selected model validation to the catalog', async () => {
    const modelCatalog = {
      listModels: vi.fn(),
      setSelectedModel: vi.fn(async () => ({ selectedModelId: 'backend-model' })),
      resolveClientModel: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog
    })

    await expect(service.setSelectedModel('backend-model')).resolves.toEqual({
      selectedModelId: 'backend-model'
    })
    expect(modelCatalog.setSelectedModel).toHaveBeenCalledWith('backend-model')
  })
```

- [ ] **Step 2: Run runtime tests to verify the new tests fail**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/codexChatRuntimeService.test.ts
```

Expected:

```text
FAIL  src/main/codexChatRuntimeService.test.ts
Object literal may only specify known properties, and 'modelCatalog' does not exist
```

- [ ] **Step 3: Add the catalog option to `CodexChatRuntimeService`**

Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts`.

Add this import with the existing imports:

```ts
import type { ModelCatalogService } from './modelCatalogService'
```

Add this exported type near `StreamTextLike`:

```ts
export type ModelCatalogLike = Pick<
  ModelCatalogService,
  'listModels' | 'setSelectedModel' | 'resolveClientModel'
>
```

Change `CodexChatRuntimeServiceOptions` to include `modelCatalog`:

```ts
export type CodexChatRuntimeServiceOptions = {
  cwd?: string
  defaultModel?: string
  launch?: CodexAppServerLaunchOptions
  modelCatalog?: ModelCatalogLike
  streamText?: StreamTextLike
}
```

Add this private field to the class:

```ts
  private readonly modelCatalog: ModelCatalogLike | undefined
```

Add this assignment in the constructor after `this.streamText = options.streamText ?? defaultStreamText`:

```ts
    this.modelCatalog = options.modelCatalog
```

Replace the existing `listModels()` method with:

```ts
  async listModels(): Promise<CodexModelList> {
    if (this.modelCatalog) {
      try {
        const list = await this.modelCatalog.listModels()
        this.selectedModelId = list.selectedModelId
        return list
      } catch (error) {
        return { models: [], unavailableReason: errorMessage(error) }
      }
    }

    try {
      const models = await this.provider.listModels()
      const mapped = models.map<CodexModel>((model) => ({
        id: model.id,
        displayName: model.displayName || model.model || model.id,
        description: model.description || undefined,
        inputModalities: model.inputModalities ?? [],
        isDefault: Boolean(model.isDefault)
      }))
      const selectedModelId =
        this.selectedModelId ?? mapped.find((model) => model.isDefault)?.id ?? mapped[0]?.id
      this.selectedModelId = selectedModelId
      return { models: mapped, selectedModelId }
    } catch (error) {
      return { models: [], unavailableReason: errorMessage(error) }
    }
  }
```

Replace the existing `setSelectedModel()` method with:

```ts
  async setSelectedModel(modelId: string): Promise<{ selectedModelId: string }> {
    if (!modelId.trim()) throw new Error('modelId is required')

    if (this.modelCatalog) {
      const response = await this.modelCatalog.setSelectedModel(modelId)
      this.selectedModelId = response.selectedModelId
      return response
    }

    this.selectedModelId = modelId
    return { selectedModelId: modelId }
  }
```

In `startChatStream()`, replace this block:

```ts
      const modelId = request.modelId ?? this.selectedModelId
      if (!modelId) throw new Error('No Codex model selected')
      const result = await this.streamText({
```

with:

```ts
      const modelId = request.modelId ?? this.selectedModelId
      if (!modelId) throw new Error('No Codex model selected')
      if (this.modelCatalog) await this.modelCatalog.resolveClientModel(modelId)
      const result = await this.streamText({
```

- [ ] **Step 4: Run runtime tests to verify they pass**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/codexChatRuntimeService.test.ts
```

Expected:

```text
PASS  src/main/codexChatRuntimeService.test.ts
```

- [ ] **Step 5: Commit runtime integration**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork
git add desktop-app/src/main/codexChatRuntimeService.ts desktop-app/src/main/codexChatRuntimeService.test.ts
git commit -m "feat: use model catalog in codex runtime"
```

Expected:

```text
[<branch> <sha>] feat: use model catalog in codex runtime
```

---

### Task 4: Startup Wiring and Configuration Docs

**Files:**
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`
- Modify: `/Users/nallylin/Documents/code/dasCowork/desktop-app/README.md`

- [ ] **Step 1: Wire the catalog into Electron main**

Modify `/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts`.

Add this import with the main-process imports:

```ts
import { createModelCatalogServiceFromEnv } from './modelCatalogService'
```

Replace:

```ts
const codexRuntime = new CodexChatRuntimeService()
```

with:

```ts
const codexRuntime = new CodexChatRuntimeService({
  modelCatalog: createModelCatalogServiceFromEnv(process.env)
})
```

- [ ] **Step 2: Document the environment variables**

Append this section to `/Users/nallylin/Documents/code/dasCowork/desktop-app/README.md`:

````md
## Admin Backend Model Catalog

The desktop app can load the model selector list from `admin-backend` through Electron main process.

Set these environment variables before starting the app:

```bash
export ADMIN_BACKEND_URL="http://127.0.0.1:3000"
export ADMIN_BACKEND_MODEL_USER_ID="00000000-0000-0000-0000-000000000001"
export ADMIN_BACKEND_MODEL_CACHE_TTL_MS="60000"
npm run dev
```

`ADMIN_BACKEND_URL` enables the backend-backed model catalog. When it is not set, the app keeps using the Codex provider model list fallback.

`ADMIN_BACKEND_MODEL_USER_ID` is optional. When present, it is sent as `user_id` to `GET /api/client-models` so admin-backend can apply department whitelist filtering.

`ADMIN_BACKEND_MODEL_CACHE_TTL_MS` is optional and defaults to `60000`.

The backend response includes provider credentials for main-process use. Renderer IPC responses only receive the safe `CodexModelList` summary defined in `src/shared/codexIpcApi.ts`.

This integration is Phase 1. It controls the model selector list and validates selected/requested model ids. It does not route inference through backend-provided `provider`, `api_base_url`, `api_key`, or `api_format`; chat still uses the existing Codex ASP provider.

For production, `ADMIN_BACKEND_URL` must use HTTPS and `/api/client-models` must be protected by a client/device/JWT/mTLS/signature mechanism before credentials are distributed to desktop clients.
````

- [ ] **Step 3: Run targeted tests after startup wiring**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test -- src/main/adminBackendModelClient.test.ts src/main/modelCatalogService.test.ts src/main/codexChatRuntimeService.test.ts
```

Expected:

```text
PASS  src/main/adminBackendModelClient.test.ts
PASS  src/main/modelCatalogService.test.ts
PASS  src/main/codexChatRuntimeService.test.ts
```

- [ ] **Step 4: Commit startup wiring and docs**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork
git add desktop-app/src/main/index.ts desktop-app/README.md
git commit -m "docs: document backend model catalog config"
```

Expected:

```text
[<branch> <sha>] docs: document backend model catalog config
```

---

### Task 5: Full Verification

**Files:**
- Verify: `/Users/nallylin/Documents/code/dasCowork/desktop-app`

- [ ] **Step 1: Run the desktop app test suite**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm test
```

Expected:

```text
Test Files  ... passed
Tests       ... passed
```

- [ ] **Step 2: Run node and web typechecks**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run typecheck
```

Expected:

```text
> desktop-app@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web
```

The command exits with status `0`.

- [ ] **Step 3: Run lint**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork/desktop-app
npm run lint
```

Expected:

```text
> desktop-app@1.0.0 lint
> eslint --cache .
```

The command exits with status `0`.

- [ ] **Step 4: Verify the working tree only contains intended changes**

Run:

```bash
cd /Users/nallylin/Documents/code/dasCowork
git status --short
```

Expected after all task commits:

```text
```

The output is empty.

## Self-Review

- Spec coverage: covered. The plan includes the two requested units, `AdminBackendModelClient` and `ModelCatalogService`, wires them into existing IPC through `CodexChatRuntimeService`, validates `request.modelId` before streaming, preserves provider fallback, documents Phase 1 runtime limits, and documents production transport/authentication requirements.
- Placeholder scan: passed. The plan contains concrete file paths, exact commands, expected outputs, and code for every changed file.
- Type consistency: passed. `AdminBackendClientModel`, `ModelCatalogSource`, `ModelCatalogService`, `resolveClientModel`, `ModelCatalogLike`, `CodexModel`, and `CodexModelList` names are consistent across tasks.
