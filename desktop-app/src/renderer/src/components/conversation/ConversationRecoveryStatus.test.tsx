// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConversationRecoveryStatus } from './ConversationRecoveryStatus'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ConversationRecoveryStatus', () => {
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

  it('announces a classified recovery failure without exposing the raw error', () => {
    act(() => {
      root.render(
        <ConversationRecoveryStatus
          phase="needs_resume"
          error={new Error('provider key secret-value was rejected')}
        />
      )
    })

    const status = container.querySelector('[data-slot="conversation-recovery-status"]')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('data-recovery-kind')).toBe('configuration')
    expect(status?.textContent).toContain('模型配置不可用')
    expect(status?.textContent).not.toContain('secret-value')
  })
})
