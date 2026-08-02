import { describe, expect, it } from 'vitest'

import {
  buildUserRequestEnvelope,
  extractVisibleUserRequest,
  USER_REQUEST_FOR_CODEX_HEADER
} from './userRequestEnvelope'

describe('userRequestEnvelope', () => {
  it('builds a complete model prompt with the canonical user-request boundary', () => {
    expect(buildUserRequestEnvelope('  internal context  ', '请处理这个请求')).toBe(
      `internal context\n${USER_REQUEST_FOR_CODEX_HEADER}\n请处理这个请求`
    )
  })

  it('leaves ordinary user messages unchanged', () => {
    expect(extractVisibleUserRequest('  ordinary request  ')).toBe('  ordinary request  ')
  })

  it('shows only the request after the last boundary', () => {
    const fullPrompt = [
      'outer context',
      USER_REQUEST_FOR_CODEX_HEADER,
      'nested context',
      USER_REQUEST_FOR_CODEX_HEADER,
      '  最终用户请求  '
    ].join('\n')

    expect(extractVisibleUserRequest(fullPrompt)).toBe('最终用户请求')
  })

  it('supports an empty visible request exactly like the reference parser', () => {
    expect(extractVisibleUserRequest(`context\n${USER_REQUEST_FOR_CODEX_HEADER}\n`)).toBe('')
  })
})
