import { describe, expect, it } from 'vitest'

import {
  createVitestPlanAssertionRecorder,
  planAssertionsForScenarios
} from '../../scripts/lib/test-plan-assertions.mjs'

import { LocalPathCapabilityStore } from './localPathCapabilityStore'

const { planAssert } = createVitestPlanAssertionRecorder(expect)

describe('LocalPathCapabilityStore', () => {
  const identity = { dev: 1, ino: 2, size: 3, mtimeMs: 4 }

  it('binds and consumes a picker token for one local path', () => {
    const store = new LocalPathCapabilityStore(() => 1_000)
    const token = store.issue('/tmp/picked.txt', 'file', identity)

    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
    ).not.toThrow()
    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
    ).toThrow('not authorized')
  })

  it('G04 rejects path, kind, and changed file identity mismatches without consuming the token', async () => {
    const store = new LocalPathCapabilityStore(() => 1_000)
    const token = store.issue('/tmp/picked.txt', 'file', identity)
    const record = planAssertionsForScenarios(['G04'], planAssert)

    await record('跨对话与信任边界隔离', () => {
      expect(() =>
        store.consumeAll([{ token, path: '/tmp/other.txt', kind: 'file', identity }])
      ).toThrow('not authorized')
      expect(() =>
        store.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'folder', identity }])
      ).toThrow('not authorized')
      expect(() =>
        store.consumeAll([
          {
            token,
            path: '/tmp/picked.txt',
            kind: 'file',
            identity: { ...identity, ino: 99 }
          }
        ])
      ).toThrow('not authorized')
    })
    await record('诊断可关联而不泄露密钥', () => {
      const rejectedMismatch = (): void =>
        store.consumeAll([{ token, path: '/tmp/other.txt', kind: 'file', identity }])
      expect(rejectedMismatch).toThrow('not authorized')
      expect(rejectedMismatch).not.toThrow(token)
      expect(rejectedMismatch).not.toThrow('/tmp/picked.txt')
    })
    await record('资源、并发和终态无残留', () => {
      expect(() =>
        store.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
      ).not.toThrow()
    })
  })

  it('validates a batch before consuming any token', () => {
    const store = new LocalPathCapabilityStore(() => 1_000)
    const firstToken = store.issue('/tmp/first.txt', 'file', identity)
    const secondIdentity = { ...identity, ino: 3 }
    const secondToken = store.issue('/tmp/folder', 'folder', secondIdentity)

    expect(() =>
      store.consumeAll([
        { token: firstToken, path: '/tmp/first.txt', kind: 'file', identity },
        { token: secondToken, path: '/tmp/wrong', kind: 'folder', identity: secondIdentity }
      ])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([
        { token: firstToken, path: '/tmp/first.txt', kind: 'file', identity },
        { token: secondToken, path: '/tmp/folder', kind: 'folder', identity: secondIdentity }
      ])
    ).not.toThrow()
  })
})
