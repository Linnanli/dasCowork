import { randomUUID } from 'node:crypto'

type LocalImageCapability = {
  path: string
  mediaType: string
  identity: LocalImageFileIdentity
  expiresAt: number
}

export type LocalImageFileIdentity = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

export type LocalImageCapabilityRequest = {
  token: string
  path: string
  mediaType: string
  identity: LocalImageFileIdentity
}

export class LocalImageCapabilityStore {
  private readonly capabilities = new Map<string, LocalImageCapability>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30 * 60 * 1000
  ) {}

  issue(path: string, mediaType: string, identity: LocalImageFileIdentity): string {
    this.deleteExpired()
    const token = randomUUID()
    this.capabilities.set(token, {
      path,
      mediaType,
      identity,
      expiresAt: this.now() + this.ttlMs
    })
    return token
  }

  consumeAll(requests: readonly LocalImageCapabilityRequest[]): void {
    this.deleteExpired()
    const seenTokens = new Set<string>()

    for (const request of requests) {
      if (seenTokens.has(request.token)) {
        throw new Error('Queued local image is not authorized by the file picker.')
      }
      seenTokens.add(request.token)

      const capability = this.capabilities.get(request.token)
      if (
        !capability ||
        capability.path !== request.path ||
        capability.mediaType !== request.mediaType ||
        !sameIdentity(capability.identity, request.identity)
      ) {
        throw new Error('Queued local image is not authorized by the file picker.')
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

function sameIdentity(left: LocalImageFileIdentity, right: LocalImageFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}
