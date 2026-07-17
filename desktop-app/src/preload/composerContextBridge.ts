import type {
  ComposerContextCatalogChangeEvent,
  ComposerContextCatalogRequest,
  ComposerContextCatalogResult,
  ComposerContextCatalogRefreshOptions,
  ComposerContextSearchSectionEvent,
  ComposerContextSearchStartRequest,
  ComposerContextSearchStartResult,
  ComposerContextSearchStopRequest,
  ComposerContextSearchUpdateRequest,
  DesktopComposerContextApi,
  LocalAttachmentValidationRequest,
  LocalAttachmentValidationResult
} from '../shared/codexIpcApi'
import {
  composerContextCatalogChangeEventSchema,
  composerContextSearchSectionEventSchema
} from '../shared/codexIpcApi'

export type ComposerContextInvoke = (channel: string, payload: unknown) => Promise<unknown>
export type ComposerContextSubscribe = (
  channel: string,
  callback: (payload: unknown) => void
) => () => void

export function createComposerContextBridge(
  invoke: ComposerContextInvoke,
  subscribe: ComposerContextSubscribe
): DesktopComposerContextApi {
  return {
    list: (input: ComposerContextCatalogRequest) =>
      invoke('codex:composer-context:list', input) as Promise<ComposerContextCatalogResult>,
    refresh: (
      input: ComposerContextCatalogRequest,
      options?: ComposerContextCatalogRefreshOptions
    ) =>
      invoke('codex:composer-context:refresh', {
        input,
        ...(options ? { options } : {})
      }) as Promise<ComposerContextCatalogResult>,
    onDidChange: (callback: (event: ComposerContextCatalogChangeEvent) => void) =>
      subscribe('codex:composer-context-change', (payload) => {
        const event = composerContextCatalogChangeEventSchema.safeParse(payload, { jitless: true })
        if (event.success) callback(event.data)
      }),
    validateLocalAttachments: (input: LocalAttachmentValidationRequest) =>
      invoke(
        'codex:composer-context:validate-local-attachments',
        input
      ) as Promise<LocalAttachmentValidationResult>,
    startSearch: (input: ComposerContextSearchStartRequest) =>
      invoke(
        'codex:composer-context-search:start',
        input
      ) as Promise<ComposerContextSearchStartResult>,
    updateSearch: (input: ComposerContextSearchUpdateRequest) =>
      invoke('codex:composer-context-search:update', input) as Promise<void>,
    stopSearch: (input: ComposerContextSearchStopRequest) =>
      invoke('codex:composer-context-search:stop', input) as Promise<void>,
    onSearchUpdate: (callback: (event: ComposerContextSearchSectionEvent) => void) =>
      subscribe('codex:composer-context-search-update', (payload) => {
        const event = composerContextSearchSectionEventSchema.safeParse(payload, { jitless: true })
        if (event.success) callback(event.data)
      })
  }
}
