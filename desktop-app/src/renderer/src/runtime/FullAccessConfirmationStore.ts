const fullAccessConfirmationStorageKey = 'das-cowork.full-access-confirmation.v1'

type FullAccessConfirmationPayload = {
  version: 1
  confirmed: boolean
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export class FullAccessConfirmationStore {
  private readonly storage: StorageLike | undefined

  constructor(storage: StorageLike | undefined = safeLocalStorage()) {
    this.storage = storage
  }

  hasConfirmed(): boolean {
    if (!this.storage) return false
    try {
      const raw = this.storage.getItem(fullAccessConfirmationStorageKey)
      if (!raw) return false
      const parsed = JSON.parse(raw) as Partial<FullAccessConfirmationPayload>
      return parsed.version === 1 && parsed.confirmed === true
    } catch {
      return false
    }
  }

  confirm(): void {
    if (!this.storage) return
    try {
      const payload: FullAccessConfirmationPayload = { version: 1, confirmed: true }
      this.storage.setItem(fullAccessConfirmationStorageKey, JSON.stringify(payload))
    } catch {
      // Confirmation persistence is best effort; the user can confirm again.
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const fullAccessConfirmationStore = new FullAccessConfirmationStore()
export const fullAccessConfirmationStoreKey = fullAccessConfirmationStorageKey
