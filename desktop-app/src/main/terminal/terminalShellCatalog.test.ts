import { describe, expect, it } from 'vitest'

import {
  configuredTerminalShell,
  resolveTerminalShell,
  terminalShellCatalog
} from './terminalShellCatalog'

describe('terminal shell catalog', () => {
  it('uses platform defaults without accepting an arbitrary renderer shell path', () => {
    const catalog = terminalShellCatalog('darwin', { SHELL: '/bin/fish' })
    expect(catalog).toEqual([
      expect.objectContaining({ id: 'default', shell: '/bin/fish', kind: 'posix' })
    ])
    expect(() => resolveTerminalShell('../../bin/sh', catalog)).toThrow('unavailable')
  })

  it('returns stable Windows shell identifiers', () => {
    expect(terminalShellCatalog('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'command-prompt', kind: 'command-prompt' }),
        expect.objectContaining({ id: 'powershell', kind: 'powershell' })
      ])
    )
  })

  it('maps a main-owned configured command to a shell kind before renderer preference', () => {
    expect(configuredTerminalShell('/opt/custom/pwsh', 'darwin')).toMatchObject({
      shell: '/opt/custom/pwsh',
      kind: 'powershell'
    })
    expect(configuredTerminalShell('/usr/bin/zsh', 'darwin')).toMatchObject({
      shell: '/usr/bin/zsh',
      kind: 'posix',
      args: ['-l']
    })
  })

})
