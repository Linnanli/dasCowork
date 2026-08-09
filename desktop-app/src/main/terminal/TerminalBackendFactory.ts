import type { CodexHostConnectionRegistry } from '../hosts/CodexHostConnectionRegistry'

import { LocalPtyTerminalBackend } from './LocalPtyTerminalBackend'
import { RemoteProcessTerminalBackend } from './RemoteProcessTerminalBackend'
import { commandForTerminalAction } from './terminalCommand'
import { terminalEnvironment } from './terminalEnvironment'
import type { TerminalBackend } from './TerminalBackend'
import type { TerminalBackendCreateInput } from './TerminalSessionManager'

export class TerminalBackendFactory {
  constructor(private readonly remoteHosts: Pick<CodexHostConnectionRegistry, 'getProcessClient'>) {}

  create(input: TerminalBackendCreateInput): Promise<TerminalBackend> | TerminalBackend {
    const command = input.actionCommand
      ? commandForTerminalAction(input.shell, input.actionCommand)
      : { shell: input.shell.shell, args: input.shell.args }
    if (input.target.hostId === 'local') {
      return new LocalPtyTerminalBackend({
        shell: command.shell,
        args: command.args,
        cwd: input.target.cwd,
        env: terminalEnvironment(),
        cols: input.cols,
        rows: input.rows
      })
    }
    return RemoteProcessTerminalBackend.create({
      client: this.remoteHosts.getProcessClient(input.target.hostId),
      command: [command.shell, ...command.args],
      cwd: input.target.cwd,
      cols: input.cols,
      rows: input.rows
    })
  }
}
