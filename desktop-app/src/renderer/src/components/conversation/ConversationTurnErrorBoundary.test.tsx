// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationTurnErrorBoundary } from './ConversationTurnErrorBoundary'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ConversationTurnErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('retries only the failed local render subtree', () => {
    let shouldThrow = true
    const BrokenUnit = (): React.JSX.Element => {
      if (shouldThrow) throw new Error('render failure')
      return <p data-slot="recovered-render-unit">已重新渲染</p>
    }

    act(() => {
      root.render(
        <ConversationTurnErrorBoundary resetKey="message-1:text-0" renderUnitKind="text">
          <BrokenUnit />
        </ConversationTurnErrorBoundary>
      )
    })

    expect(container.querySelector('[data-slot="conversation-render-error"]')).not.toBeNull()
    shouldThrow = false
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-slot="conversation-render-retry"]')!.click()
    })

    expect(container.querySelector('[data-slot="recovered-render-unit"]')?.textContent).toBe(
      '已重新渲染'
    )
  })
})
