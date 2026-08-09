import { describe, expect, it } from 'vitest'

import { readThreadTerminalToolResult } from './readThreadTerminalTool'

describe('readThreadTerminalToolResult', () => {
  it('returns a normal empty result without a thread or terminal', async () => {
    await expect(readThreadTerminalToolResult(async () => ({ terminalAttached: false }), undefined)).resolves.toEqual({
      terminalAttached: false
    })
  })

  it('removes control sequences from bounded terminal output', async () => {
    await expect(
      readThreadTerminalToolResult(
        async () => ({
          terminalAttached: true,
          sessionId: 'terminal-1',
          output: '\u001b[31mred\u001b[0m\u0000\nready',
          truncated: false
        }),
        'thread-1'
      )
    ).resolves.toEqual({
      terminalAttached: true,
      sessionId: 'terminal-1',
      output: 'red\nready',
      truncated: false
    })
  })
})
