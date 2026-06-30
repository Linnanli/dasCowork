import { describe, expect, it } from 'vitest'

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
        poolSize: 1,
        idleTimeoutMs: 300000
      }
    })
  })
})
