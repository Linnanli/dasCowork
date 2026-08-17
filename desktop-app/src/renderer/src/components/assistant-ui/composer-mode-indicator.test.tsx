// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LightbulbIcon, TargetIcon } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ComposerModeIndicator,
  ComposerModeIndicatorBar,
  type ComposerModePresentation
} from './composer-mode-indicator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function presentation(overrides: Partial<ComposerModePresentation> = {}): ComposerModePresentation {
  return {
    id: 'goal',
    label: '目标',
    tooltip: '清除目标',
    dismissLabel: '清除目标',
    Icon: TargetIcon,
    onDismiss: vi.fn(),
    ...overrides
  }
}

describe('ComposerModeIndicator', () => {
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

  it('uses an accessible dismiss button and calls its presenter action', async () => {
    const onDismiss = vi.fn()
    await act(async () => {
      root.render(<ComposerModeIndicator presentation={presentation({ onDismiss })} />)
    })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="清除目标"]')
    expect(button?.textContent).toContain('目标')
    expect(button?.getAttribute('data-mode')).toBe('goal')
    expect(button?.getAttribute('title')).toBe('清除目标')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('keeps a pending mode visible while preventing duplicate dismissals', async () => {
    const onDismiss = vi.fn()
    await act(async () => {
      root.render(<ComposerModeIndicator presentation={presentation({ busy: true, onDismiss })} />)
    })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="清除目标"]')
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toContain('目标')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('renders one divider and preserves presentation order in the shared bar', async () => {
    await act(async () => {
      root.render(
        <ComposerModeIndicatorBar
          presentations={[
            presentation(),
            presentation({
              id: 'plan',
              label: '计划',
              tooltip: '关闭计划模式',
              dismissLabel: '关闭计划模式',
              Icon: LightbulbIcon
            })
          ]}
        />
      )
    })

    expect(container.querySelectorAll('[data-slot="composer-mode-indicator"]').length).toBe(2)
    expect(
      [...container.querySelectorAll('[data-slot="composer-mode-indicator"]')].map((element) =>
        element.getAttribute('data-mode')
      )
    ).toEqual(['goal', 'plan'])
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
})
