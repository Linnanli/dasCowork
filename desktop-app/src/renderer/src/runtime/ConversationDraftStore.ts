const draftStorageKey = 'das-cowork.conversation-drafts.v1'

type DraftStoragePayload = {
  version: 1
  drafts: Record<string, string>
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export class ConversationDraftStore {
  private readonly storage: StorageLike | undefined
  private drafts: Record<string, string>

  constructor(storage: StorageLike | undefined = safeLocalStorage()) {
    this.storage = storage
    this.drafts = readDrafts(storage)
  }

  get(identity: string): string {
    return this.drafts[identity] ?? ''
  }

  set(identity: string, draft: string): void {
    if (draft.length === 0) {
      if (!(identity in this.drafts)) return
      const nextDrafts = { ...this.drafts }
      delete nextDrafts[identity]
      this.drafts = nextDrafts
    } else {
      if (this.drafts[identity] === draft) return
      this.drafts = { ...this.drafts, [identity]: draft }
    }
    this.persist()
  }

  migrate(fromIdentity: string, toIdentity: string): string {
    if (fromIdentity === toIdentity) return this.get(toIdentity)

    const sourceDraft = this.drafts[fromIdentity]
    const targetDraft = this.drafts[toIdentity]
    if (sourceDraft === undefined) return targetDraft ?? ''

    const nextDrafts = { ...this.drafts }
    delete nextDrafts[fromIdentity]
    if (targetDraft === undefined) nextDrafts[toIdentity] = sourceDraft
    this.drafts = nextDrafts
    this.persist()
    return nextDrafts[toIdentity] ?? ''
  }

  private persist(): void {
    if (!this.storage) return
    const payload: DraftStoragePayload = { version: 1, drafts: this.drafts }
    try {
      this.storage.setItem(draftStorageKey, JSON.stringify(payload))
    } catch {
      // Draft persistence is best effort and must never block the chat runtime.
    }
  }
}

function readDrafts(storage: StorageLike | undefined): Record<string, string> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(draftStorageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<DraftStoragePayload>
    if (parsed.version !== 1 || !isDraftRecord(parsed.drafts)) return {}
    return { ...parsed.drafts }
  } catch {
    return {}
  }
}

function isDraftRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((draft) => typeof draft === 'string')
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const conversationDraftStorageKey = draftStorageKey
