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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders every approval with its conversation source', () => {
    act(() => {
      root.render(
        <ServerRequestPanel
          getConversationTitle={(request) =>
            request.context?.threadId === 'thread-a' ? 'Conversation A' : 'Unknown conversation'
          }
          onReject={vi.fn(async () => undefined)}
          onRespond={vi.fn(async () => undefined)}
          requests={[request('a', 'thread-a'), request('b', undefined)]}
        />
      )
    })

    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain('Conversation A')
    expect(container.textContent).toContain('Unknown conversation')
  })

  it('keeps approvals independently actionable while another card is busy', async () => {
    const firstResponse = deferred<void>()
    const onRespond = vi.fn((approval: CodexApprovalRequest) => {
      return approval.id === 'a' ? firstResponse.promise : Promise.resolve()
    })
    act(() => {
      root.render(
        <ServerRequestPanel
          getConversationTitle={(approval) => `Conversation ${approval.id.toUpperCase()}`}
          onReject={vi.fn(async () => undefined)}
          onRespond={onRespond}
          requests={[request('a', 'thread-a'), request('b', 'thread-b')]}
        />
      )
    })

    const cards = [...container.querySelectorAll('article')]
    await act(async () => approveButton(cards[0])?.click())
    expect(cards[0].getAttribute('aria-busy')).toBe('true')
    expect(approveButton(cards[1])?.disabled).toBe(false)

    await act(async () => approveButton(cards[1])?.click())
    expect(onRespond.mock.calls.map(([approval]) => approval.id)).toEqual(['a', 'b'])

    await act(async () => firstResponse.resolve())
  })
})

function request(id: string, threadId: string | undefined): CodexApprovalRequest {
  return {
    id,
    kind: 'command',
    params: { command: id },
    createdAt: '2026-07-10T00:00:00.000Z',
    context: threadId ? { threadId } : undefined
  }
}

function approveButton(card: Element): HTMLButtonElement | undefined {
  return [...card.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Approve'
  )
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
