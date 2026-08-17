import { describe, expect, it } from 'vitest'

import {
  ConversationDraftStore,
  conversationDraftStorageKey,
  legacyConversationDraftStorageKey,
  previousConversationDraftStorageKey
} from './ConversationDraftStore'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('ConversationDraftStore', () => {
  it('restores versioned drafts across store instances', () => {
    const storage = new MemoryStorage()
    new ConversationDraftStore(storage).set('thread-a', 'draft A')

    expect(new ConversationDraftStore(storage).get('thread-a')).toBe('draft A')
  })

  it('restores path-backed attachments without storing file bytes', () => {
    const storage = new MemoryStorage()
    const store = new ConversationDraftStore(storage)
    store.setAttachments('thread-a', [
      {
        capabilityToken: 'folder-picker-token',
        kind: 'folder',
        path: '/repo/docs',
        label: 'docs',
        fileUrl: 'file:///repo/docs'
      }
    ])

    expect(new ConversationDraftStore(storage).getAttachments('thread-a')).toEqual([
      {
        capabilityToken: 'folder-picker-token',
        kind: 'folder',
        path: '/repo/docs',
        label: 'docs',
        fileUrl: 'file:///repo/docs'
      }
    ])
    expect(storage.getItem(conversationDraftStorageKey)).not.toContain('file contents')
  })

  it('migrates legacy text-only drafts into the v3 in-memory shape', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      legacyConversationDraftStorageKey,
      JSON.stringify({ version: 1, drafts: { 'thread-a': 'legacy draft' } })
    )

    const store = new ConversationDraftStore(storage)
    expect(store.get('thread-a')).toBe('legacy draft')
    expect(store.getAttachments('thread-a')).toEqual([])
    expect(store.getComposerModeKind('thread-a')).toBe('default')
  })

  it('migrates v2 drafts with the default composer mode', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      previousConversationDraftStorageKey,
      JSON.stringify({
        version: 2,
        drafts: {
          'thread-a': {
            text: 'existing draft',
            attachments: []
          }
        }
      })
    )

    const store = new ConversationDraftStore(storage)

    expect(store.get('thread-a')).toBe('existing draft')
    expect(store.getComposerModeKind('thread-a')).toBe('default')
  })

  it('persists plan mode even when the draft is empty', () => {
    const storage = new MemoryStorage()
    const store = new ConversationDraftStore(storage)
    store.setComposerModeKind('thread-a', 'plan')

    expect(new ConversationDraftStore(storage).getComposerModeKind('thread-a')).toBe('plan')

    store.setComposerModeKind('thread-a', 'default')
    expect(storage.getItem(conversationDraftStorageKey)).not.toContain('thread-a')
  })

  it('migrates a local draft to the bound thread and removes the local key', () => {
    const storage = new MemoryStorage()
    const store = new ConversationDraftStore(storage)
    store.set('local-a', 'draft A')

    expect(store.migrate('local-a', 'thread-a')).toBe('draft A')
    expect(store.get('local-a')).toBe('')
    expect(store.get('thread-a')).toBe('draft A')
  })

  it('keeps an existing stable-thread draft when migration keys conflict', () => {
    const storage = new MemoryStorage()
    const store = new ConversationDraftStore(storage)
    store.set('local-a', 'temporary draft')
    store.set('thread-a', 'stable draft')

    expect(store.migrate('local-a', 'thread-a')).toBe('stable draft')
    expect(store.get('local-a')).toBe('')
  })

  it('ignores corrupted and unknown-version storage payloads', () => {
    const corrupted = new MemoryStorage()
    corrupted.setItem(conversationDraftStorageKey, '{bad json')
    expect(new ConversationDraftStore(corrupted).get('thread-a')).toBe('')

    const unknownVersion = new MemoryStorage()
    unknownVersion.setItem(
      conversationDraftStorageKey,
      JSON.stringify({ version: 2, drafts: { 'thread-a': 'old format' } })
    )
    expect(new ConversationDraftStore(unknownVersion).get('thread-a')).toBe('')
  })

  it('keeps drafts in memory when storage access fails', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage denied')
      },
      setItem: () => {
        throw new Error('quota exceeded')
      }
    }
    const store = new ConversationDraftStore(storage)

    expect(() => store.set('thread-a', 'draft A')).not.toThrow()
    expect(store.get('thread-a')).toBe('draft A')
  })
})
