// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexApprovalRequest } from '../../../../shared/codexIpcApi'
import { ServerRequestPanel } from './server-request-panel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ServerRequestPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        disconnect = vi.fn()
        observe = vi.fn()
        unobserve = vi.fn()
      }
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('renders every approval with a stable request id and no shared request context', () => {
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[commandRequest('a', 'thread-a'), commandRequest('b', 'child-thread-b')]}
        />
      )
    })

    const cards = [...container.querySelectorAll('[data-slot="card"][data-request-id]')]
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.getAttribute('data-request-id'))).toEqual(['a', 'b'])
    expect(container.querySelector('[data-slot="server-request-panel"]')?.className).toContain(
      'w-full'
    )
    expect(cards[0]?.getAttribute('data-codex-approval-surface')).toBe('true')
    expect(cards[0]?.className).toContain('@container/request-card')
    expect(container.textContent).not.toContain('来自：')
    expect(container.textContent).not.toContain('项目：')
    expect(container.textContent).not.toContain('主机：')
    expect(container.textContent).not.toContain('目录：')
  })

  it('uses bounded content regions and composer-sized approval actions', () => {
    const request: Extract<CodexApprovalRequest, { kind: 'file-change' }> = {
      id: 'layout-file',
      kind: 'file-change',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        changes: Array.from({ length: 12 }, (_, index) => ({
          path: `/workspace/src/file-${index}.ts`,
          kind: 'update' as const,
          diff: `@@ -1 +1 @@\n-old-${index}\n+new-${index}`
        })),
        stats: { files: 12, additions: 12, deletions: 12 },
        availableIntents: ['approve', 'decline']
      }
    }

    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    const fileList = container.querySelector('[data-slot="file-change-list"]')
    expect(fileList?.className).toContain('max-h-[200px]')
    expect(fileList?.className).toContain('overflow-y-auto')
    expect(container.querySelector('button[data-size="composer"]')).not.toBeNull()
  })

  it('keeps approvals independently actionable while another card is busy', async () => {
    const firstResponse = deferred<void>()
    const onRespond = vi.fn((approval: CodexApprovalRequest) => {
      return approval.id === 'a' ? firstResponse.promise : Promise.resolve()
    })
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[commandRequest('a', 'thread-a'), commandRequest('b', 'thread-b')]}
        />
      )
    })

    const cards = [...container.querySelectorAll('[data-slot="card"][data-request-id]')]
    await act(async () => approveButton(cards[0])?.click())
    expect(cards[0].getAttribute('aria-busy')).toBe('true')
    expect(approveButton(cards[1])?.disabled).toBe(false)

    await act(async () => approveButton(cards[1])?.click())
    expect(onRespond.mock.calls.map(([approval]) => approval.id)).toEqual(['a', 'b'])

    await act(async () => firstResponse.resolve())
  })

  it('shows only file paths, per-file stats, and diffs for file changes', () => {
    const request: CodexApprovalRequest = {
      id: 'file-1',
      kind: 'file-change',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        reason: 'Rewrite the preview fixture',
        changes: [
          {
            path: '/private/tmp/codex-approval-panel-preview.e2e.ts',
            kind: 'update',
            diff: '@@ -1 +1 @@\n-before\n+after'
          }
        ],
        stats: { files: 1, additions: 1, deletions: 1 },
        availableIntents: ['approve', 'decline']
      },
      context: { threadId: 'thread-a', projectLabel: 'Example project', cwd: '/private/tmp' }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    expect(container.textContent).toContain('编辑文件')
    expect(container.textContent).toContain('/private/tmp/')
    expect(container.textContent).toContain('codex-approval-panel-preview.e2e.ts')
    expect(container.textContent).toContain('+1')
    expect(container.textContent).toContain('−1')
    expect(container.querySelectorAll('details')).toHaveLength(1)
    expect(container.textContent).not.toContain('Rewrite the preview fixture')
    expect(container.textContent).not.toContain('Example project')
    expect(container.textContent).not.toContain('将修改 /private/tmp')
    expect(container.textContent).not.toContain('"changes"')
  })

  it('uses a normal command reason as its title and collapses long command content', async () => {
    const request = commandRequest('long-command', 'thread-a')
    request.params.reason = 'Run diagnostic command'
    request.params.cwd = '/private/tmp/hidden-cwd'
    request.params.command = Array.from({ length: 12 }, (_, index) => `echo line-${index}`).join(
      '\n'
    )
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    const expand = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '展开完整命令'
    )
    expect(container.textContent).toContain('Run diagnostic command')
    expect(container.textContent).not.toContain('工作目录')
    expect(container.textContent).not.toContain('/private/tmp/hidden-cwd')
    expect(expand).toBeTruthy()
    await act(async () => expand?.click())
    expect(container.textContent).toContain('收起命令')
  })

  it('keeps command decline and cancel as separate advertised actions', async () => {
    const onReject = vi.fn(async () => undefined)
    const onRespond = vi.fn(async () => undefined)
    const request = commandRequest('command-decisions', 'thread-a')

    act(() => {
      root.render(
        <ServerRequestPanel onReject={onReject} onRespond={onRespond} requests={[request]} />
      )
    })

    const decline = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '拒绝并继续'
    )
    const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '拒绝并停止'
    )

    expect(decline).toBeTruthy()
    expect(cancel).toBeTruthy()
    await act(async () => decline?.click())
    await act(async () => cancel?.click())

    expect(onRespond).toHaveBeenNthCalledWith(1, request, { action: 'decline' })
    expect(onRespond).toHaveBeenNthCalledWith(2, request, { action: 'cancel' })
    expect(onReject).not.toHaveBeenCalled()
  })

  it('renders the network target, reason, and available rule scope', async () => {
    const request: CodexApprovalRequest = {
      ...commandRequest('network', 'thread-a'),
      params: {
        command: 'git push origin main',
        reason: 'Needs outbound access',
        networkTarget: { host: 'github.com', protocol: 'https' },
        networkPolicyScopes: [{ host: 'github.com', action: 'allow' }],
        requestedPermissions: {
          supported: true,
          details: [{ resource: 'network', access: 'connect', value: '网络访问' }]
        },
        availableIntents: ['approve', 'decline', 'applyNetworkPolicyAmendment']
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    expect(container.textContent).toContain('https://github.com')
    expect(container.textContent).toContain('github.com 不在当前网络允许列表中')
    expect(container.textContent).toContain('请求原因')
    expect(container.textContent).toContain('Needs outbound access')
    expect(container.textContent).toContain('当前目标范围')
    expect(container.textContent).toContain('可用规则范围')
    expect(container.textContent).toContain('允许访问 github.com')
    expect(container.textContent).toContain('请求权限')
    expect(container.textContent).toContain('网络访问')
    expect(container.textContent).not.toContain('git push origin main')
    expect(container.textContent).not.toContain('network_policy_amendment')

    const moreOptions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="更多允许选项"]'
    )
    await act(async () => {
      moreOptions?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      moreOptions?.click()
    })
    expect(document.body.textContent).toContain('允许访问 github.com，并记住该规则')
  })

  it('offers the file-session scope with the reference approval label', async () => {
    const request: CodexApprovalRequest = {
      id: 'file-menu',
      kind: 'file-change',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        changes: [
          { path: '/repo/example.ts', kind: 'update', diff: '@@ -1 +1 @@\n-before\n+after' }
        ],
        stats: { files: 1, additions: 1, deletions: 1 },
        availableIntents: ['approve', 'decline', 'approveForSession']
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    const moreOptions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="更多允许选项"]'
    )
    expect(moreOptions).toBeTruthy()
    await act(async () => {
      moreOptions?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      moreOptions?.click()
    })
    expect(document.body.textContent).toContain('允许所有修改')
  })

  it('does not offer file-session approval without a session grant', () => {
    const request: CodexApprovalRequest = {
      id: 'file-once',
      kind: 'file-change',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: { changes: [], stats: { files: 0 }, availableIntents: ['approve', 'decline'] }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    expect(container.querySelector('button[aria-label="更多允许选项"]')).toBeNull()
  })

  it('shows a safe fallback when file changes are unavailable', () => {
    const request: CodexApprovalRequest = {
      id: 'file-cache-miss',
      kind: 'file-change',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: { changes: [], stats: { files: 0 }, availableIntents: ['approve', 'decline'] }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    expect(container.querySelector('[data-slot="file-change-empty"]')?.textContent).toContain(
      '暂未收到可展示的文件 diff'
    )
    expect(container.querySelector('[data-slot="file-change-list"]')).toBeNull()
    expect(container.querySelector('button[aria-label="更多允许选项"]')).toBeNull()
  })

  it('navigates tool questions one at a time and submits the final secret answer', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'tool-1',
      kind: 'tool-user-input',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        autoResolutionMs: null,
        questions: [
          {
            id: 'environment',
            header: 'Environment',
            question: 'Choose an environment',
            isOther: false,
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
        ]
      }
    }
    vi.useFakeTimers()
    try {
      act(() => {
        root.render(
          <ServerRequestPanel
            onReject={vi.fn(async () => undefined)}
            onRespond={onRespond}
            requests={[request]}
          />
        )
      })

      expect(container.textContent).toContain('Choose an environment')
      expect(container.textContent).toContain('第 1 / 2 题')
      expect(container.textContent).not.toContain('Environment')
      const radio = container.querySelector<HTMLButtonElement>('[data-slot="radio-group-item"]')
      expect(radio).toBeTruthy()
      expect(container.querySelector('input[type="radio"][aria-hidden="true"]')).not.toBeNull()
      await act(async () => {
        radio?.click()
        await vi.advanceTimersByTimeAsync(180)
      })

      expect(container.textContent).toContain('Enter a token')
      expect(container.textContent).toContain('第 2 / 2 题')
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="上一题"]')?.click()
      )
      expect(container.textContent).toContain('Choose an environment')
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="下一题"]')?.click()
      )

      const secret = container.querySelector<HTMLInputElement>('input[type="password"]')
      expect(secret).toBeTruthy()
      await setInputValue(secret!, 'token-value')
      await act(async () => submitButton(container)?.click())
    } finally {
      vi.useRealTimers()
    }

    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'answer',
      answers: { environment: ['staging'], token: ['token-value'] }
    })
  })

  it('keeps an isOther free-text answer mutually exclusive with its selected option', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'tool-other',
      kind: 'tool-user-input',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        autoResolutionMs: null,
        questions: [
          {
            id: 'environment',
            header: 'Environment',
            question: 'Choose an environment',
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
        ]
      }
    }
    vi.useFakeTimers()
    try {
      act(() => {
        root.render(
          <ServerRequestPanel
            onReject={vi.fn(async () => undefined)}
            onRespond={onRespond}
            requests={[request]}
          />
        )
      })

      const radio = container.querySelector<HTMLButtonElement>('[data-slot="radio-group-item"]')
      await act(async () => {
        radio?.click()
        await vi.advanceTimersByTimeAsync(180)
      })
      expect(container.textContent).toContain('Choose an environment')
      expect(onRespond).not.toHaveBeenCalled()

      const otherInput = container.querySelector<HTMLInputElement>('input#tool-environment-other')
      expect(otherInput).toBeTruthy()
      await setInputValue(otherInput!, 'preview')
      expect(submitButton(container)?.disabled).toBe(false)
      await act(async () => submitButton(container)?.click())
      expect(container.textContent).toContain('Enter a token')

      const secret = container.querySelector<HTMLInputElement>('input[type="password"]')
      expect(secret).toBeTruthy()
      await setInputValue(secret!, 'token-value')
      await act(async () => submitButton(container)?.click())
    } finally {
      vi.useRealTimers()
    }

    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'answer',
      answers: { environment: ['preview'], token: ['token-value'] }
    })
  })

  it('clears option auto-advance before rejecting a tool input request', async () => {
    const onReject = vi.fn(async () => undefined)
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'tool-terminal-timer',
      kind: 'tool-user-input',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        autoResolutionMs: null,
        questions: [
          {
            id: 'environment',
            header: 'Environment',
            question: 'Choose an environment',
            isOther: false,
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
        ]
      }
    }

    vi.useFakeTimers()
    try {
      act(() => {
        root.render(
          <ServerRequestPanel onReject={onReject} onRespond={onRespond} requests={[request]} />
        )
      })

      const radio = container.querySelector<HTMLButtonElement>('[data-slot="radio-group-item"]')
      const reject = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === '拒绝'
      )
      await act(async () => {
        radio?.click()
        reject?.click()
        await vi.advanceTimersByTimeAsync(TOOL_OPTION_ADVANCE_DELAY_MS_FOR_TEST)
      })

      expect(onReject).toHaveBeenCalledTimes(1)
      expect(onReject).toHaveBeenCalledWith(request)
      expect(onRespond).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Choose an environment')
      expect(container.textContent).not.toContain('Enter a token')
    } finally {
      vi.useRealTimers()
    }
  })

  it('submits MCP multi-select values without converting them to a string', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'mcp-1',
      kind: 'mcp-elicitation',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        mode: 'form',
        serverName: 'deployments',
        message: 'Choose features',
        form: {
          supported: true,
          fields: [
            {
              name: 'features',
              label: 'Features',
              kind: 'multi-select',
              required: true,
              options: [
                { value: 'logs', label: 'Logs' },
                { value: 'metrics', label: 'Metrics' }
              ]
            },
            {
              name: 'replicas',
              label: 'Replicas',
              kind: 'number',
              required: false,
              integer: true,
              minimum: 1,
              maximum: 10,
              default: 2
            },
            {
              name: 'dryRun',
              label: 'Dry run',
              kind: 'boolean',
              required: false,
              default: true
            }
          ]
        }
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })

    expect(container.textContent).toContain('Choose features')
    expect(container.textContent).toContain('deployments 请求输入')

    const checkboxes = [...container.querySelectorAll<HTMLButtonElement>('[data-slot="checkbox"]')]
    expect(checkboxes).toHaveLength(3)
    expect(container.querySelector('input[type="checkbox"][aria-hidden="true"]')).not.toBeNull()
    await act(async () => checkboxes[0]?.click())
    await act(async () => checkboxes[1]?.click())
    await act(async () => submitButton(container)?.click())

    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'submitMcpForm',
      values: { features: ['logs', 'metrics'], replicas: 2, dryRun: true }
    })
  })

  it('uses the reference titles for unsupported and URL MCP requests', () => {
    const requests: CodexApprovalRequest[] = [
      {
        id: 'mcp-unsupported',
        kind: 'mcp-elicitation',
        createdAt: '2026-07-10T00:00:00.000Z',
        params: {
          mode: 'openai/form',
          serverName: 'private-mcp',
          message: 'Hidden schema',
          form: { supported: false, reasonCode: 'unsupported-schema' }
        }
      },
      {
        id: 'mcp-url',
        kind: 'mcp-elicitation',
        createdAt: '2026-07-10T00:00:00.000Z',
        params: {
          mode: 'url',
          serverName: 'github',
          message: 'Complete the GitHub sign-in flow',
          url: 'https://github.com/login',
          elicitationId: 'elicitation-1'
        }
      }
    ]
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={requests}
        />
      )
    })

    expect(container.textContent).toContain('当前版本无法安全显示此请求')
    expect(container.textContent).toContain('private-mcp 请求了此表单。')
    expect(container.textContent).toContain('需要操作')
    expect(container.textContent).toContain('Complete the GitHub sign-in flow')
    expect(container.textContent).toContain('https://github.com/login')
  })

  it('renders permission details in the shared shell and sends scope intent only', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: Extract<CodexApprovalRequest, { kind: 'permission-request' }> = {
      id: 'permission-1',
      kind: 'permission-request',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        reason: 'Needs project access',
        cwd: '/repo',
        availableScopes: ['turn', 'session'],
        details: {
          supported: true,
          details: [
            { resource: 'path', access: 'read', value: '/repo/src' },
            { resource: 'glob', access: 'write', value: '/repo/**/*.ts', globScanMaxDepth: 2 }
          ]
        }
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })
    expect(container.querySelector('[data-codex-approval-surface="true"]')).not.toBeNull()
    expect(container.textContent).toContain('/repo/src')
    expect(container.textContent).toContain('扫描深度 ≤ 2')
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())
    expect(onRespond).not.toHaveBeenCalled()
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('本次会话允许'))
        ?.click()
    )
    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'approvePermissions',
      scope: 'session'
    })
  })

  it('opens an MCP URL before accepting it', async () => {
    const openExternalHttpUrl = vi.fn(async () => undefined)
    vi.stubGlobal('desktopApp', { codex: { openExternalHttpUrl } })
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'mcp-url-two-phase',
      kind: 'mcp-elicitation',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        mode: 'url',
        serverName: 'github',
        message: 'Finish sign in',
        url: 'https://github.com/login',
        elicitationId: 'url-1'
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })
    const action = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('打开链接')
    )
    await act(async () => action?.click())
    expect(openExternalHttpUrl).toHaveBeenCalledWith('https://github.com/login')
    expect(onRespond).not.toHaveBeenCalled()
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('继续'))
        ?.click()
    )
    expect(onRespond).toHaveBeenCalledWith(request, { action: 'approve' })
  })

  it('declines an MCP URL request when the user presses Escape', async () => {
    const onReject = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'mcp-url-escape',
      kind: 'mcp-elicitation',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        mode: 'url',
        serverName: 'github',
        message: 'Finish sign in',
        url: 'https://github.com/login',
        elicitationId: 'url-escape'
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={onReject}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })

    const reject = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('拒绝')
    )
    await act(async () => {
      reject?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onReject).toHaveBeenCalledWith(request)
    expect(container.textContent).not.toContain('取消')
  })

  it('omits an untouched optional boolean MCP form field', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'mcp-optional-boolean',
      kind: 'mcp-elicitation',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        mode: 'form',
        serverName: 'deployments',
        message: 'Optional preview mode',
        form: {
          supported: true,
          fields: [
            {
              name: 'preview',
              label: 'Preview mode',
              kind: 'boolean',
              required: false
            }
          ]
        }
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })

    await act(async () => submitButton(container)?.click())

    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'submitMcpForm',
      values: {}
    })
  })

  it('omits a cleared optional MCP number field', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request = mcpNumberRequest('mcp-optional-number', false, 2)
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })

    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('2')
    await setInputValue(input!, '')
    await act(async () => submitButton(container)?.click())

    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'submitMcpForm',
      values: {}
    })
  })

  it('requires a blank required MCP number and converts a non-empty value', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request = mcpNumberRequest('mcp-required-number', true)
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })

    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(container.textContent).toContain('Replicas 为必填项')
    expect(onRespond).not.toHaveBeenCalled()

    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    await setInputValue(input!, '3')
    await act(async () => submitButton(container)?.click())
    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'submitMcpForm',
      values: { replicas: 3 }
    })
  })

  it('renders data-image OpenAI image selections as keyboard-focusable single-select controls', async () => {
    const onRespond = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'mcp-image-options',
      kind: 'mcp-elicitation',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        mode: 'openai/form',
        serverName: 'themes',
        message: 'Choose a theme',
        form: {
          supported: true,
          fields: [
            {
              name: 'theme',
              label: 'Theme',
              kind: 'single-select',
              required: true,
              options: [
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ],
              imageOptions: [
                {
                  value: 'light',
                  label: 'Light',
                  imageDataUrl: 'data:image/png;base64,AA=='
                },
                {
                  value: 'dark',
                  label: 'Dark',
                  imageDataUrl: 'data:image/png;base64,AA=='
                }
              ]
            }
          ]
        }
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request]}
        />
      )
    })

    const choices = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(choices).toHaveLength(2)
    choices[0]?.focus()
    expect(document.activeElement).toBe(choices[0])
    expect(choices[0]?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==')
    await act(async () => choices[1]?.click())
    await act(async () => submitButton(container)?.click())
    expect(onRespond).toHaveBeenCalledWith(request, {
      action: 'submitMcpForm',
      values: { theme: 'dark' }
    })
  })

  it('snoozes a tool auto-resolution timer on first interaction', async () => {
    const onInteraction = vi.fn(async () => undefined)
    const request: CodexApprovalRequest = {
      id: 'timed-tool',
      kind: 'tool-user-input',
      createdAt: '2026-07-10T00:00:00.000Z',
      params: {
        autoResolutionMs: 3_000,
        deadlineAtMs: Date.now() + 3_000,
        autoResolutionSnoozed: false,
        questions: [
          {
            id: 'target',
            header: 'Target',
            question: 'Where?',
            isOther: false,
            isSecret: false,
            options: null
          }
        ]
      }
    }
    act(() => {
      root.render(
        <ServerRequestPanel
          onInteraction={onInteraction}
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request]}
        />
      )
    })
    expect(container.textContent).toContain('秒后自动跳过')
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')
    await setInputValue(input!, 'local')
    expect(onInteraction).toHaveBeenCalledTimes(1)
  })
})

function commandRequest(
  id: string,
  threadId: string | undefined
): Extract<CodexApprovalRequest, { kind: 'command' }> {
  return {
    id,
    kind: 'command',
    params: {
      command: id,
      networkPolicyScopes: [],
      availableIntents: ['approve', 'decline', 'cancel']
    },
    createdAt: '2026-07-10T00:00:00.000Z',
    context: threadId ? { threadId } : undefined
  }
}

function mcpNumberRequest(
  id: string,
  required: boolean,
  defaultValue?: number
): Extract<CodexApprovalRequest, { kind: 'mcp-elicitation' }> {
  return {
    id,
    kind: 'mcp-elicitation',
    createdAt: '2026-07-10T00:00:00.000Z',
    params: {
      mode: 'form',
      serverName: 'deployments',
      message: 'Choose replicas',
      form: {
        supported: true,
        fields: [
          {
            name: 'replicas',
            label: 'Replicas',
            kind: 'number',
            required,
            integer: true,
            minimum: 1,
            maximum: 10,
            ...(defaultValue === undefined ? {} : { default: defaultValue })
          }
        ]
      }
    }
  }
}

const TOOL_OPTION_ADVANCE_DELAY_MS_FOR_TEST = 180

function approveButton(card: Element): HTMLButtonElement | undefined {
  return [...card.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '允许一次'
  )
}

function submitButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) =>
      button.textContent?.trim() === '继续' ||
      button.textContent?.trim() === '提交回答' ||
      button.textContent?.trim() === '提交'
  )
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
