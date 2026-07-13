import { describe, expect, it, vi } from 'vitest'

import { createPickLocalContextHandler, pickLocalContext } from './localContextPicker'

describe('localContextPicker', () => {
  it('uses one picker and returns unique existing files and folders', async () => {
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
    await expect(pickLocalContext({ showOpenDialog, stat }, 'filesAndFolders')).resolves.toEqual([
      { kind: 'file', path: '/tmp/report.md', label: 'report.md' },
      {
        kind: 'image',
        path: '/tmp/photo.png',
        label: 'photo.png',
        mediaType: 'image/png',
        previewUrl: 'app://fs/@fs/tmp/photo.png'
      },
      { kind: 'folder', path: '/tmp/folder', label: 'folder' }
    ])
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    expect(stat).toHaveBeenCalledTimes(4)
  })

  it('uses a file-only picker when the platform cannot combine both kinds', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/tmp/report.md', '/tmp/folder']
    }))
    const stat = vi.fn(async (path: string) => ({
      isFile: () => path === '/tmp/report.md',
      isDirectory: () => path === '/tmp/folder'
    }))

    await expect(
      pickLocalContext(
        {
          choosePickerKind: async () => 'files',
          showOpenDialog,
          stat
        },
        'filesAndFolders'
      )
    ).resolves.toEqual([{ kind: 'file', path: '/tmp/report.md', label: 'report.md' }])
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections']
    })
  })

  it('does not open a picker when the platform kind prompt is cancelled', async () => {
    const showOpenDialog = vi.fn()

    await expect(
      pickLocalContext(
        {
          choosePickerKind: async () => null,
          showOpenDialog,
          stat: vi.fn()
        },
        'filesAndFolders'
      )
    ).resolves.toEqual([])
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('returns no references when the dialog is cancelled', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/tmp/report.md'] }))
    const stat = vi.fn()

    await expect(pickLocalContext({ showOpenDialog, stat }, 'filesAndFolders')).resolves.toEqual([])
    expect(stat).not.toHaveBeenCalled()
  })

  it('rejects malformed renderer payloads before opening a dialog', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [] }))
    const handler = createPickLocalContextHandler({
      showOpenDialog,
      stat: vi.fn()
    })

    await expect(handler(undefined, { kind: 'files' })).rejects.toThrow()
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
        'filesAndFolders'
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
        'filesAndFolders'
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
