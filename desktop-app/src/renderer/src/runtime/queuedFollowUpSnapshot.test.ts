// @vitest-environment jsdom

import type { Attachment } from '@assistant-ui/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM } from '../../../shared/codexFollowUpApi'
import {
  createLocalImageAttachment,
  createLocalPathAttachment
} from '../composer/imageAttachmentAdapter'
import { createQueuedFollowUpSnapshot } from './queuedFollowUpSnapshot'

const trustedContext = {
  conversationId: 'conversation-1',
  hostId: 'local',
  cwd: '/repo',
  workspaceRoots: ['/repo']
}

describe('createQueuedFollowUpSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('freezes completed image data and local path identity', async () => {
    const localPath = createLocalPathAttachment({
      capabilityToken: 'file-picker-token',
      fileUrl: 'file:///repo/notes.txt',
      kind: 'file',
      label: 'notes.txt',
      path: '/repo/notes.txt'
    })
    const snapshot = await createQueuedFollowUpSnapshot({
      id: 'follow-up-1',
      text: 'inspect both',
      trustedContext,
      attachments: [
        {
          id: 'image-1',
          type: 'image',
          name: 'screen.png',
          contentType: 'image/png',
          status: { type: 'complete' },
          content: [
            {
              type: 'file',
              filename: 'screen.png',
              mimeType: 'image/png',
              data: 'data:image/png;base64,cG5n'
            }
          ]
        },
        {
          id: localPath.id!,
          type: localPath.type ?? 'file',
          name: localPath.name,
          contentType: localPath.contentType,
          content: localPath.content,
          status: { type: 'complete' }
        }
      ]
    })

    expect(snapshot).toMatchObject({
      id: 'follow-up-1',
      text: 'inspect both',
      attachments: [
        {
          kind: 'inline-asset',
          id: 'image-1',
          mediaType: 'image/png',
          data: 'cG5n'
        },
        {
          kind: 'file',
          path: '/repo/notes.txt',
          fileUrl: 'file:///repo/notes.txt',
          capabilityToken: 'file-picker-token'
        }
      ]
    })
  })

  it('hands a selected local image to main for trusted persistence', async () => {
    const attachment = createLocalImageAttachment({
      capabilityToken: 'picker-token',
      label: 'screen.png',
      mediaType: 'image/png',
      path: '/repo/screen.png',
      previewUrl: 'app://fs/@fs/repo/screen.png'
    })
    const snapshot = await createQueuedFollowUpSnapshot({
      id: 'follow-up-app-media',
      text: 'inspect image',
      trustedContext,
      attachments: [
        {
          id: attachment.id!,
          type: attachment.type ?? 'image',
          name: attachment.name,
          contentType: attachment.contentType,
          status: { type: 'complete' },
          content: attachment.content
        }
      ]
    })

    expect(snapshot.attachments).toEqual([
      {
        kind: 'local-image',
        id: attachment.id,
        path: '/repo/screen.png',
        capabilityToken: 'picker-token',
        previewUrl: 'app://fs/@fs/repo/screen.png',
        displayName: 'screen.png',
        mediaType: 'image/png'
      }
    ])
  })

  it('keeps restored local files queueable when their picker capability has expired', async () => {
    const attachment = createLocalPathAttachment({
      fileUrl: 'file:///repo/notes.txt',
      kind: 'file',
      label: 'notes.txt',
      path: '/repo/notes.txt'
    })

    const snapshot = await createQueuedFollowUpSnapshot({
      id: 'follow-up-local-path',
      text: 'inspect file',
      trustedContext,
      attachments: [
        {
          id: attachment.id!,
          type: attachment.type ?? 'file',
          name: attachment.name,
          contentType: attachment.contentType,
          content: attachment.content,
          status: { type: 'complete' }
        }
      ]
    })

    expect(snapshot.attachments).toEqual([
      {
        kind: 'file',
        path: '/repo/notes.txt',
        label: 'notes.txt',
        fileUrl: 'file:///repo/notes.txt'
      }
    ])
  })

  it('rejects oversized File objects before starting FileReader', async () => {
    const fileReader = vi.fn()
    vi.stubGlobal('FileReader', fileReader)
    const oversizedFile = {
      name: 'oversized.png',
      type: 'image/png',
      size: FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM + 1
    } as File

    await expect(
      createQueuedFollowUpSnapshot({
        id: 'follow-up-oversized',
        text: 'inspect image',
        trustedContext,
        attachments: [fileAttachment('oversized', oversizedFile)]
      })
    ).rejects.toThrow('排队附件总大小不能超过 10 MiB')
    expect(fileReader).not.toHaveBeenCalled()
  })

  it('checks aggregate File.size before reading any attachment', async () => {
    const fileReader = vi.fn()
    vi.stubGlobal('FileReader', fileReader)
    const fileSize = FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM / 2 + 1
    const first = { name: 'first.png', type: 'image/png', size: fileSize } as File
    const second = { name: 'second.png', type: 'image/png', size: fileSize } as File

    await expect(
      createQueuedFollowUpSnapshot({
        id: 'follow-up-aggregate',
        text: 'inspect images',
        trustedContext,
        attachments: [fileAttachment('first', first), fileAttachment('second', second)]
      })
    ).rejects.toThrow('排队附件总大小不能超过 10 MiB')
    expect(fileReader).not.toHaveBeenCalled()
  })

  it('reads accepted File objects sequentially', async () => {
    let activeReaders = 0
    let maxActiveReaders = 0
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null
        error: DOMException | null = null
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        onabort: (() => void) | null = null

        readAsDataURL(file: File): void {
          activeReaders += 1
          maxActiveReaders = Math.max(maxActiveReaders, activeReaders)
          this.result = `data:${file.type};base64,YQ==`
          queueMicrotask(() => {
            activeReaders -= 1
            this.onload?.()
          })
        }
      }
    )

    const snapshot = await createQueuedFollowUpSnapshot({
      id: 'follow-up-sequential',
      text: 'inspect images',
      trustedContext,
      attachments: [
        fileAttachment('first', new File(['a'], 'first.png', { type: 'image/png' })),
        fileAttachment('second', new File(['b'], 'second.png', { type: 'image/png' }))
      ]
    })

    expect(snapshot.attachments).toHaveLength(2)
    expect(maxActiveReaders).toBe(1)
  })
})

function fileAttachment(id: string, file: File): Attachment {
  return {
    id,
    type: 'image' as const,
    name: file.name,
    contentType: file.type,
    file,
    content: [],
    status: { type: 'requires-action' as const, reason: 'composer-send' as const }
  }
}
