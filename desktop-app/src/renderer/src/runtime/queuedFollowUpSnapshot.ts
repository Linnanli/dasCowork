import type { Attachment } from '@assistant-ui/react'

import type {
  QueuedFollowUpAttachmentInput,
  QueuedUserMessageSnapshotInput,
  QueuedFollowUpTrustedContext
} from '../../../shared/codexFollowUpApi'
import { FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM } from '../../../shared/codexFollowUpApi'
import {
  localImageAttachmentIdentityFromId,
  localPathAttachmentIdentityFromId,
  readFileAsDataUrl
} from '../composer/imageAttachmentAdapter'

export type QueuedFollowUpSnapshotInput = {
  id: string
  text: string
  attachments: readonly Attachment[]
  trustedContext: QueuedFollowUpTrustedContext
}

export async function createQueuedFollowUpSnapshot({
  id,
  text,
  attachments,
  trustedContext
}: QueuedFollowUpSnapshotInput): Promise<QueuedUserMessageSnapshotInput> {
  assertInlineAttachmentSizeLimit(attachments)
  const frozenAttachments: QueuedFollowUpAttachmentInput[] = []
  for (const attachment of attachments) {
    frozenAttachments.push(await freezeAttachment(attachment))
  }

  return {
    id,
    text,
    attachments: frozenAttachments,
    // Directives remain frozen in `text`. Rich catalog records are not trusted
    // from the renderer and are resolved again by main/provider when sent.
    contextReferences: [],
    trustedContext
  }
}

async function freezeAttachment(attachment: Attachment): Promise<QueuedFollowUpAttachmentInput> {
  const localImage = localImageAttachmentIdentityFromId(attachment.id)
  if (localImage) {
    if (!localImage.capabilityToken) {
      throw new Error(`请重新选择图片“${attachment.name}”后再排队`)
    }
    const previewUrl = await attachmentDataUrl(attachment)
    if (!previewUrl.startsWith('app://fs/@fs/')) {
      throw new Error(`请重新选择图片“${attachment.name}”后再排队`)
    }
    return {
      kind: 'local-image',
      id: attachment.id,
      path: localImage.path,
      capabilityToken: localImage.capabilityToken,
      previewUrl,
      displayName: attachment.name,
      mediaType: attachment.contentType ?? 'image/png'
    }
  }

  const localPath = localPathAttachmentIdentityFromId(attachment.id)
  if (localPath) {
    return {
      kind: localPath.kind,
      path: localPath.path,
      label: attachment.name,
      fileUrl: localPath.fileUrl,
      ...(localPath.capabilityToken ? { capabilityToken: localPath.capabilityToken } : {})
    }
  }

  const dataUrl = await attachmentDataUrl(attachment)
  const parsed = parseDataUrl(dataUrl)
  return {
    kind: 'inline-asset',
    id: attachment.id,
    displayName: attachment.name,
    mediaType: attachment.contentType ?? parsed.mediaType,
    encoding: 'base64',
    data: parsed.base64
  }
}

async function attachmentDataUrl(attachment: Attachment): Promise<string> {
  if (attachment.file) return readFileAsDataUrl(attachment.file)

  for (const part of attachment.content ?? []) {
    if (part.type !== 'file') continue
    if ('data' in part && typeof part.data === 'string') return part.data
  }

  throw new Error(`无法冻结附件“${attachment.name}”`)
}

function assertInlineAttachmentSizeLimit(attachments: readonly Attachment[]): void {
  let totalBytes = 0
  for (const attachment of attachments) {
    if (
      localImageAttachmentIdentityFromId(attachment.id) ||
      localPathAttachmentIdentityFromId(attachment.id)
    ) {
      continue
    }

    totalBytes += attachmentByteLength(attachment)
    if (totalBytes > FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM) {
      const maxMegabytes = FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM / (1024 * 1024)
      throw new Error(`排队附件总大小不能超过 ${maxMegabytes} MiB`)
    }
  }
}

function attachmentByteLength(attachment: Attachment): number {
  if (attachment.file) return attachment.file.size

  for (const part of attachment.content ?? []) {
    if (part.type !== 'file' || !('data' in part) || typeof part.data !== 'string') continue
    return decodedBase64ByteLength(parseDataUrl(part.data).base64)
  }

  throw new Error(`无法冻结附件“${attachment.name}”`)
}

function decodedBase64ByteLength(base64: string): number {
  const normalized = base64.replace(/\s/gu, '')
  let padding = 0
  if (normalized.endsWith('==')) {
    padding = 2
  } else if (normalized.endsWith('=')) {
    padding = 1
  }
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function parseDataUrl(value: string): { mediaType: string; base64: string } {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(value)
  if (!match?.[1] || !match[2]) throw new Error('附件不是可持久化的 data URL')
  return { mediaType: match[1], base64: match[2] }
}
