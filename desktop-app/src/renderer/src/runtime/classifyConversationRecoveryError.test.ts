import { describe, expect, it } from 'vitest'

import { classifyConversationRecoveryError } from './classifyConversationRecoveryError'

describe('classifyConversationRecoveryError', () => {
  it.each([
    ['provider configuration is invalid', 'configuration'],
    ['thread not found', 'conversation-missing'],
    ['workspace cwd is unavailable', 'workspace'],
    ['permission denied', 'authorization'],
    ['transport disconnected', 'transient-runtime'],
    ['unclassified failure', 'unknown']
  ])('classifies %s as %s', (message, kind) => {
    expect(classifyConversationRecoveryError(new Error(message))).toMatchObject({ kind })
  })

  it('classifies by recovery code before message fallback', () => {
    const transient = Object.assign(new Error('thread not found'), {
      code: 'app_server_transport_closed'
    })
    const mismatch = Object.assign(new Error('transport disconnected'), {
      code: 'run-mismatch'
    })

    expect(classifyConversationRecoveryError(transient)).toMatchObject({
      kind: 'transient-runtime'
    })
    expect(classifyConversationRecoveryError(mismatch)).toMatchObject({
      kind: 'conversation-missing'
    })
  })
})
