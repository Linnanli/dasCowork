import {
  composerContextCatalogRequestSchema,
  composerContextCatalogRefreshPayloadSchema,
  type ComposerContextCatalogResult
} from '../../shared/codexIpcApi'
import type { ComposerContextCatalogService } from './ComposerContextCatalogService'

type CatalogServiceLike = Pick<ComposerContextCatalogService, 'list' | 'refresh'>

export function createListComposerContextHandler(
  service: CatalogServiceLike
): (_event: unknown, payload: unknown) => Promise<ComposerContextCatalogResult> {
  return (_event, payload) => service.list(composerContextCatalogRequestSchema.parse(payload))
}

export function createRefreshComposerContextHandler(
  service: CatalogServiceLike
): (_event: unknown, payload: unknown) => Promise<ComposerContextCatalogResult> {
  return (_event, payload) => {
    const request = composerContextCatalogRefreshPayloadSchema.parse(payload)
    return service.refresh(request.input, request.options)
  }
}
