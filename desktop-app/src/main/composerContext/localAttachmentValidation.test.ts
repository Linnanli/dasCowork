import { describe, expect, it, vi } from 'vitest'

import {
  validateLocalAttachments,
  validateLocalAttachmentsInLatestUserMessage
} from './localAttachmentValidation'

describe('validateLocalAttachments', () => {
  it('checks absolute paths, existence and the expected entry kind independently', async () => {
    const stat = vi.fn(async (path: string) => {
      if (path === '/repo/file.txt') return { isFile: () => true, isDirectory: () => false }
      if (path === '/repo/folder') return { isFile: () => false, isDirectory: () => true }
      throw new Error('missing')
    })

    const result = await validateLocalAttachments(
      {
        version: 1,
        references: [
          {
            kind: 'file',
            path: '/repo/file.txt',
            fileUrl: 'file:///repo/file.txt',
            label: 'file.txt'
          },
          {
            kind: 'folder',
            path: '/repo/folder',
            fileUrl: 'file:///repo/folder',
            label: 'folder'
          },
          {
            kind: 'folder',
            path: '/repo/file.txt',
            fileUrl: 'file:///repo/file.txt',
            label: 'wrong'
          },
          {
            kind: 'file',
            path: '/repo/missing.txt',
            fileUrl: 'file:///repo/missing.txt',
            label: 'missing.txt'
          },
          {
            kind: 'file',
            path: 'relative.txt',
            fileUrl: 'file:///repo/relative.txt',
            label: 'relative.txt'
          },
          {
            kind: 'file',
            path: '/repo/file.txt',
            fileUrl: 'file:///repo/other.txt',
            label: 'mismatch.txt'
          }
        ]
      },
      { stat }
    )

    expect(result.valid).toBe(false)
    expect(result.entries.map(({ valid, error }) => ({ valid, error }))).toEqual([
      { valid: true, error: undefined },
      { valid: true, error: undefined },
      { valid: false, error: 'expected a folder' },
      { valid: false, error: 'path does not exist or is not readable' },
      { valid: false, error: 'path must be an absolute local path' },
      { valid: false, error: 'file URL does not match the local path' }
    ])
    expect(stat).toHaveBeenCalledTimes(4)
  })

  it('revalidates vendor file parts from the latest user message at the chat boundary', async () => {
    const stat = vi.fn(async (path: string) => {
      if (path === '/repo/current.txt') return { isFile: () => true, isDirectory: () => false }
      throw new Error('missing')
    })

    await expect(
      validateLocalAttachmentsInLatestUserMessage(
        [
          {
            id: 'old-user',
            role: 'user',
            parts: [
              {
                type: 'file',
                mediaType: 'application/vnd.dascowork.local-file',
                filename: 'old.txt',
                url: 'file:///repo/old.txt'
              }
            ]
          },
          {
            id: 'current-user',
            role: 'user',
            parts: [
              {
                type: 'file',
                mediaType: 'application/vnd.dascowork.local-file',
                filename: 'current.txt',
                url: 'file:///repo/current.txt'
              }
            ]
          }
        ],
        { stat }
      )
    ).resolves.toBe(1)
    expect(stat).toHaveBeenCalledOnce()
    expect(stat).toHaveBeenCalledWith('/repo/current.txt')
  })

  it('rejects a vendor attachment that bypasses the picker without a file URL', async () => {
    await expect(
      validateLocalAttachmentsInLatestUserMessage([
        {
          id: 'user',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType: 'application/vnd.dascowork.local-file',
              filename: 'forged.txt',
              url: ''
            }
          ]
        }
      ])
    ).rejects.toThrow('file URL is invalid')
  })
})
