import type { AttachmentAdapter, CreateAttachment } from '@assistant-ui/react'

import {
  LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
  LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE
} from '../../../shared/composerContext'

type LocalImageAttachmentSource = {
  label: string
  mediaType: string
  previewUrl: string
}

export const localFileAttachmentMediaType = LOCAL_FILE_ATTACHMENT_MEDIA_TYPE
export const localFolderAttachmentMediaType = LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error(`无法读取图片“${file.name}”`))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取图片“${file.name}”`))
    reader.onabort = () => reject(new Error(`已取消读取图片“${file.name}”`))
    reader.readAsDataURL(file)
  })
}

export function createLocalImageAttachment({
  label,
  mediaType,
  previewUrl
}: LocalImageAttachmentSource): CreateAttachment {
  return {
    type: 'image' as const,
    name: label,
    contentType: mediaType,
    content: [
      {
        type: 'file' as const,
        filename: label,
        mimeType: mediaType,
        data: previewUrl
      }
    ]
  }
}

export function createLocalPathAttachment({
  fileUrl,
  kind,
  label,
  path
}: {
  fileUrl: string
  kind: 'file' | 'folder'
  label: string
  path: string
}): CreateAttachment {
  const contentType =
    kind === 'folder' ? localFolderAttachmentMediaType : localFileAttachmentMediaType
  const identity = { fileUrl, kind, path } satisfies LocalPathAttachmentIdentity
  return {
    id: `local-context:${encodeURIComponent(JSON.stringify(identity))}`,
    type: 'file',
    name: label,
    contentType,
    content: [
      {
        type: 'file',
        filename: label,
        mimeType: contentType,
        data: fileUrl
      }
    ]
  }
}

export type LocalPathAttachmentIdentity = {
  fileUrl: string
  kind: 'file' | 'folder'
  path: string
}

export function localPathAttachmentIdentityFromId(
  attachmentId: string
): LocalPathAttachmentIdentity | undefined {
  const prefix = 'local-context:'
  if (!attachmentId.startsWith(prefix)) return undefined
  try {
    const value = JSON.parse(decodeURIComponent(attachmentId.slice(prefix.length))) as unknown
    if (!value || typeof value !== 'object') return undefined
    const identity = value as Partial<LocalPathAttachmentIdentity>
    if (
      (identity.kind !== 'file' && identity.kind !== 'folder') ||
      typeof identity.path !== 'string' ||
      typeof identity.fileUrl !== 'string' ||
      !identity.fileUrl.startsWith('file:')
    ) {
      return undefined
    }
    return identity as LocalPathAttachmentIdentity
  } catch {
    return undefined
  }
}

/**
 * Image-only adapter for AI SDK UIMessage file parts. Keeping the completed
 * content as a `file` part preserves the selected file's MIME type—assistant-ui's
 * `image` content part otherwise assumes image/png when creating a UIMessage.
 */
export const imageAttachmentAdapter = {
  accept: `image/*,${localFileAttachmentMediaType},${localFolderAttachmentMediaType}`,

  async add({ file }) {
    return {
      id: createAttachmentId(),
      type: 'image',
      name: file.name,
      contentType: file.type,
      file,
      content: [],
      status: { type: 'requires-action', reason: 'composer-send' }
    }
  },

  async send(attachment) {
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          filename: attachment.name,
          mimeType: attachment.contentType ?? attachment.file.type,
          data: await readFileAsDataUrl(attachment.file)
        }
      ]
    }
  },

  async remove() {
    // Local File objects are owned by the browser; there is no remote upload to clean up.
  }
} satisfies AttachmentAdapter
