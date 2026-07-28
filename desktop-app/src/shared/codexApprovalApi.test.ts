import { describe, expect, it } from 'vitest'

import {
  codexApprovalResponseSchema,
  createRendererSafeApprovalParams,
  type CodexMcpElicitationParams,
  validateMcpFormValues
} from './codexApprovalApi'

describe('createRendererSafeApprovalParams', () => {
  it('does not expose the unsupported always-approve response action', () => {
    expect(codexApprovalResponseSchema.safeParse({ action: 'alwaysApprove' }).success).toBe(false)
  })

  it('keeps only approved command fields and derives available intents', () => {
    const params = createRendererSafeApprovalParams('command', {
      threadId: 'thread-1',
      command: 'git push origin main',
      cwd: '/repo',
      reason: 'Needs outbound access',
      networkApprovalContext: { host: 'github.com', protocol: 'https' },
      proposedNetworkPolicyAmendments: [{ host: 'github.com', action: 'allow' }],
      availableDecisions: [
        'accept',
        'acceptForSession',
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git push *'] } },
        {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: 'github.com', action: 'allow' }
          }
        },
        'decline',
        'cancel'
      ],
      apiKey: 'must-not-reach-renderer',
      provider: { headers: { Authorization: 'secret' } }
    })

    expect(params).toMatchObject({
      command: 'git push origin main',
      cwd: '/repo',
      reason: 'Needs outbound access',
      networkTarget: { host: 'github.com', protocol: 'https' },
      networkPolicyScopes: [{ host: 'github.com', action: 'allow' }],
      availableIntents: [
        'approve',
        'approveForSession',
        'approveWithExecpolicyAmendment',
        'applyNetworkPolicyAmendment',
        'decline',
        'cancel'
      ]
    })
    expect(JSON.stringify(params)).not.toContain('must-not-reach-renderer')
    expect(JSON.stringify(params)).not.toContain('Authorization')
  })

  it('does not invent command actions when the app server provides an explicit list', () => {
    expect(
      createRendererSafeApprovalParams('command', {
        command: 'blocked-command',
        availableDecisions: ['decline']
      })
    ).toMatchObject({ availableIntents: ['decline'] })
  })

  it('distinguishes missing or null command decisions from an explicit empty list', () => {
    expect(
      createRendererSafeApprovalParams('command', {
        command: 'plain-command'
      })
    ).toMatchObject({ availableIntents: ['approve', 'cancel'] })

    expect(
      createRendererSafeApprovalParams('command', {
        command: 'network-command',
        availableDecisions: null,
        networkApprovalContext: { host: 'example.com' },
        proposedNetworkPolicyAmendments: [
          { host: 'example.com', action: 'allow' },
          { host: 'example.com', action: 'deny' }
        ]
      })
    ).toMatchObject({
      availableIntents: ['approve', 'approveForSession', 'applyNetworkPolicyAmendment', 'cancel']
    })

    expect(
      createRendererSafeApprovalParams('command', {
        command: 'no-actions',
        availableDecisions: []
      })
    ).toMatchObject({ availableIntents: [] })
  })

  it('fails closed when an explicit command decision list is malformed', () => {
    expect(
      createRendererSafeApprovalParams('command', {
        command: 'malformed',
        availableDecisions: ['accept', { unexpectedDecision: true }]
      })
    ).toMatchObject({ availableIntents: [] })

    expect(
      createRendererSafeApprovalParams('command', {
        command: 'malformed-amendment',
        availableDecisions: [
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: 'git push *' } }
        ]
      })
    ).toMatchObject({ availableIntents: [] })
  })

  it('exposes file paths, normalized kinds and diff stats without raw metadata', () => {
    const params = createRendererSafeApprovalParams('file-change', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      changes: [
        {
          path: '/repo/src/example.ts',
          kind: { type: 'update', move_path: null },
          diff: '@@ -1 +1 @@\n-before\n+after'
        }
      ],
      grantRoot: '/session-root',
      providerConfig: { token: 'hidden' }
    })

    expect(params).toMatchObject({
      changes: [
        {
          path: '/repo/src/example.ts',
          kind: 'update',
          diff: '@@ -1 +1 @@\n-before\n+after'
        }
      ],
      stats: { files: 1, additions: 1, deletions: 1 },
      availableIntents: ['approve', 'decline', 'cancel', 'approveForSession']
    })
    expect(JSON.stringify(params)).not.toContain('providerConfig')
    expect(JSON.stringify(params)).not.toContain('hidden')
    expect(JSON.stringify(params)).not.toContain('/session-root')
  })

  it('does not expose file session approval when the diff cache is empty', () => {
    expect(
      createRendererSafeApprovalParams('file-change', {
        grantRoot: '/session-root',
        changes: []
      })
    ).toMatchObject({
      changes: [],
      stats: { files: 0 },
      availableIntents: ['approve', 'decline', 'cancel']
    })
  })

  it('retains tool options and secret metadata without adding answer state', () => {
    const params = createRendererSafeApprovalParams('tool-user-input', {
      questions: [
        {
          id: 'environment',
          header: 'Environment',
          question: 'Where should this run?',
          isOther: true,
          isSecret: false,
          options: [{ label: 'staging', description: 'Pre-production' }]
        },
        {
          id: 'token',
          header: 'Token',
          question: 'Enter a token',
          isOther: false,
          isSecret: true,
          options: null
        }
      ],
      answer: 'must-not-be-snapshotted'
    })

    expect(params).toMatchObject({
      questions: [
        { id: 'environment', isOther: true, options: [{ label: 'staging' }] },
        { id: 'token', isSecret: true, options: null }
      ]
    })
    expect(JSON.stringify(params)).not.toContain('must-not-be-snapshotted')
  })

  it('normalizes MCP typed forms including multi-select fields and fails closed for openai/form', () => {
    const form = createRendererSafeApprovalParams('mcp-elicitation', {
      mode: 'form',
      serverName: 'deployments',
      message: 'Choose deployment settings',
      requestedSchema: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            title: 'Region',
            oneOf: [
              { const: 'us-east-1', title: 'US East' },
              { const: 'eu-west-1', title: 'EU West' }
            ]
          },
          features: {
            type: 'array',
            items: { type: 'string', enum: ['logs', 'metrics'] },
            minItems: 1
          },
          replicas: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
          dryRun: { type: 'boolean', default: true }
        },
        required: ['region', 'features']
      },
      credential: 'must-not-reach-renderer'
    })

    expect(form).toMatchObject({
      mode: 'form',
      form: {
        supported: true,
        fields: [
          { name: 'region', kind: 'single-select', required: true },
          { name: 'features', kind: 'multi-select', required: true, minimum: 1 },
          { name: 'replicas', kind: 'number', default: 2 },
          { name: 'dryRun', kind: 'boolean', default: true }
        ]
      }
    })
    expect(JSON.stringify(form)).not.toContain('must-not-reach-renderer')

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'openai/form',
        requestedSchema: { secret: 'raw-json-is-never-rendered' }
      })
    ).toMatchObject({
      mode: 'openai/form',
      form: { supported: false, reasonCode: 'invalid-schema' }
    })
  })

  it('removes unsafe MCP URLs', () => {
    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'url',
        url: 'file:///private/token',
        elicitationId: 'request-1'
      })
    ).toMatchObject({ mode: 'url', url: '' })
  })

  it('compiles permission details completely and never exposes the original profile', () => {
    const params = createRendererSafeApprovalParams('permission-request', {
      threadId: 'thread-1',
      cwd: '/repo',
      permissions: {
        network: { enabled: true },
        fileSystem: {
          entries: [
            { path: { type: 'path', path: '/repo/src' }, access: 'read' },
            { path: { type: 'glob_pattern', pattern: '/repo/**/*.ts' }, access: 'write' },
            { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'deny' }
          ],
          globScanMaxDepth: 4
        }
      },
      apiKey: 'never-rendered'
    })

    expect(params).toMatchObject({
      details: {
        supported: true,
        details: [
          { resource: 'network', access: 'connect', value: '网络访问' },
          { resource: 'path', access: 'read', value: '/repo/src' },
          { resource: 'glob', access: 'write', value: '/repo/**/*.ts', globScanMaxDepth: 4 },
          { resource: 'special', access: 'deny', value: '临时目录' }
        ]
      },
      availableScopes: ['turn', 'session']
    })
    expect(JSON.stringify(params)).not.toContain('apiKey')
    expect(JSON.stringify(params)).not.toContain('never-rendered')
  })

  it('displays both legacy and entry-based filesystem permissions before granting them', () => {
    const permissions = {
      fileSystem: {
        entries: [{ path: { type: 'path', path: '/repo/generated' }, access: 'write' }],
        read: ['/repo/src'],
        write: ['/repo/config']
      }
    }

    expect(createRendererSafeApprovalParams('permission-request', { permissions })).toMatchObject({
      details: {
        supported: true,
        details: [
          { resource: 'path', access: 'write', value: '/repo/generated' },
          { resource: 'path', access: 'read', value: '/repo/src' },
          { resource: 'path', access: 'write', value: '/repo/config' }
        ]
      }
    })
    expect(
      createRendererSafeApprovalParams('command', { additionalPermissions: permissions })
    ).toMatchObject({
      requestedPermissions: {
        supported: true,
        details: [
          { resource: 'path', access: 'write', value: '/repo/generated' },
          { resource: 'path', access: 'read', value: '/repo/src' },
          { resource: 'path', access: 'write', value: '/repo/config' }
        ]
      }
    })
  })

  it('fails closed for an incomplete permission entry or a partially supported form', () => {
    expect(
      createRendererSafeApprovalParams('permission-request', {
        permissions: {
          network: null,
          fileSystem: {
            entries: [{ path: { type: 'path', path: '/repo' }, access: 'read' }, { unknown: true }]
          }
        }
      })
    ).toMatchObject({ details: { supported: false, reasonCode: 'unsupported' } })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, unknown: { type: 'object' } }
        }
      })
    ).toMatchObject({ mode: 'form', form: { supported: false } })
  })

  it('safely compiles a supported OpenAI form without passing raw schema through', () => {
    const params = createRendererSafeApprovalParams('mcp-elicitation', {
      mode: 'openai/form',
      requestedSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          count: { type: 'integer', minimum: 1, maximum: 3 }
        },
        required: ['email']
      },
      script: '<script>never render</script>'
    })
    expect(params).toMatchObject({
      mode: 'openai/form',
      form: {
        supported: true,
        fields: [
          { name: 'email', format: 'email', required: true },
          { name: 'count', kind: 'number', integer: true }
        ]
      }
    })
    expect(JSON.stringify(params)).not.toContain('script')
  })

  it('validates URI defaults and only accepts data-image OpenAI image pickers', () => {
    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'openai/form',
        requestedSchema: {
          type: 'object',
          properties: {
            callback: { type: 'string', format: 'uri', default: 'file:///private/key' }
          }
        }
      })
    ).toMatchObject({ form: { supported: false } })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'openai/form',
        requestedSchema: {
          type: 'object',
          properties: {
            theme: {
              type: 'openai/imagePicker',
              title: 'Theme',
              items: [
                { id: 'light', title: 'Light', image: 'data:image/png;base64,AA==' },
                { id: 'dark', title: 'Dark', image: 'data:image/png;base64,AA==' }
              ]
            }
          }
        }
      })
    ).toMatchObject({
      form: {
        supported: true,
        fields: [
          {
            name: 'theme',
            kind: 'single-select',
            imageOptions: [
              { value: 'light', imageDataUrl: 'data:image/png;base64,AA==' },
              { value: 'dark', imageDataUrl: 'data:image/png;base64,AA==' }
            ]
          }
        ]
      }
    })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'openai/form',
        requestedSchema: {
          type: 'object',
          properties: {
            theme: {
              type: 'openai/imagePicker',
              items: [{ id: 'light', title: 'Light', image: 'https://cdn.example.com/light.png' }]
            }
          }
        }
      })
    ).toMatchObject({ form: { supported: false, reasonCode: 'unsupported-schema' } })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: {
            theme: {
              type: 'openai/imagePicker',
              items: [{ id: 'light', title: 'Light', image: 'data:image/png;base64,AA==' }]
            }
          }
        }
      })
    ).toMatchObject({ form: { supported: false, reasonCode: 'unsupported-schema' } })

    const uriRequest: Extract<CodexMcpElicitationParams, { mode: 'form' | 'openai/form' }> = {
      mode: 'openai/form',
      serverName: 'deployments',
      message: 'Set callback URL',
      form: {
        supported: true,
        fields: [
          {
            name: 'callback',
            label: 'Callback URL',
            kind: 'text',
            required: true,
            format: 'uri'
          }
        ]
      }
    }
    expect(validateMcpFormValues(uriRequest, { callback: 'file:///private/key' })).toContain(
      'invalid uri'
    )
    expect(
      validateMcpFormValues(uriRequest, { callback: 'https://example.com/callback' })
    ).toBeUndefined()
  })

  it('fails closed for an unknown MCP mode and incompatible field constraints', () => {
    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'unsupported-mode',
        requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
      })
    ).toMatchObject({ mode: 'form', form: { supported: false, reasonCode: 'invalid-schema' } })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 10, maximum: 1 },
            tags: { type: 'array', items: { type: 'string', enum: ['a'] }, default: ['unknown'] }
          }
        }
      })
    ).toMatchObject({ mode: 'form', form: { supported: false, reasonCode: 'unsupported-schema' } })

    expect(
      createRendererSafeApprovalParams('mcp-elicitation', {
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: { tags: { type: 'array', items: { enum: ['a'] } } }
        }
      })
    ).toMatchObject({ mode: 'form', form: { supported: false, reasonCode: 'unsupported-schema' } })
  })
})
