import { describe, expect, it } from 'vitest'

import {
  codexChatRequestSchema,
  codexOpenExternalHttpUrlPayloadSchema,
  codexSetSelectedModelPayloadSchema,
  sidebarConversationActionPayloadSchema,
  sidebarConversationOpenResultSchema,
  sidebarConversationRenamePayloadSchema,
  sidebarPreferencesPatchSchema
} from './codexIpcApi'

describe('codex IPC schemas', () => {
  it('accepts a minimal AI SDK UI message chat request', () => {
    expect(
      codexChatRequestSchema.safeParse({
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }]
          }
        ]
      }).success
    ).toBe(true)
  })

  it('rejects malformed UI messages', () => {
    expect(
      codexChatRequestSchema.safeParse({
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [{ role: 'user', content: 'legacy content shape' }]
      }).success
    ).toBe(false)
  })

  it('rejects empty selected model ids', () => {
    expect(codexSetSelectedModelPayloadSchema.safeParse({ modelId: '' }).success).toBe(false)
    expect(
      codexChatRequestSchema.safeParse({
        chatId: 'chat-1',
        trigger: 'submit-message',
        modelId: '',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('allows only http and https external URLs', () => {
    expect(
      codexOpenExternalHttpUrlPayloadSchema.safeParse({ url: 'https://example.com' }).success
    ).toBe(true)
    expect(
      codexOpenExternalHttpUrlPayloadSchema.safeParse({ url: 'ftp://example.com' }).success
    ).toBe(false)
  })

  it('validates conversation action payloads', () => {
    expect(
      sidebarConversationActionPayloadSchema.safeParse({ conversationId: 'thread-1' }).success
    ).toBe(true)
    expect(sidebarConversationActionPayloadSchema.safeParse({ conversationId: '' }).success).toBe(
      false
    )
  })

  it('validates conversation rename payloads', () => {
    expect(
      sidebarConversationRenamePayloadSchema.safeParse({
        conversationId: 'thread-1',
        title: 'Investigate provider lifecycle'
      }).success
    ).toBe(true)
    expect(
      sidebarConversationRenamePayloadSchema.safeParse({
        conversationId: 'thread-1',
        title: '   '
      }).success
    ).toBe(false)
  })

  it('validates conversation open results', () => {
    expect(
      sidebarConversationOpenResultSchema.safeParse({
        conversationId: 'thread-1',
        threadId: 'thread-1',
        title: null,
        messages: [],
        projectAssignment: {
          projectKind: 'projectless',
          cwd: '/tmp/dascowork/thread-1',
          workspaceRoot: '/tmp/dascowork/thread-1',
          outputDirectory: '/tmp/dascowork/thread-1/out'
        }
      }).success
    ).toBe(true)
    expect(sidebarConversationOpenResultSchema.safeParse({ conversationId: '' }).success).toBe(
      false
    )
  })

  it('validates sidebar preference patches', () => {
    expect(
      sidebarPreferencesPatchSchema.safeParse({
        organizeMode: 'chronological',
        sortKey: 'created_at',
        collapsedSectionIds: ['projects'],
        collapsedGroupIds: ['local:project-1']
      }).success
    ).toBe(true)
    expect(sidebarPreferencesPatchSchema.safeParse({ organizeMode: 'remote' }).success).toBe(false)
    expect(sidebarPreferencesPatchSchema.safeParse({ sortKey: 'name' }).success).toBe(false)
  })
})
