import { stat as nodeStat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  COMPOSER_CONTEXT_CATALOG_VERSION,
  type FollowUpLocalAttachment,
  type FollowUpLocalAttachmentInput,
  type FollowUpLocalImageInput
} from '../../shared/codexIpcApi'
import { validateLocalAttachments } from '../composerContext/localAttachmentValidation'
import {
  LocalPathCapabilityStore,
  type LocalPathCapabilityRequest
} from '../localPathCapabilityStore'

type QueuedLocalAttachment =
  | FollowUpLocalAttachment
  | FollowUpLocalAttachmentInput
  | FollowUpLocalImageInput

export type ValidateQueuedLocalAttachmentsOptions = {
  capabilities: LocalPathCapabilityStore
  stat?: (path: string) => Promise<{
    isFile(): boolean
    isDirectory(): boolean
    dev: number
    ino: number
    size: number
    mtimeMs: number
  }>
}

export async function validateQueuedLocalAttachments(
  attachments: readonly QueuedLocalAttachment[],
  options: ValidateQueuedLocalAttachmentsOptions
): Promise<void> {
  const localPathAttachments = attachments.filter(
    (attachment): attachment is Extract<QueuedLocalAttachment, { kind: 'file' | 'folder' }> =>
      attachment.kind === 'file' || attachment.kind === 'folder'
  )
  const stat = options.stat ?? nodeStat
  const validation = await validateLocalAttachments(
    {
      version: COMPOSER_CONTEXT_CATALOG_VERSION,
      references: localPathAttachments
    },
    { stat }
  )
  const invalid = validation.entries.find((entry) => !entry.valid)
  if (invalid) {
    throw new Error(
      `Queued attachment is no longer available: ${invalid.reference.label} (${invalid.error ?? 'invalid path'})`
    )
  }

  const capabilityRequests: LocalPathCapabilityRequest[] = []
  for (const attachment of localPathAttachments) {
    if (!('capabilityToken' in attachment)) continue
    const token = attachment.capabilityToken
    if (typeof token !== 'string' || token.length === 0) continue
    const metadata = await stat(attachment.path)
    capabilityRequests.push({
      token,
      path: attachment.path,
      kind: attachment.kind,
      identity: {
        dev: metadata.dev,
        ino: metadata.ino,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs
      }
    })
  }
  options.capabilities.consumeAll(capabilityRequests)

  for (const attachment of localPathAttachments) {
    if (!('capabilityToken' in attachment)) continue
    attachment.fileUrl = pathToFileURL(attachment.path).href
    delete attachment.capabilityToken
  }
}
