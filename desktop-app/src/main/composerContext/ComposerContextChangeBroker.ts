import {
  COMPOSER_CONTEXT_CATALOG_VERSION,
  composerContextCatalogChangeEventSchema,
  type ComposerContextCatalogChangeEvent
} from '../../shared/codexIpcApi'

export type ComposerContextChangeBrokerOptions = {
  delayMs?: number
  publish(event: ComposerContextCatalogChangeEvent): void
}

type PendingChange = {
  event: ComposerContextCatalogChangeEvent
  timer: ReturnType<typeof setTimeout>
}

export class ComposerContextChangeBroker {
  private readonly pending = new Map<string, PendingChange>()
  private readonly delayMs: number

  constructor(private readonly options: ComposerContextChangeBrokerOptions) {
    this.delayMs = options.delayMs ?? 250
  }

  notify(input: Omit<ComposerContextCatalogChangeEvent, 'version'>): void {
    const event = composerContextCatalogChangeEventSchema.parse({
      version: COMPOSER_CONTEXT_CATALOG_VERSION,
      ...input
    })
    const key = scopeKey(event.scope)
    const existing = this.pending.get(key)
    if (existing) {
      existing.event = {
        ...existing.event,
        sectionIds: [...new Set([...existing.event.sectionIds, ...event.sectionIds])]
      }
      return
    }

    const change: PendingChange = {
      event,
      timer: setTimeout(() => this.flush(key), this.delayMs)
    }
    this.pending.set(key, change)
  }

  dispose(): void {
    for (const change of this.pending.values()) clearTimeout(change.timer)
    this.pending.clear()
  }

  private flush(key: string): void {
    const change = this.pending.get(key)
    if (!change) return
    this.pending.delete(key)
    this.options.publish(change.event)
  }
}

function scopeKey(scope: ComposerContextCatalogChangeEvent['scope']): string {
  return `${scope?.hostId ?? ''}\0${scope?.cwd ?? ''}\0${scope?.threadId ?? ''}`
}
