import { pathToFileURL } from 'node:url'
import type { UIMessage } from 'ai'

import { resolveAppMediaPath, toAppMediaUrl } from '../localMediaProtocol'

type Platform = NodeJS.Platform
type UiMessagePart = UIMessage['parts'][number]

export function normalizeLocalMediaUrls(
  messages: readonly UIMessage[],
  platform: Platform = process.platform
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => normalizeLocalMediaPart(part, platform))
  }))
}

export function restoreLocalMediaFileUrlsForModel(
  messages: readonly UIMessage[],
  platform: Platform = process.platform
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => restoreLocalMediaPart(part, platform))
  }))
}

function normalizeLocalMediaPart(part: UiMessagePart, platform: Platform): UiMessagePart {
  if (part.type !== 'file' || !isMediaType(part.mediaType) || !hasProtocol(part.url, 'file:')) {
    return part
  }

  const url = toAppMediaUrl(part.url, platform)
  return url ? { ...part, url } : part
}

function restoreLocalMediaPart(part: UiMessagePart, platform: Platform): UiMessagePart {
  if (part.type !== 'file' || !hasProtocol(part.url, 'app:')) return part

  const path = resolveAppMediaPath(part.url, platform)
  if (!path || !isMediaType(part.mediaType)) {
    throw new Error('Invalid local media URL in model input')
  }

  return { ...part, url: pathToFileURL(path).href }
}

function isMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/') || mediaType.startsWith('video/')
}

function hasProtocol(value: string, protocol: string): boolean {
  try {
    return new URL(value).protocol === protocol
  } catch {
    return false
  }
}
