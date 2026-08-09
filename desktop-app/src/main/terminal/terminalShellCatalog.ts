import type {
  TerminalWorkspaceShellKind,
  TerminalWorkspaceShellOption
} from '../../shared/terminalWorkspaceApi'

export type ResolvedTerminalShell = {
  id: string
  label: string
  shell: string
  args: string[]
  kind: TerminalWorkspaceShellKind
}

export function terminalShellCatalog(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): ResolvedTerminalShell[] {
  if (platform === 'win32') {
    const commandPrompt = environment.ComSpec ?? 'cmd.exe'
    return [
      { id: 'command-prompt', label: 'Command Prompt', shell: commandPrompt, args: [], kind: 'command-prompt' },
      {
        id: 'powershell',
        label: 'PowerShell',
        shell: 'powershell.exe',
        args: ['-NoLogo'],
        kind: 'powershell'
      }
    ]
  }
  const shell = environment.SHELL ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return [{ id: 'default', label: shell, shell, args: ['-l'], kind: 'posix' }]
}

export function resolveTerminalShell(
  shellId: string | undefined,
  shells = terminalShellCatalog()
): ResolvedTerminalShell {
  if (!shellId) return shells[0]
  const shell = shells.find((candidate) => candidate.id === shellId)
  if (!shell) throw new Error('Requested terminal shell is unavailable')
  return shell
}

/** A main-owned explicit command wins over the renderer's integrated-shell preference. */
export function configuredTerminalShell(
  command: string,
  platform = process.platform
): ResolvedTerminalShell {
  const executable = command.split(/[\\/]/u).at(-1)?.toLowerCase() ?? command.toLowerCase()
  if (executable.includes('powershell') || executable === 'pwsh' || executable === 'pwsh.exe') {
    return { id: 'configured', label: command, shell: command, args: ['-NoLogo'], kind: 'powershell' }
  }
  if (executable === 'wsl' || executable === 'wsl.exe') {
    return { id: 'configured', label: command, shell: command, args: [], kind: 'wsl' }
  }
  if (platform === 'win32') {
    return { id: 'configured', label: command, shell: command, args: [], kind: 'command-prompt' }
  }
  return { id: 'configured', label: command, shell: command, args: ['-l'], kind: 'posix' }
}

export function listTerminalShells(): TerminalWorkspaceShellOption[] {
  return terminalShellCatalog().map((shell, index) => ({
    id: shell.id,
    label: shell.label,
    isDefault: index === 0
  }))
}
