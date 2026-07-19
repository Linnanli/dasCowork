import { describe, expect, it } from 'vitest'

import { LocalPathCapabilityStore } from './localPathCapabilityStore'

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

  it('does not consume a token when path, kind, or file identity differs', () => {
    const store = new LocalPathCapabilityStore(() => 1_000)
    const token = store.issue('/tmp/picked.txt', 'file', identity)

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
    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.txt', kind: 'file', identity }])
    ).not.toThrow()
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
