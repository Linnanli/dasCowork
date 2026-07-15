import type {
  ComposerContextCatalogChangeEvent,
  ComposerContextCatalogRequest,
  ComposerContextCatalogResult,
  ComposerContextCatalogRefreshOptions,
  DesktopComposerContextApi,
  LocalAttachmentValidationRequest,
  LocalAttachmentValidationResult
} from '../shared/codexIpcApi'
import { composerContextCatalogChangeEventSchema } from '../shared/codexIpcApi'

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
        const event = composerContextCatalogChangeEventSchema.safeParse(payload)
        if (event.success) callback(event.data)
      }),
    validateLocalAttachments: (input: LocalAttachmentValidationRequest) =>
      invoke(
        'codex:composer-context:validate-local-attachments',
        input
      ) as Promise<LocalAttachmentValidationResult>
  }
}
