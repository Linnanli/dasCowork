import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { LocalPathCapabilityStore } from '../localPathCapabilityStore'
import { validateQueuedLocalAttachments } from './validateQueuedLocalAttachments'

describe('validateQueuedLocalAttachments', () => {
  const identity = { dev: 1, ino: 2, size: 3, mtimeMs: 4 }
  const stat = vi.fn(async () => ({
    isFile: () => true,
    isDirectory: () => false,
    ...identity
  }))

  it('rejects when the renderer path and file URL do not match', async () => {
    const capabilities = new LocalPathCapabilityStore(() => 1_000)
    const token = capabilities.issue('/tmp/picked.txt', 'file', identity)

    await expect(
      validateQueuedLocalAttachments(
        [
          {
            kind: 'file',
            path: '/tmp/picked.txt',
            label: 'picked.txt',
            fileUrl: pathToFileURL('/tmp/other.txt').href,
            capabilityToken: token
          }
        ],
        { capabilities, stat }
      )
    ).rejects.toThrow('file URL does not match')

    expect(() =>
      capabilities.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
    ).not.toThrow()
  })

  it('consumes a valid picker token and strips it before persistence', async () => {
    const capabilities = new LocalPathCapabilityStore(() => 1_000)
    const token = capabilities.issue('/tmp/picked.txt', 'file', identity)
    const attachment = {
      kind: 'file' as const,
      path: '/tmp/picked.txt',
      label: 'picked.txt',
      fileUrl: pathToFileURL('/tmp/picked.txt').href,
      capabilityToken: token
    }

    await validateQueuedLocalAttachments([attachment], { capabilities, stat })

    expect(attachment).toEqual({
      kind: 'file',
      path: '/tmp/picked.txt',
      label: 'picked.txt',
      fileUrl: pathToFileURL('/tmp/picked.txt').href
    })
    expect(() =>
      capabilities.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
    ).toThrow('not authorized')
  })

  it('continues to validate an already-authorized persisted queue attachment', async () => {
    await expect(
      validateQueuedLocalAttachments(
        [
          {
            kind: 'file',
            path: '/tmp/picked.txt',
            label: 'picked.txt',
            fileUrl: pathToFileURL('/tmp/picked.txt').href
          }
        ],
        { capabilities: new LocalPathCapabilityStore(), stat }
      )
    ).resolves.toBeUndefined()
  })
})
