// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerMcpCommandContent } from './composer-mcp-command-content'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ComposerMcpCommandContent', () => {
  let container: HTMLDivElement
  let root: Root
  let listMcpServers: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    listMcpServers = vi.fn(async () => ({
      version: 1 as const,
      generatedAt: '2026-08-01T00:00:00.000Z',
      servers: []
    }))
    window.desktopApp = { codex: { listMcpServers } } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows only safe MCP status fields and supports back and close actions', async () => {
    const onBack = vi.fn()
    const onClose = vi.fn()
    listMcpServers.mockResolvedValueOnce({
      version: 1,
      generatedAt: '2026-08-01T00:00:00.000Z',
      servers: [{ name: 'github', connected: true, authStatus: 'oAuth', toolCount: 2 }]
    })

    await act(async () => {
      root.render(
        <ComposerMcpCommandContent threadId="thread-1" onBack={onBack} onClose={onClose} />
      )
      await flushAsync()
    })

    expect(listMcpServers).toHaveBeenCalledWith({ version: 1, threadId: 'thread-1' })
    expect(
      (container.querySelector('[data-testid="composer-suggestion-panel"]') as HTMLElement).style
        .maxHeight
    ).toBe('96px')
    expect(container.textContent).toContain('github')
    expect(container.textContent).toContain('2 tools')
    expect(container.textContent).toContain('OAuth')

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('返回命令'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      container
        .querySelector('button[aria-label="关闭 MCP 服务列表"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onBack).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows failures and retries the bounded status request', async () => {
    listMcpServers.mockRejectedValueOnce(new Error('MCP unavailable')).mockResolvedValueOnce({
      version: 1,
      generatedAt: '2026-08-01T00:00:00.000Z',
      servers: []
    })

    await act(async () => {
      root.render(<ComposerMcpCommandContent onBack={vi.fn()} onClose={vi.fn()} />)
      await flushAsync()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('MCP unavailable')

    await act(async () => {
      container
        .querySelector('button[aria-label="重试加载 MCP 服务"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushAsync()
    })

    expect(listMcpServers).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('没有可用的 MCP 服务')
  })
})
