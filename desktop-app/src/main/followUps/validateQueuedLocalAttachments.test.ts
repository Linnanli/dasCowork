import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  createVitestPlanAssertionRecorder,
  planAssertionsForScenarios
} from '../../../scripts/lib/test-plan-assertions.mjs'

import { LocalPathCapabilityStore } from '../localPathCapabilityStore'
import { validateQueuedLocalAttachments } from './validateQueuedLocalAttachments'

const { planAssert } = createVitestPlanAssertionRecorder(expect)

describe('validateQueuedLocalAttachments', () => {
  const identity = { dev: 1, ino: 2, size: 3, mtimeMs: 4 }
  const stat = vi.fn(async () => ({
    isFile: () => true,
    isDirectory: () => false,
    ...identity
  }))

  it('E20/G03 rejects when the renderer path and file URL do not match', async () => {
    const capabilities = new LocalPathCapabilityStore(() => 1_000)
    const token = capabilities.issue('/tmp/picked.txt', 'file', identity)
    const validateAttachments = validateQueuedLocalAttachments(
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
    const record = planAssertionsForScenarios(['G03'], planAssert)

    await record('跨对话与信任边界隔离', async () => {
      await expect(validateAttachments).rejects.toThrow('file URL does not match')
    })

    await record('资源、并发和终态无残留', () => {
      expect(() =>
        capabilities.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
      ).not.toThrow()
    })

    await record('诊断可关联而不泄露密钥', async () => {
      await expect(validateAttachments).rejects.toThrow('file URL does not match')
      await expect(validateAttachments).rejects.not.toThrow(token)
    })
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

  it('E20 continues to validate an already-authorized persisted queue attachment', async () => {
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
