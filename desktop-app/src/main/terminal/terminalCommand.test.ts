import { describe, expect, it } from 'vitest'

import { commandForTerminalAction } from './terminalCommand'

describe('commandForTerminalAction', () => {
  it.each([
    ['posix', ['/bin/zsh', ['-lc', 'pwd']]],
    ['powershell', ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'pwd']]],
    ['command-prompt', ['cmd.exe', ['/d', '/s', '/c', 'pwd']]],
    ['wsl', ['wsl.exe', ['--exec', 'sh', '-lc', 'pwd']]]
  ] as const)('uses a shell-specific action wrapper for %s', (kind, [shell, args]) => {
    expect(commandForTerminalAction({ id: kind, label: kind, shell, args: [], kind }, 'pwd')).toEqual({
      shell,
      args
    })
  })
})
