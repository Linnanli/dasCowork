import { randomUUID } from 'node:crypto'

export type LocalPathFileIdentity = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

type LocalPathCapability = {
  path: string
  kind: 'file' | 'folder'
  identity: LocalPathFileIdentity
  expiresAt: number
}

export type LocalPathCapabilityRequest = {
  token: string
  path: string
  kind: 'file' | 'folder'
  identity: LocalPathFileIdentity
}

export class LocalPathCapabilityStore {
  private readonly capabilities = new Map<string, LocalPathCapability>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30 * 60 * 1000
  ) {}

  issue(path: string, kind: 'file' | 'folder', identity: LocalPathFileIdentity): string {
    this.deleteExpired()
    const token = randomUUID()
    this.capabilities.set(token, {
      path,
      kind,
      identity,
      expiresAt: this.now() + this.ttlMs
    })
    return token
  }

  consumeAll(requests: readonly LocalPathCapabilityRequest[]): void {
    this.deleteExpired()
    const seenTokens = new Set<string>()

    for (const request of requests) {
      if (seenTokens.has(request.token)) {
        throw new Error('Queued local attachment is not authorized by the file picker.')
      }
      seenTokens.add(request.token)

      const capability = this.capabilities.get(request.token)
      if (
        !capability ||
        capability.path !== request.path ||
        capability.kind !== request.kind ||
        !sameIdentity(capability.identity, request.identity)
      ) {
        throw new Error('Queued local attachment is not authorized by the file picker.')
      }
    }

    for (const request of requests) {
      this.capabilities.delete(request.token)
    }
  }

  private deleteExpired(): void {
    const now = this.now()
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.capabilities.delete(token)
    }
  }
}

function sameIdentity(left: LocalPathFileIdentity, right: LocalPathFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}
