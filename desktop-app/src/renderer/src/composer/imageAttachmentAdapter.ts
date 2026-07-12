import type { AttachmentAdapter, CreateAttachment } from '@assistant-ui/react'

type LocalImageAttachmentSource = {
  label: string
  mediaType: string
  previewUrl: string
}

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

/**
 * Image-only adapter for AI SDK UIMessage file parts. Keeping the completed
 * content as a `file` part preserves the selected file's MIME type—assistant-ui's
 * `image` content part otherwise assumes image/png when creating a UIMessage.
 */
export const imageAttachmentAdapter = {
  accept: 'image/*',

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
