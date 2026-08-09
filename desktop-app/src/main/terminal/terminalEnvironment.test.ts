import { describe, expect, it } from 'vitest'

import { terminalEnvironment } from './terminalEnvironment'

describe('terminalEnvironment', () => {
  it('inherits main-owned environment while removing TERMINFO overrides', () => {
    expect(
      terminalEnvironment({ PATH: '/bin', TERM: 'dumb', TERMINFO: '/tmp/info', TERMINFO_DIRS: '/tmp/dirs' })
    ).toEqual({ PATH: '/bin', TERM: 'xterm-256color' })
  })
})
