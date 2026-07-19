import { describe, expect, it } from 'vitest'

import {
  LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
  LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE
} from '../../../shared/composerContext'
import type { MaterializedQueuedUserMessage } from '../../../shared/codexFollowUpApi'
import { localPathAttachmentIdentityFromId } from '../composer/imageAttachmentAdapter'
import { restoreQueuedFollowUpToComposerDraft } from './restoreQueuedFollowUpToComposer'

describe('restoreQueuedFollowUpToComposerDraft', () => {
  it('restores text, image, file, and folder parts without losing local identity', () => {
    const restored = restoreQueuedFollowUpToComposerDraft(
      createMessage([
        { type: 'text', text: 'updated request' },
        {
          type: 'file',
          filename: 'preview.png',
          mediaType: 'image/png',
          url: 'data:image/png;base64,cGl4ZWw='
        },
        {
          type: 'file',
          filename: 'notes.md',
          mediaType: LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
          url: 'file:///repo/notes.md'
        },
        {
          type: 'file',
          filename: 'src',
          mediaType: LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE,
          url: 'file:///repo/src'
        }
      ])
    )

    expect(restored.text).toBe('updated request')
    expect(restored.attachments).toHaveLength(3)
    expect(restored.attachments[0]).toMatchObject({
      type: 'image',
      name: 'preview.png',
      contentType: 'image/png'
    })
    expect(localPathAttachmentIdentityFromId(restored.attachments[1]?.id ?? '')).toEqual({
      fileUrl: 'file:///repo/notes.md',
      kind: 'file',
      path: '/repo/notes.md'
    })
    expect(localPathAttachmentIdentityFromId(restored.attachments[2]?.id ?? '')).toEqual({
      fileUrl: 'file:///repo/src',
      kind: 'folder',
      path: '/repo/src'
    })
  })

  it('rejects a materialized binary type the Composer cannot safely restore', () => {
    expect(() =>
      restoreQueuedFollowUpToComposerDraft(
        createMessage([
          {
            type: 'file',
            filename: 'archive.zip',
            mediaType: 'application/zip',
            url: 'data:application/zip;base64,emlw'
          }
        ])
      )
    ).toThrow('暂不支持编辑附件')
  })
})

function createMessage(
  parts: MaterializedQueuedUserMessage['parts']
): MaterializedQueuedUserMessage {
  return {
    id: 'follow-up-one',
    parts,
    contextReferences: [],
    trustedContext: {
      conversationId: 'conversation-a',
      hostId: 'local',
      cwd: '/repo',
      workspaceRoots: ['/repo']
    }
  }
}
