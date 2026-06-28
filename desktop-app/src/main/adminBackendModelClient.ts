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
