import type { IpcMainInvokeEvent } from 'electron'

import {
  composerContextSearchStartRequestSchema,
  composerContextSearchStopRequestSchema,
  composerContextSearchUpdateRequestSchema,
  type ComposerContextSearchStartResult
} from '../../shared/codexIpcApi'
import type { ComposerContextSearchService } from './ComposerContextSearchService'

type SearchServiceLike = Pick<ComposerContextSearchService, 'start' | 'update' | 'stop'>

export function createStartComposerContextSearchHandler(
  service: SearchServiceLike
): (event: IpcMainInvokeEvent, payload: unknown) => Promise<ComposerContextSearchStartResult> {
  return (event, payload) =>
    service.start(event.sender.id, composerContextSearchStartRequestSchema.parse(payload))
}

export function createUpdateComposerContextSearchHandler(
  service: SearchServiceLike
): (event: IpcMainInvokeEvent, payload: unknown) => Promise<void> {
  return (event, payload) =>
    service.update(event.sender.id, composerContextSearchUpdateRequestSchema.parse(payload))
}

export function createStopComposerContextSearchHandler(
  service: SearchServiceLike
): (event: IpcMainInvokeEvent, payload: unknown) => Promise<void> {
  return (event, payload) => {
    const request = composerContextSearchStopRequestSchema.parse(payload)
    return service.stop(event.sender.id, request.sessionId)
  }
}
