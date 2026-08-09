import type { ResolvedTerminalShell } from './terminalShellCatalog'

export type TerminalSpawnCommand = {
  shell: string
  args: string[]
}

/** Keeps command interpretation in Electron main, not in the renderer. */
export function commandForTerminalAction(
  shell: ResolvedTerminalShell,
  command: string
): TerminalSpawnCommand {
  switch (shell.kind) {
    case 'powershell':
      return { shell: shell.shell, args: ['-NoLogo', '-NoProfile', '-Command', command] }
    case 'command-prompt':
      return { shell: shell.shell, args: ['/d', '/s', '/c', command] }
    case 'wsl':
      return { shell: shell.shell, args: ['--exec', 'sh', '-lc', command] }
    case 'posix':
      return { shell: shell.shell, args: ['-lc', command] }
  }
}
