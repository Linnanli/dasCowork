import { describe, expect, it } from 'vitest'

import { LocalImageCapabilityStore } from './localImageCapabilityStore'

describe('LocalImageCapabilityStore', () => {
  const identity = { dev: 1, ino: 2, size: 3, mtimeMs: 4 }

  it('binds an opaque picker token to one path and media type, then consumes it', () => {
    const store = new LocalImageCapabilityStore(() => 1_000)
    const token = store.issue('/tmp/picked.png', 'image/png', identity)

    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.png', mediaType: 'image/png', identity }])
    ).not.toThrow()
    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.png', mediaType: 'image/png', identity }])
    ).toThrow('not authorized')
  })

  it('does not consume a token when its path or media type does not match', () => {
    const store = new LocalImageCapabilityStore(() => 1_000)
    const token = store.issue('/tmp/picked.png', 'image/png', identity)

    expect(() =>
      store.consumeAll([{ token, path: '/tmp/other.png', mediaType: 'image/png', identity }])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.png', mediaType: 'image/jpeg', identity }])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([
        {
          token,
          path: '/tmp/picked.png',
          mediaType: 'image/png',
          identity: { ...identity, ino: 99 }
        }
      ])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.png', mediaType: 'image/png', identity }])
    ).not.toThrow()
  })

  it('validates a batch atomically and rejects duplicate consumption', () => {
    const store = new LocalImageCapabilityStore(() => 1_000)
    const firstToken = store.issue('/tmp/first.png', 'image/png', identity)
    const secondIdentity = { ...identity, ino: 3 }
    const secondToken = store.issue('/tmp/second.png', 'image/png', secondIdentity)

    expect(() =>
      store.consumeAll([
        { token: firstToken, path: '/tmp/first.png', mediaType: 'image/png', identity },
        {
          token: secondToken,
          path: '/tmp/wrong.png',
          mediaType: 'image/png',
          identity: secondIdentity
        }
      ])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([
        { token: firstToken, path: '/tmp/first.png', mediaType: 'image/png', identity },
        { token: firstToken, path: '/tmp/first.png', mediaType: 'image/png', identity }
      ])
    ).toThrow('not authorized')
    expect(() =>
      store.consumeAll([
        { token: firstToken, path: '/tmp/first.png', mediaType: 'image/png', identity },
        {
          token: secondToken,
          path: '/tmp/second.png',
          mediaType: 'image/png',
          identity: secondIdentity
        }
      ])
    ).not.toThrow()
  })

  it('expires picker capabilities', () => {
    let now = 1_000
    const store = new LocalImageCapabilityStore(() => now, 100)
    const token = store.issue('/tmp/picked.png', 'image/png', identity)

    now = 1_101

    expect(() =>
      store.consumeAll([{ token, path: '/tmp/picked.png', mediaType: 'image/png', identity }])
    ).toThrow('not authorized')
  })
})
