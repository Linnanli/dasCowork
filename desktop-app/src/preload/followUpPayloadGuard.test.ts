import { describe, expect, it } from 'vitest'

import { FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS } from '../shared/codexFollowUpApi'
import { assertFollowUpSnapshotFitsIpc } from './followUpPayloadGuard'

describe('assertFollowUpSnapshotFitsIpc', () => {
  it('allows normal snapshots and ignores non-inline attachments', () => {
    expect(() =>
      assertFollowUpSnapshotFitsIpc({
        attachments: [
          { kind: 'inline-asset', data: 'aGVsbG8=' },
          { kind: 'file', data: 'x'.repeat(FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS + 1) }
        ]
      })
    ).not.toThrow()
  })

  it('rejects one oversized inline attachment before IPC', () => {
    expect(() =>
      assertFollowUpSnapshotFitsIpc({
        attachments: [
          {
            kind: 'inline-asset',
            data: 'A'.repeat(FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS + 1)
          }
        ]
      })
    ).toThrow('排队附件总大小不能超过 10 MiB')
  })

  it('rejects inline attachments whose combined payload is oversized', () => {
    const firstSize = Math.floor(FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS / 2)
    expect(() =>
      assertFollowUpSnapshotFitsIpc({
        attachments: [
          { kind: 'inline-asset', data: 'A'.repeat(firstSize) },
          {
            kind: 'inline-asset',
            data: 'A'.repeat(FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS - firstSize + 1)
          }
        ]
      })
    ).toThrow('排队附件总大小不能超过 10 MiB')
  })
})
