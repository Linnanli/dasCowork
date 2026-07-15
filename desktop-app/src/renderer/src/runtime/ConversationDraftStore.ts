const draftStorageKey = 'das-cowork.conversation-drafts.v2'
const legacyDraftStorageKey = 'das-cowork.conversation-drafts.v1'

export type ConversationDraftAttachment = {
  fileUrl: string
  kind: 'file' | 'folder'
  label: string
  path: string
}

type ConversationDraftRecord = {
  attachments: ConversationDraftAttachment[]
  text: string
}

type DraftStoragePayload = {
  version: 2
  drafts: Record<string, ConversationDraftRecord>
}

type LegacyDraftStoragePayload = {
  version: 1
  drafts: Record<string, string>
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export class ConversationDraftStore {
  private readonly storage: StorageLike | undefined
  private drafts: Record<string, ConversationDraftRecord>

  constructor(storage: StorageLike | undefined = safeLocalStorage()) {
    this.storage = storage
    this.drafts = readDrafts(storage)
  }

  get(identity: string): string {
    return this.drafts[identity]?.text ?? ''
  }

  getAttachments(identity: string): readonly ConversationDraftAttachment[] {
    return this.drafts[identity]?.attachments ?? []
  }

  set(identity: string, text: string): void {
    const current = this.drafts[identity]
    this.setRecord(identity, {
      text,
      attachments: current?.attachments ?? []
    })
  }

  setAttachments(identity: string, attachments: readonly ConversationDraftAttachment[]): void {
    const current = this.drafts[identity]
    this.setRecord(identity, {
      text: current?.text ?? '',
      attachments: dedupeAttachments(attachments)
    })
  }

  clear(identity: string): void {
    if (!(identity in this.drafts)) return
    const nextDrafts = { ...this.drafts }
    delete nextDrafts[identity]
    this.drafts = nextDrafts
    this.persist()
  }

  migrate(fromIdentity: string, toIdentity: string): string {
    if (fromIdentity === toIdentity) return this.get(toIdentity)

    const sourceDraft = this.drafts[fromIdentity]
    const targetDraft = this.drafts[toIdentity]
    if (sourceDraft === undefined) return targetDraft?.text ?? ''

    const nextDrafts = { ...this.drafts }
    delete nextDrafts[fromIdentity]
    if (targetDraft === undefined) nextDrafts[toIdentity] = sourceDraft
    this.drafts = nextDrafts
    this.persist()
    return nextDrafts[toIdentity]?.text ?? ''
  }

  private setRecord(identity: string, record: ConversationDraftRecord): void {
    const current = this.drafts[identity]
    if (record.text.length === 0 && record.attachments.length === 0) {
      this.clear(identity)
      return
    }
    if (current && sameRecord(current, record)) return
    this.drafts = { ...this.drafts, [identity]: record }
    this.persist()
  }

  private persist(): void {
    if (!this.storage) return
    const payload: DraftStoragePayload = { version: 2, drafts: this.drafts }
    try {
      this.storage.setItem(draftStorageKey, JSON.stringify(payload))
    } catch {
      // Draft persistence is best effort and must never block the chat runtime.
    }
  }
}

function readDrafts(storage: StorageLike | undefined): Record<string, ConversationDraftRecord> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(draftStorageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DraftStoragePayload>
      if (parsed.version === 2 && isDraftRecordMap(parsed.drafts)) return cloneDrafts(parsed.drafts)
    }

    const legacyRaw = storage.getItem(legacyDraftStorageKey)
    if (!legacyRaw) return {}
    const legacy = JSON.parse(legacyRaw) as Partial<LegacyDraftStoragePayload>
    if (legacy.version !== 1 || !isLegacyDraftRecord(legacy.drafts)) return {}
    return Object.fromEntries(
      Object.entries(legacy.drafts).map(([identity, text]) => [identity, { text, attachments: [] }])
    )
  } catch {
    return {}
  }
}

function cloneDrafts(
  drafts: Record<string, ConversationDraftRecord>
): Record<string, ConversationDraftRecord> {
  return Object.fromEntries(
    Object.entries(drafts).map(([identity, draft]) => [
      identity,
      { text: draft.text, attachments: draft.attachments.map((attachment) => ({ ...attachment })) }
    ])
  )
}

function isDraftRecordMap(value: unknown): value is Record<string, ConversationDraftRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(isDraftRecord)
}

function isDraftRecord(value: unknown): value is ConversationDraftRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ConversationDraftRecord>
  return (
    typeof record.text === 'string' &&
    Array.isArray(record.attachments) &&
    record.attachments.every(isDraftAttachment)
  )
}

function isDraftAttachment(value: unknown): value is ConversationDraftAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Partial<ConversationDraftAttachment>
  return (
    (attachment.kind === 'file' || attachment.kind === 'folder') &&
    typeof attachment.path === 'string' &&
    typeof attachment.label === 'string' &&
    typeof attachment.fileUrl === 'string' &&
    attachment.fileUrl.startsWith('file:')
  )
}

function isLegacyDraftRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((draft) => typeof draft === 'string')
}

function dedupeAttachments(
  attachments: readonly ConversationDraftAttachment[]
): ConversationDraftAttachment[] {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    const key = `${attachment.kind}:${attachment.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameRecord(left: ConversationDraftRecord, right: ConversationDraftRecord): boolean {
  return (
    left.text === right.text &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments)
  )
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const conversationDraftStorageKey = draftStorageKey
export const legacyConversationDraftStorageKey = legacyDraftStorageKey
