import { describe, expect, it } from 'vitest'

import {
  TERMINAL_WORKSPACE_API_VERSION,
  terminalWorkspaceCreateRequestSchema,
  terminalWorkspaceEventSchema,
  terminalWorkspaceResizeRequestSchema,
  terminalWorkspaceWriteRequestSchema
} from './terminalWorkspaceApi'

describe('terminal workspace API schemas', () => {
  it('accepts bounded terminal lifecycle requests', () => {
    expect(
      terminalWorkspaceCreateRequestSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        cols: 120,
        rows: 40
      }).success
    ).toBe(true)

    expect(
      terminalWorkspaceWriteRequestSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-1',
        data: 'npm test\r'
      }).success
    ).toBe(true)

    expect(
      terminalWorkspaceResizeRequestSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-1',
        cols: 100,
        rows: 30
      }).success
    ).toBe(true)
  })

  it('rejects renderer supplied process-control extras', () => {
    expect(
      terminalWorkspaceCreateRequestSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        cwd: '/repo',
        shell: '/bin/zsh',
        args: ['-lc', 'rm -rf .'],
        env: { SECRET: 'must-stay-in-main' }
      }).success
    ).toBe(false)

    expect(
      terminalWorkspaceWriteRequestSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        sessionId: 'terminal-1',
        data: '',
        signal: 'SIGKILL'
      }).success
    ).toBe(false)
  })

  it('keeps events renderer-safe and strict', () => {
    expect(
      terminalWorkspaceEventSchema.safeParse({
        version: TERMINAL_WORKSPACE_API_VERSION,
        type: 'data',
        sessionId: 'terminal-1',
        data: 'hello',
        rawBuffer: Buffer.from('secret')
      }).success
    ).toBe(false)
  })
})
