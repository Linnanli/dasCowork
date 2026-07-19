import { FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS } from '../shared/codexFollowUpApi'

export function assertFollowUpSnapshotFitsIpc(snapshot: unknown): void {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.attachments)) return

  let encodedCharacters = 0
  for (const attachment of snapshot.attachments) {
    if (
      !isRecord(attachment) ||
      attachment.kind !== 'inline-asset' ||
      typeof attachment.data !== 'string'
    ) {
      continue
    }

    encodedCharacters += attachment.data.length
    if (encodedCharacters > FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS) {
      throw new Error('排队附件总大小不能超过 10 MiB')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
