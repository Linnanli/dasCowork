import { describe, expect, it, vi } from 'vitest'

import { createPickLocalContextHandler, pickLocalContext } from './localContextPicker'

describe('localContextPicker', () => {
  it('uses a file picker and returns unique existing files', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [
        '/tmp/report.md',
        '/tmp/photo.png',
        '/tmp/report.md',
        '/tmp/folder',
        '/tmp/missing.md'
      ]
    }))
    const stat = vi.fn(async (path: string) => {
      if (path === '/tmp/missing.md') {
        const error = new Error('not found') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return {
        isFile: () => path === '/tmp/report.md' || path === '/tmp/photo.png',
        isDirectory: () => path === '/tmp/folder'
      }
    })
    await expect(pickLocalContext({ showOpenDialog, stat }, 'files')).resolves.toEqual([
      { kind: 'file', path: '/tmp/report.md', label: 'report.md' },
      {
        kind: 'image',
        path: '/tmp/photo.png',
        label: 'photo.png',
        mediaType: 'image/png',
        previewUrl: 'app://fs/@fs/tmp/photo.png'
      }
    ])
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections']
    })
    expect(stat).toHaveBeenCalledTimes(4)
  })

  it('uses a directory picker and ignores files returned by the dialog', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/tmp/folder', '/tmp/report.md']
    }))
    const stat = vi.fn(async (path: string) => ({
      isFile: () => path === '/tmp/report.md',
      isDirectory: () => path === '/tmp/folder'
    }))

    await expect(pickLocalContext({ showOpenDialog, stat }, 'folders')).resolves.toEqual([
      { kind: 'folder', path: '/tmp/folder', label: 'folder' }
    ])
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'multiSelections']
    })
  })

  it('returns no references when the dialog is cancelled', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/tmp/report.md'] }))
    const stat = vi.fn()

    await expect(pickLocalContext({ showOpenDialog, stat }, 'files')).resolves.toEqual([])
    expect(stat).not.toHaveBeenCalled()
  })

  it('rejects malformed renderer payloads before opening a dialog', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [] }))
    const handler = createPickLocalContextHandler({
      showOpenDialog,
      stat: vi.fn()
    })

    await expect(handler(undefined, { kind: 'both' })).rejects.toThrow()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('surfaces unexpected stat failures with a displayable error', async () => {
    await expect(
      pickLocalContext(
        {
          showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/report.md'] }),
          stat: async () => {
            const error = new Error('permission denied') as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
        },
        'files'
      )
    ).rejects.toThrow('Unable to inspect selected path: permission denied')
  })

  it('returns a local media URL without reading the selected image bytes', async () => {
    await expect(
      pickLocalContext(
        {
          showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/photo.png'] }),
          stat: async () => ({ isFile: () => true, isDirectory: () => false })
        },
        'files'
      )
    ).resolves.toEqual([
      {
        kind: 'image',
        path: '/tmp/photo.png',
        label: 'photo.png',
        mediaType: 'image/png',
        previewUrl: 'app://fs/@fs/tmp/photo.png'
      }
    ])
  })
})
