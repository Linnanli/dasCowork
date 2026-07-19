// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLocalImageAttachment,
  createLocalPathAttachment,
  imageAttachmentAdapter,
  localFileAttachmentMediaType,
  localFolderAttachmentMediaType,
  localPathAttachmentIdentityFromId,
  readFileAsDataUrl
} from './imageAttachmentAdapter'

describe('imageAttachmentAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a completed image attachment from a local media URL', () => {
    expect(
      createLocalImageAttachment({
        label: 'diagram.png',
        mediaType: 'image/png',
        previewUrl: 'app://fs/@fs/tmp/diagram.png'
      })
    ).toEqual({
      type: 'image',
      name: 'diagram.png',
      contentType: 'image/png',
      content: [
        {
          type: 'file',
          filename: 'diagram.png',
          mimeType: 'image/png',
          data: 'app://fs/@fs/tmp/diagram.png'
        }
      ]
    })
  })

  it('accepts images and path-backed local references while keeping images pending', async () => {
    const file = new File(['photo'], 'photo.webp', { type: 'image/webp' })
    const attachment = await imageAttachmentAdapter.add({ file })

    expect(imageAttachmentAdapter.accept).toBe(
      `image/*,${localFileAttachmentMediaType},${localFolderAttachmentMediaType}`
    )
    expect(attachment).toMatchObject({
      type: 'image',
      name: 'photo.webp',
      contentType: 'image/webp',
      file,
      status: { type: 'requires-action', reason: 'composer-send' }
    })
  })

  it('creates a completed local folder attachment without reading the folder bytes', () => {
    const attachment = createLocalPathAttachment({
      capabilityToken: 'folder-picker-token',
      kind: 'folder',
      path: '/repo/docs',
      fileUrl: 'file:///repo/docs',
      label: 'docs'
    })

    expect(localPathAttachmentIdentityFromId(attachment.id ?? '')).toEqual({
      capabilityToken: 'folder-picker-token',
      kind: 'folder',
      path: '/repo/docs',
      fileUrl: 'file:///repo/docs'
    })
    expect(attachment).toMatchObject({
      type: 'file',
      content: [
        {
          type: 'file',
          filename: 'docs',
          mimeType: localFolderAttachmentMediaType,
          data: 'file:///repo/docs'
        }
      ]
    })
  })

  it('creates an AI SDK file part with the original MIME type and filename', async () => {
    const file = new File(['jpeg'], 'camera.jpg', { type: 'image/jpeg' })
    const pending = await imageAttachmentAdapter.add({ file })

    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/jpeg;base64,anBlZw=='
        error: DOMException | null = null
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        onabort: (() => void) | null = null

        readAsDataURL(): void {
          this.onload?.()
        }
      }
    )

    const complete = await imageAttachmentAdapter.send(pending)

    expect(complete).toMatchObject({
      type: 'image',
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          filename: 'camera.jpg',
          mimeType: 'image/jpeg',
          data: 'data:image/jpeg;base64,anBlZw=='
        }
      ]
    })
  })

  it('rejects when FileReader cannot read a selected image', async () => {
    const file = new File(['bad'], 'bad.png', { type: 'image/png' })
    const failure = new DOMException('read failed')
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null
        error = failure
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        onabort: (() => void) | null = null

        readAsDataURL(): void {
          this.onerror?.()
        }
      }
    )

    await expect(readFileAsDataUrl(file)).rejects.toThrow('read failed')
  })
})
