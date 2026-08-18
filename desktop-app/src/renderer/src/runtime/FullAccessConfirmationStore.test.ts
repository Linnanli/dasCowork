import { describe, expect, it } from 'vitest'

import {
  FullAccessConfirmationStore,
  fullAccessConfirmationStoreKey
} from './FullAccessConfirmationStore'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('FullAccessConfirmationStore', () => {
  it('defaults to unconfirmed and persists a versioned confirmation', () => {
    const storage = new MemoryStorage()
    const store = new FullAccessConfirmationStore(storage)

    expect(store.hasConfirmed()).toBe(false)
    store.confirm()

    expect(new FullAccessConfirmationStore(storage).hasConfirmed()).toBe(true)
    expect(JSON.parse(storage.getItem(fullAccessConfirmationStoreKey) ?? '{}')).toEqual({
      version: 1,
      confirmed: true
    })
  })

  it('ignores malformed and stale stored values', () => {
    const storage = new MemoryStorage()
    storage.setItem(fullAccessConfirmationStoreKey, '{bad json')
    expect(new FullAccessConfirmationStore(storage).hasConfirmed()).toBe(false)

    storage.setItem(fullAccessConfirmationStoreKey, JSON.stringify({ version: 2, confirmed: true }))
    expect(new FullAccessConfirmationStore(storage).hasConfirmed()).toBe(false)
  })
})
