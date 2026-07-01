import { describe, expect, it } from 'vitest'

import {
  reduceStreamFinishedConversationState,
  type ConversationRuntimeState
} from './useCodexIpcAssistantRuntime'

describe('reduceStreamFinishedConversationState', () => {
  it('binds a newly finished thread to the blank conversation that started it', () => {
    const state: ConversationRuntimeState = {
      activeConversation: undefined,
      revision: 3
    }

    expect(
      reduceStreamFinishedConversationState(state, {
        chatId: 'chat-1',
        threadId: 'thread-real',
        activeConversation: undefined,
        projectSelection: { projectKind: 'path', path: '/repo' },
        conversationRevision: 3
      })
    ).toEqual({
      activeConversation: {
        conversationId: 'thread-real',
        threadId: 'thread-real',
        projectSelection: { projectKind: 'path', path: '/repo' }
      },
      revision: 4
    })
  })

  it('ignores a finish event after the user starts another conversation', () => {
    const state: ConversationRuntimeState = {
      activeConversation: undefined,
      revision: 4
    }

    expect(
      reduceStreamFinishedConversationState(state, {
        chatId: 'chat-1',
        threadId: 'thread-old',
        activeConversation: undefined,
        projectSelection: undefined,
        conversationRevision: 3
      })
    ).toBe(state)
  })

  it('ignores a finish event after the user opens another conversation', () => {
    const state: ConversationRuntimeState = {
      activeConversation: {
        conversationId: 'conversation-new',
        threadId: 'thread-new'
      },
      revision: 3
    }

    expect(
      reduceStreamFinishedConversationState(state, {
        chatId: 'chat-1',
        threadId: 'thread-old-real',
        activeConversation: {
          conversationId: 'conversation-old',
          threadId: 'thread-old'
        },
        projectSelection: undefined,
        conversationRevision: 3
      })
    ).toBe(state)
  })
})
