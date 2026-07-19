import type { CreateAttachment } from '@assistant-ui/react'

import {
  LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
  LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE
} from '../../../shared/composerContext'
import type { MaterializedQueuedUserMessage } from '../../../shared/codexFollowUpApi'
import {
  createLocalImageAttachment,
  createLocalPathAttachment
} from '../composer/imageAttachmentAdapter'

export type RestoredQueuedFollowUpComposerDraft = {
  text: string
  attachments: CreateAttachment[]
}

export function restoreQueuedFollowUpToComposerDraft(
  message: MaterializedQueuedUserMessage
): RestoredQueuedFollowUpComposerDraft {
  const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
  const attachments = message.parts.flatMap((part): CreateAttachment[] => {
    if (part.type !== 'file') return []
    if (part.url.startsWith('data:')) {
      if (!part.mediaType.startsWith('image/')) {
        throw new Error(`暂不支持编辑附件“${part.filename}”`)
      }
      return [
        createLocalImageAttachment({
          label: part.filename,
          mediaType: part.mediaType,
          previewUrl: part.url
        })
      ]
    }

    const kind = localAttachmentKind(part.mediaType)
    if (!kind) throw new Error(`无法恢复附件“${part.filename}”`)
    return [
      createLocalPathAttachment({
        fileUrl: part.url,
        kind,
        label: part.filename,
        path: localPathFromFileUrl(part.url)
      })
    ]
  })

  return { text, attachments }
}

function localAttachmentKind(mediaType: string): 'file' | 'folder' | undefined {
  if (mediaType === LOCAL_FILE_ATTACHMENT_MEDIA_TYPE) return 'file'
  if (mediaType === LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE) return 'folder'
  return undefined
}

function localPathFromFileUrl(fileUrl: string): string {
  const url = new URL(fileUrl)
  const pathname = decodeURIComponent(url.pathname)
  if (/^\/[A-Za-z]:\//u.test(pathname)) return pathname.slice(1)
  return pathname
}
