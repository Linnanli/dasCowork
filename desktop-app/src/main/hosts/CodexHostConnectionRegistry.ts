import { CodexProcessSessionClient } from '@janole/ai-sdk-provider-codex-asp'

import {
  assertSafeRemoteExecutable,
  assertSafeSshAlias,
  createSshCodexAppServerTransport
} from '../localGit/GitHostRegistry'

export type CodexHostConnectionRegistryOptions = {
  remoteCodexCommand?: string
  createProcessClient?: (input: {
    hostId: string
    remoteCodexCommand: string
  }) => CodexProcessSessionClient
}

/** Owns process-protocol connections independently from Git command connections. */
export class CodexHostConnectionRegistry {
  private readonly processClients = new Map<string, CodexProcessSessionClient>()

  constructor(private readonly options: CodexHostConnectionRegistryOptions = {}) {}

  getProcessClient(hostId: string): CodexProcessSessionClient {
    if (hostId === 'local') throw new Error('Local terminals do not use a remote process client')
    assertSafeSshAlias(hostId)
    const existing = this.processClients.get(hostId)
    if (existing) return existing
    const remoteCodexCommand = this.options.remoteCodexCommand ?? 'codex'
    assertSafeRemoteExecutable(remoteCodexCommand)
    const client =
      this.options.createProcessClient?.({ hostId, remoteCodexCommand }) ??
      new CodexProcessSessionClient({
        transport: createSshCodexAppServerTransport(hostId, remoteCodexCommand),
        experimentalApi: true,
        clientInfo: {
          name: 'dascowork_terminal',
          title: 'dasCowork Terminal',
          version: '1.0.0'
        }
      })
    this.processClients.set(hostId, client)
    return client
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.processClients.values()].map((client) => client.shutdown()))
    this.processClients.clear()
  }
}
