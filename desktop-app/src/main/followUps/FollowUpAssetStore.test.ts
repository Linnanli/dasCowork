import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { LocalImageCapabilityStore } from '../localImageCapabilityStore'
import { FollowUpAssetCapacityError, FollowUpAssetStore } from './FollowUpAssetStore'

describe('FollowUpAssetStore', () => {
  it('persists immutable bytes behind a relative handle and validates the checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      const transaction = await store.prepare('message-1', [
        {
          id: 'image-1',
          displayName: 'image.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('image bytes').toString('base64')
        }
      ])
      await transaction.commit()
      await transaction.finalize()

      expect(transaction.assets[0].relativePath.startsWith('/')).toBe(false)
      await expect(store.validate(transaction.assets)).resolves.toBeUndefined()
      await expect(store.materialize(transaction.assets)).resolves.toMatchObject([
        {
          displayName: 'image.png',
          dataUrl: `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`
        }
      ])
      await expect(
        readFile(join(directory, transaction.assets[0].relativePath), 'utf8')
      ).resolves.toBe('image bytes')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('isolates identical item ids owned by different conversations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      const first = await store.prepare('queue:conversation-1:shared-message', [
        {
          id: 'image-1',
          displayName: 'first.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('first').toString('base64')
        }
      ])
      await first.commit()
      await first.finalize()

      const second = await store.prepare('queue:conversation-2:shared-message', [
        {
          id: 'image-2',
          displayName: 'second.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('second').toString('base64')
        }
      ])
      await second.commit()
      await second.finalize()

      await expect(store.validate(first.assets)).resolves.toBeUndefined()
      await expect(store.validate(second.assets)).resolves.toBeUndefined()
      await store.deleteAssets(first.assets)
      await expect(store.validate(first.assets)).rejects.toThrow()
      await expect(store.validate(second.assets)).resolves.toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('transfers an existing attachment to a migrated owner only when explicitly allowed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory, {
      maxBytesPerItem: 5,
      maxTotalBytes: 5
    })

    try {
      const original = await store.prepare('queue:local-1:message-1', [
        {
          id: 'image-1',
          displayName: 'image.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('image').toString('base64')
        }
      ])
      await original.commit()
      await original.finalize()

      await expect(store.prepare('queue:thread-1:message-1', original.assets)).rejects.toThrow(
        'owned by another queue item'
      )

      const migrated = await store.prepare('queue:thread-1:message-1', original.assets, {
        allowedExistingRelativePaths: original.assets.map((asset) => asset.relativePath)
      })
      await migrated.commit()
      await migrated.finalize()
      await store.deleteAssets(original.assets)

      await expect(store.validate(migrated.assets)).resolves.toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps accepted history files readable after queue cleanup and reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      const transaction = await store.prepare('queue:conversation-1:message-1', [
        {
          id: 'image-1',
          displayName: 'image.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('history image').toString('base64')
        }
      ])
      await transaction.commit()
      await transaction.finalize()

      const [historyAsset] = await store.materializeForHistory(
        'history:conversation-1:message-1',
        transaction.assets
      )
      expect(historyAsset.fileUrl).toMatch(/^file:/u)
      expect(historyAsset.fileUrl).toMatch(/\.png$/u)

      await store.deleteAssets(transaction.assets)
      await store.reconcileReferencedAssets([])

      await expect(readFile(fileURLToPath(historyAsset.fileUrl), 'utf8')).resolves.toBe(
        'history image'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('copies a selected local image into queue-owned storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'picked-image.png')

    try {
      await writeFile(sourcePath, 'local image bytes')
      const metadata = await stat(sourcePath)
      const capabilities = new LocalImageCapabilityStore()
      const capabilityToken = capabilities.issue(sourcePath, 'image/png', {
        dev: metadata.dev,
        ino: metadata.ino,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs
      })
      const store = new FollowUpAssetStore(join(directory, 'queue'), {
        authorizeLocalImages: (requests) => capabilities.consumeAll(requests)
      })
      const input = {
        kind: 'local-image' as const,
        id: 'image-local',
        path: sourcePath,
        capabilityToken,
        previewUrl: 'app://fs/@fs/tmp/picked-image.png',
        displayName: 'picked-image.png',
        mediaType: 'image/png'
      }
      const transaction = await store.prepare('message-local-image', [input])
      await expect(store.prepare('message-local-image-replay', [input])).rejects.toThrow(
        'not authorized'
      )
      await transaction.commit()
      await transaction.finalize()

      await expect(store.materialize(transaction.assets)).resolves.toMatchObject([
        {
          id: 'image-local',
          displayName: 'picked-image.png',
          dataUrl: `data:image/png;base64,${Buffer.from('local image bytes').toString('base64')}`
        }
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a selected image whose path now resolves to a different file identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'picked-image.png')
    const movedPath = join(directory, 'original-image.png')

    try {
      await writeFile(sourcePath, 'original image bytes')
      const metadata = await stat(sourcePath)
      const capabilities = new LocalImageCapabilityStore()
      const capabilityToken = capabilities.issue(sourcePath, 'image/png', {
        dev: metadata.dev,
        ino: metadata.ino,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs
      })
      const store = new FollowUpAssetStore(join(directory, 'queue'), {
        authorizeLocalImages: (requests) => capabilities.consumeAll(requests)
      })

      await rename(sourcePath, movedPath)
      await writeFile(sourcePath, 'replacement image bytes')

      await expect(
        store.prepare('message-local-image', [
          {
            kind: 'local-image',
            id: 'image-local',
            path: sourcePath,
            capabilityToken,
            previewUrl: 'app://fs/@fs/tmp/picked-image.png',
            displayName: 'picked-image.png',
            mediaType: 'image/png'
          }
        ])
      ).rejects.toThrow('not authorized')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('checks local image size before authorizing or reading its bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'picked-image.png')
    const authorizeLocalImages = vi.fn()

    try {
      await writeFile(sourcePath, '123456')
      const store = new FollowUpAssetStore(join(directory, 'queue'), {
        maxBytesPerItem: 5,
        authorizeLocalImages
      })

      await expect(
        store.prepare('message-local-image', [
          {
            kind: 'local-image',
            id: 'image-local',
            path: sourcePath,
            capabilityToken: 'picker-token',
            previewUrl: 'app://fs/@fs/tmp/picked-image.png',
            displayName: 'picked-image.png',
            mediaType: 'image/png'
          }
        ])
      ).rejects.toMatchObject({
        code: 'item-assets-too-large'
      } satisfies Partial<FollowUpAssetCapacityError>)
      expect(authorizeLocalImages).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('closes the preflight file handle when the item capacity check fails', async () => {
    const close = vi.fn(async () => undefined)
    const readFileFromHandle = vi.fn(async () => Buffer.from('123456'))
    const openFile = vi.fn(async () => {
      return {
        stat: async () => ({
          isFile: () => true,
          dev: 1,
          ino: 2,
          size: 6,
          mtimeMs: 3
        }),
        readFile: readFileFromHandle,
        close
      } as never
    })
    const store = new FollowUpAssetStore('/tmp/follow-up-assets', {
      maxBytesPerItem: 5,
      authorizeLocalImages: vi.fn(),
      openFile
    })

    await expect(
      store.prepare('message-local-image', [
        {
          kind: 'local-image',
          id: 'image-local',
          path: '/tmp/picked-image.png',
          capabilityToken: 'picker-token',
          previewUrl: 'app://fs/@fs/tmp/picked-image.png',
          displayName: 'picked-image.png',
          mediaType: 'image/png'
        }
      ])
    ).rejects.toMatchObject({
      code: 'item-assets-too-large'
    } satisfies Partial<FollowUpAssetCapacityError>)
    expect(close).toHaveBeenCalledOnce()
    expect(readFileFromHandle).not.toHaveBeenCalled()
  })

  it('preflights all local images before consuming their capabilities as one batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const firstPath = join(directory, 'first.png')
    const secondPath = join(directory, 'second.png')

    try {
      await writeFile(firstPath, 'first')
      await writeFile(secondPath, 'second')
      const firstMetadata = await stat(firstPath)
      const capabilities = new LocalImageCapabilityStore()
      const firstToken = capabilities.issue(firstPath, 'image/png', {
        dev: firstMetadata.dev,
        ino: firstMetadata.ino,
        size: firstMetadata.size,
        mtimeMs: firstMetadata.mtimeMs
      })
      const store = new FollowUpAssetStore(join(directory, 'queue'), {
        authorizeLocalImages: (requests) => capabilities.consumeAll(requests)
      })
      const firstInput = {
        kind: 'local-image' as const,
        id: 'first-image',
        path: firstPath,
        capabilityToken: firstToken,
        previewUrl: 'app://fs/@fs/tmp/first.png',
        displayName: 'first.png',
        mediaType: 'image/png'
      }
      const invalidSecondInput = {
        kind: 'local-image' as const,
        id: 'second-image',
        path: secondPath,
        capabilityToken: 'invalid-token',
        previewUrl: 'app://fs/@fs/tmp/second.png',
        displayName: 'second.png',
        mediaType: 'image/png'
      }

      await expect(
        store.prepare('message-two-images', [firstInput, invalidSecondInput])
      ).rejects.toThrow('not authorized')
      await expect(store.prepare('message-first-image', [firstInput])).resolves.toBeDefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('checks total queue capacity before consuming a local image capability', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'picked-image.png')
    const authorizeLocalImages = vi.fn()
    const store = new FollowUpAssetStore(join(directory, 'queue'), {
      maxBytesPerItem: 10,
      maxTotalBytes: 7,
      authorizeLocalImages
    })

    try {
      const existing = await store.prepare('existing', [
        {
          id: 'existing-image',
          displayName: 'existing.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('12345').toString('base64')
        }
      ])
      await existing.commit()
      await existing.finalize()
      await writeFile(sourcePath, '123')

      await expect(
        store.prepare('new-image', [
          {
            kind: 'local-image',
            id: 'new-image',
            path: sourcePath,
            capabilityToken: 'picker-token',
            previewUrl: 'app://fs/@fs/tmp/picked-image.png',
            displayName: 'picked-image.png',
            mediaType: 'image/png'
          }
        ])
      ).rejects.toMatchObject({
        code: 'queue-assets-too-large'
      } satisfies Partial<FollowUpAssetCapacityError>)
      expect(authorizeLocalImages).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a spoofed local image path before reading it into queue storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'not-an-image.txt')
    const store = new FollowUpAssetStore(join(directory, 'queue'))

    try {
      await writeFile(sourcePath, 'not image bytes')
      await expect(
        store.prepare('message-local-image', [
          {
            kind: 'local-image',
            id: 'image-local',
            path: sourcePath,
            capabilityToken: 'picker-token',
            previewUrl: 'app://fs/@fs/tmp/not-an-image.txt',
            displayName: 'not-an-image.txt',
            mediaType: 'image/png'
          }
        ])
      ).rejects.toThrow('does not match its selected file')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rolls a replacement back to the previous asset directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      const first = await store.prepare('message-1', [
        {
          id: 'image-1',
          displayName: 'first.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('first').toString('base64')
        }
      ])
      await first.commit()
      await first.finalize()

      const replacement = await store.prepare('message-1', [
        {
          id: 'image-1',
          displayName: 'second.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('second').toString('base64')
        }
      ])
      await replacement.commit()
      await replacement.rollback()

      await expect(store.validate(first.assets)).resolves.toBeUndefined()
      await expect(readFile(join(directory, first.assets[0].relativePath), 'utf8')).resolves.toBe(
        'first'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps old queue metadata valid across a crash before the queue commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      const first = await store.prepare('message-1', [
        {
          id: 'image-1',
          displayName: 'first.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('first').toString('base64')
        }
      ])
      await first.commit()
      await first.finalize()

      const uncommittedQueueReplacement = await store.prepare('message-1', [
        {
          id: 'image-2',
          displayName: 'second.png',
          mediaType: 'image/png',
          encoding: 'base64',
          data: Buffer.from('second').toString('base64')
        }
      ])
      await uncommittedQueueReplacement.commit()

      await expect(store.validate(first.assets)).resolves.toBeUndefined()
      await store.reconcileReferencedAssets(first.assets.map((asset) => asset.relativePath))
      await expect(store.validate(first.assets)).resolves.toBeUndefined()
      await expect(store.validate(uncommittedQueueReplacement.assets)).rejects.toThrow()
      expect((await readdir(directory)).filter((entry) => !entry.startsWith('.'))).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('enforces per-item and total capacity before committing files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory, {
      maxBytesPerItem: 5,
      maxTotalBytes: 7
    })

    try {
      await expect(
        store.prepare('too-large', [
          {
            id: 'asset',
            displayName: 'large.bin',
            mediaType: 'application/octet-stream',
            encoding: 'base64',
            data: Buffer.from('123456').toString('base64')
          }
        ])
      ).rejects.toMatchObject({
        code: 'item-assets-too-large'
      } satisfies Partial<FollowUpAssetCapacityError>)

      const first = await store.prepare('first', [
        {
          id: 'asset',
          displayName: 'first.bin',
          mediaType: 'application/octet-stream',
          encoding: 'base64',
          data: Buffer.from('12345').toString('base64')
        }
      ])
      await first.commit()
      await first.finalize()

      await expect(
        store.prepare('second', [
          {
            id: 'asset',
            displayName: 'second.bin',
            mediaType: 'application/octet-stream',
            encoding: 'base64',
            data: Buffer.from('123').toString('base64')
          }
        ])
      ).rejects.toMatchObject({
        code: 'queue-assets-too-large'
      } satisfies Partial<FollowUpAssetCapacityError>)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects malformed base64 before creating a queue resource', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const store = new FollowUpAssetStore(directory)

    try {
      await expect(
        store.prepare('message-1', [
          {
            id: 'image-1',
            displayName: 'image.png',
            mediaType: 'image/png',
            encoding: 'base64',
            data: 'not base64!'
          }
        ])
      ).rejects.toThrow('not valid base64')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
