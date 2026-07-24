import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  createVitestPlanAssertionRecorder,
  planAssertionsForScenarios
} from '../../../scripts/lib/test-plan-assertions.mjs'

import { LocalImageCapabilityStore } from '../localImageCapabilityStore'
import type { FollowUpAssetInput } from '../../shared/codexFollowUpApi'
import { FollowUpAssetCapacityError, FollowUpAssetStore } from './FollowUpAssetStore'

const { planAssert } = createVitestPlanAssertionRecorder(expect)

const queueAssertionIds = [
  '队列顺序、revision、lease 与消费状态正确',
  '重启从持久化状态恢复',
  '不能重复 claim 或自动重发'
]

async function assertQueuePlanEvidence(
  scenarioIds: readonly string[],
  assertion: () => void | Promise<void>
): Promise<void> {
  const record = planAssertionsForScenarios(scenarioIds, planAssert)
  for (const assertionId of queueAssertionIds) {
    await record(assertionId, assertion)
  }
}

describe('FollowUpAssetStore', () => {
  it('E20 persists immutable bytes behind a relative handle and validates the checksum', async () => {
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

      await assertQueuePlanEvidence(['E20'], async () => {
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
      })
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

  it('E21 transfers an existing attachment to a migrated owner only when explicitly allowed', async () => {
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

  it('E20/G04 rejects a selected image whose path now resolves to a different file identity', async () => {
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

      const rejectedPreparation = store.prepare('message-local-image', [
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
      const rejectionMessage = await rejectedPreparation.then(
        () => '',
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      )
      const recordG04 = planAssertionsForScenarios(['G04'], planAssert)
      await recordG04('跨对话与信任边界隔离', () => {
        expect(rejectionMessage).toContain('not authorized')
      })
      await recordG04('资源、并发和终态无残留', () => {
        expect(() =>
          capabilities.consumeAll([
            {
              token: capabilityToken,
              path: sourcePath,
              mediaType: 'image/png',
              identity: {
                dev: metadata.dev,
                ino: metadata.ino,
                size: metadata.size,
                mtimeMs: metadata.mtimeMs
              }
            }
          ])
        ).not.toThrow()
      })
      await recordG04('诊断可关联而不泄露密钥', () => {
        expect(rejectionMessage).not.toContain(capabilityToken)
        expect(rejectionMessage).not.toContain(sourcePath)
      })
      await assertQueuePlanEvidence(['E20'], () => {
        expect(rejectionMessage).toContain('not authorized')
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('E20/E25 checks local image size before authorizing or reading its bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
    const sourcePath = join(directory, 'picked-image.png')
    const authorizeLocalImages = vi.fn()

    try {
      await writeFile(sourcePath, '123456')
      const store = new FollowUpAssetStore(join(directory, 'queue'), {
        maxBytesPerItem: 5,
        authorizeLocalImages
      })

      const rejectedPreparation = store.prepare('message-local-image', [
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
      await assertQueuePlanEvidence(['E20', 'E25'], async () => {
        await expect(rejectedPreparation).rejects.toMatchObject({
          code: 'item-assets-too-large'
        } satisfies Partial<FollowUpAssetCapacityError>)
        expect(authorizeLocalImages).not.toHaveBeenCalled()
      })
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

  it('E20/E25 checks total queue capacity before consuming a local image capability', async () => {
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

      const rejectedPreparation = store.prepare('new-image', [
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
      await assertQueuePlanEvidence(['E20', 'E25'], async () => {
        await expect(rejectedPreparation).rejects.toMatchObject({
          code: 'queue-assets-too-large'
        } satisfies Partial<FollowUpAssetCapacityError>)
        expect(authorizeLocalImages).not.toHaveBeenCalled()
      })
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

  it.each([
    ['limit - 1', 4, true],
    ['limit', 5, true],
    ['limit + 1', 6, false]
  ] as const)(
    'E25 enforces the single-attachment capacity at %s',
    async (_boundary, sizeBytes, accepted) => {
      const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
      const store = new FollowUpAssetStore(directory, {
        maxBytesPerItem: 5,
        maxTotalBytes: 20
      })

      try {
        const preparation = store.prepare('single-asset', [inlineAsset('asset', sizeBytes)])
        if (!accepted) {
          await expect(preparation).rejects.toMatchObject({
            code: 'item-assets-too-large'
          } satisfies Partial<FollowUpAssetCapacityError>)
          return
        }

        const transaction = await preparation
        expect(transaction.assets).toHaveLength(1)
        expect(transaction.assets[0].sizeBytes).toBe(sizeBytes)
        await transaction.rollback()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it.each([
    ['limit - 1', 2, true],
    ['limit', 3, true],
    ['limit + 1', 4, false]
  ] as const)(
    'E25 enforces the aggregate per-item capacity at %s',
    async (_boundary, secondSizeBytes, accepted) => {
      const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
      const store = new FollowUpAssetStore(directory, {
        maxBytesPerItem: 5,
        maxTotalBytes: 20
      })

      try {
        const preparation = store.prepare('aggregate-item', [
          inlineAsset('first', 2),
          inlineAsset('second', secondSizeBytes)
        ])
        if (!accepted) {
          await expect(preparation).rejects.toMatchObject({
            code: 'item-assets-too-large'
          } satisfies Partial<FollowUpAssetCapacityError>)
          return
        }

        const transaction = await preparation
        expect(transaction.assets.reduce((total, asset) => total + asset.sizeBytes, 0)).toBe(
          2 + secondSizeBytes
        )
        await transaction.rollback()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it.each([
    ['limit - 1', 3, true],
    ['limit', 4, true],
    ['limit + 1', 5, false]
  ] as const)(
    'E25 enforces total queue asset capacity at %s',
    async (_boundary, secondSizeBytes, accepted) => {
      const directory = await mkdtemp(join(tmpdir(), 'follow-up-assets-'))
      const store = new FollowUpAssetStore(directory, {
        maxBytesPerItem: 7,
        maxTotalBytes: 7
      })

      try {
        const first = await store.prepare('first', [inlineAsset('first', 3)])
        await first.commit()
        await first.finalize()

        const preparation = store.prepare('second', [inlineAsset('second', secondSizeBytes)])
        if (!accepted) {
          await expect(preparation).rejects.toMatchObject({
            code: 'queue-assets-too-large'
          } satisfies Partial<FollowUpAssetCapacityError>)
          return
        }

        const transaction = await preparation
        expect(transaction.assets[0].sizeBytes).toBe(secondSizeBytes)
        await transaction.rollback()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

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

function inlineAsset(id: string, sizeBytes: number): FollowUpAssetInput {
  return {
    id,
    displayName: `${id}.bin`,
    mediaType: 'application/octet-stream',
    encoding: 'base64' as const,
    data: Buffer.alloc(sizeBytes, id.charCodeAt(0)).toString('base64')
  }
}
