import { describe, expect, it, vi } from 'vitest'

import { createCodexAspProviderSettings } from './codexAspProvider'

describe('createCodexAspProviderSettings', () => {
  it('uses direct codex-app-server stdio transport', () => {
    const settings = createCodexAspProviderSettings({
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://',
        env: {
          CODEX_CI: '1',
          CODEX_HOME: '/tmp/codex-home',
          CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop',
          CODEX_THREAD_ID: 'thread-from-host'
        }
      },
      cwd: '/repo',
      defaultModel: 'gpt-5.5-codex',
      onCommandApproval: () => 'accept' as const,
      onFileChangeApproval: () => 'accept' as const,
      onToolUserInput: async () => ({ answers: {} }),
      onElicitation: async () => ({ action: 'accept' as const, content: null, _meta: null })
    })

    expect(settings).toMatchObject({
      defaultModel: 'gpt-5.5-codex',
      clientInfo: {
        name: 'dascowork_desktop',
        title: 'dasCowork Desktop',
        version: '1.0.0'
      },
      transport: {
        type: 'stdio',
        stdio: {
          command: '/bin/codex-app-server',
          args: ['--listen', 'stdio://'],
          env: {
            CODEX_HOME: '/tmp/codex-home',
            NO_PROXY: 'localhost,127.0.0.1,::1',
            no_proxy: 'localhost,127.0.0.1,::1'
          }
        }
      },
      defaultThreadSettings: {
        cwd: '/repo',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write'
      },
      defaultTurnSettings: {
        cwd: '/repo',
        summary: 'auto'
      },
      persistent: {
        scope: 'provider',
        poolSize: 4,
        idleTimeoutMs: 300000
      }
    })
  })

  it('uses the host-owned shared connection instead of creating a provider worker pool', () => {
    const transportFactory = (() => {
      throw new Error('transport factory is not called while building settings')
    }) as NonNullable<ReturnType<typeof createCodexAspProviderSettings>['transportFactory']>
    const settings = createCodexAspProviderSettings({
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      cwd: '/repo',
      onCommandApproval: () => 'accept' as const,
      onFileChangeApproval: () => 'accept' as const,
      onToolUserInput: async () => ({ answers: {} }),
      onElicitation: async () => ({ action: 'accept' as const, content: null, _meta: null }),
      connection: {
        transportFactory,
        shutdown: async () => undefined
      }
    })

    expect(settings.transportFactory).toBe(transportFactory)
    expect(settings.transport).toBeUndefined()
    expect(settings.persistent).toBeUndefined()
  })

  it('uses an unsandboxed thread only for the explicit E2E runner override', () => {
    vi.stubEnv('DASCOWORK_E2E_ALLOW_UNSANDBOXED_COMMANDS', '1')

    try {
      const settings = createCodexAspProviderSettings({
        launch: {
          command: 'codex',
          args: ['app-server', '--listen', 'stdio://'],
          displayBinary: 'codex app-server --listen stdio://'
        },
        cwd: '/repo',
        onCommandApproval: () => 'accept' as const,
        onFileChangeApproval: () => 'accept' as const,
        onToolUserInput: async () => ({ answers: {} }),
        onElicitation: async () => ({ action: 'accept' as const, content: null, _meta: null })
      })

      expect(settings.defaultThreadSettings?.sandbox).toBe('danger-full-access')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('advertises a bounded read_thread_terminal dynamic tool when the desktop runtime supplies one', async () => {
    const readThreadTerminal = vi.fn(async () => ({
      terminalAttached: true,
      sessionId: 'terminal-1',
      output: 'last 16 KB only',
      truncated: true
    }))
    const settings = createCodexAspProviderSettings({
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      cwd: '/repo',
      onCommandApproval: () => 'accept' as const,
      onFileChangeApproval: () => 'accept' as const,
      onToolUserInput: async () => ({ answers: {} }),
      onElicitation: async () => ({ action: 'accept' as const, content: null, _meta: null }),
      readThreadTerminal
    })

    const tool = settings.tools?.read_thread_terminal
    expect(tool).toMatchObject({
      inputSchema: { type: 'object', additionalProperties: false }
    })
    await expect(
      tool?.execute({}, { threadId: 'thread-1', toolName: 'read_thread_terminal' })
    ).resolves.toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: expect.stringContaining('last 16 KB only') }]
    })
    expect(readThreadTerminal).toHaveBeenCalledWith('thread-1')
  })
})
