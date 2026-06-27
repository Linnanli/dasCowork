import { describe, expect, it } from 'vitest'

import {
  codexChatRequestSchema,
  codexOpenExternalHttpUrlPayloadSchema,
  codexSetSelectedModelPayloadSchema
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
})
