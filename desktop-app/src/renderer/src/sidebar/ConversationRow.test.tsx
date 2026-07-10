// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { ConversationRow } from './ConversationRow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ConversationRow', () => {
  it('combines running, unread, attention, and active state accessibly', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onOpen = vi.fn()
    act(() => {
      root.render(
        <ConversationRow
          conversation={{
            id: 'thread-a',
            title: 'Conversation A',
            active: true,
            attention: true,
            running: true,
            unread: true
          }}
          nativeBackdrop={false}
          onOpen={onOpen}
        />
      )
    })

    const row = container.querySelector('button')
    expect(row?.getAttribute('aria-current')).toBe('page')
    expect(row?.getAttribute('aria-label')).toBe('Conversation A, running, unread, needs attention')
    expect(row?.querySelector('.lucide-loader')).not.toBeNull()

    act(() => row?.click())
    expect(onOpen).toHaveBeenCalledOnce()
    root.unmount()
  })
})
