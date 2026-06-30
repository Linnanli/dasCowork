import {
  createCodexAppServer,
  type CodexProvider,
  type CodexProviderSettings,
  type CommandApprovalHandler,
  type FileChangeApprovalHandler
} from '@janole/ai-sdk-provider-codex-asp'

import type { CodexAppServerLaunchOptions } from './codexAppServerLaunch'

type CodexApprovalSettings = NonNullable<CodexProviderSettings['approvals']>
type ToolUserInputHandler = NonNullable<CodexApprovalSettings['onToolUserInput']>
type ElicitationHandler = NonNullable<CodexApprovalSettings['onElicitation']>

export type CodexAspProviderSettingsInput = {
  launch: CodexAppServerLaunchOptions
  cwd: string
  defaultModel?: string
  onCommandApproval: CommandApprovalHandler
  onFileChangeApproval: FileChangeApprovalHandler
  onToolUserInput: ToolUserInputHandler
  onElicitation: ElicitationHandler
}

export function createCodexAspProviderSettings(
  input: CodexAspProviderSettingsInput
): CodexProviderSettings {
  return {
    defaultModel: input.defaultModel,
    clientInfo: {
      name: 'dascowork_desktop',
      title: 'dasCowork Desktop',
      version: '1.0.0'
    },
    experimentalApi: true,
    transport: {
      type: 'stdio',
      stdio: {
        command: input.launch.command,
        args: input.launch.args,
        cwd: input.launch.cwd,
        env: toStdioEnv(input.launch.env)
      }
    },
    defaultThreadSettings: {
      cwd: input.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write'
    },
    defaultTurnSettings: {
      cwd: input.cwd,
      summary: 'auto'
    },
    approvals: {
      onCommandApproval: input.onCommandApproval,
      onFileChangeApproval: input.onFileChangeApproval,
      onToolUserInput: input.onToolUserInput,
      onElicitation: input.onElicitation
    },
    persistent: {
      scope: 'provider',
      poolSize: 1,
      idleTimeoutMs: 300_000
    },
    toolTimeoutMs: 120_000,
    interruptTimeoutMs: 10_000,
    debug:
      process.env.CODEX_ASP_DEBUG_PACKETS === '1'
        ? {
            logPackets: true,
            logger: (packet) => {
              console.info('[codex-asp]', JSON.stringify(redactSensitiveFields(packet)))
            }
          }
        : undefined
  }
}

export function createCodexAspProvider(input: CodexAspProviderSettingsInput): CodexProvider {
  return createCodexAppServer(createCodexAspProviderSettings(input))
}

function toStdioEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> | undefined {
  if (!env) return withLocalhostNoProxy({})
  return withLocalhostNoProxy(
    Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && !isCodexHostControlEnv(entry[0])
      )
    )
  )
}

function isCodexHostControlEnv(key: string): boolean {
  return (
    key === 'CODEX_CI' || key === 'CODEX_THREAD_ID' || key === 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'
  )
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      isSensitiveKey(key) ? '[redacted]' : redactSensitiveFields(entryValue)
    ])
  )
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized === 'authorization' ||
    normalized === 'api_key' ||
    normalized === 'experimental_bearer_token' ||
    normalized.includes('token') ||
    normalized.includes('secret')
  )
}

function withLocalhostNoProxy(env: Record<string, string>): Record<string, string> {
  return {
    ...env,
    NO_PROXY: appendNoProxyHosts(env.NO_PROXY ?? env.no_proxy),
    no_proxy: appendNoProxyHosts(env.no_proxy ?? env.NO_PROXY)
  }
}

function appendNoProxyHosts(value: string | undefined): string {
  const requiredHosts = ['localhost', '127.0.0.1', '::1']
  const existing = new Set(
    (value ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean)
  )
  for (const host of requiredHosts) existing.add(host)
  return [...existing].join(',')
}
