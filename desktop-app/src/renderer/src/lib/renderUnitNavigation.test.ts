// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findRenderTarget, scrollToRenderTarget } from './renderUnitNavigation'

describe('renderUnitNavigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.HTMLElement.prototype.focus = vi.fn()
  })

  it('finds targets by primary id and child ids', () => {
    document.body.innerHTML = `
      <div data-render-target-id="render-unit-a" data-render-target-ids="item-a call-a"></div>
    `

    expect(findRenderTarget(document, 'render-unit-a')).not.toBeUndefined()
    expect(findRenderTarget(document, 'call-a')).not.toBeUndefined()
    expect(findRenderTarget(document, 'missing')).toBeUndefined()
  })

  it('scrolls and focuses a located target', async () => {
    document.body.innerHTML = `
      <div data-render-target-id="render-unit-a" data-render-target-ids="item-a"></div>
    `

    await expect(scrollToRenderTarget('item-a', { behavior: 'auto', retryMs: 0 })).resolves.toBe(
      true
    )

    const target = document.querySelector<HTMLElement>('[data-render-target-id="render-unit-a"]')
    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(target?.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(target?.getAttribute('tabindex')).toBe('-1')
  })

  it('opens a collapsed parent before scrolling', async () => {
    const trigger = vi.fn()
    document.body.innerHTML = `
      <div class="aui-tool-group-root" data-slot="tool-group-unit" data-tool-group-kind="web-search" data-state="closed">
        <button data-slot="tool-group-trigger">open</button>
        <div data-render-target-id="group-child-a" data-render-target-ids="child-a"></div>
      </div>
    `
    document.querySelector('button')?.addEventListener('click', trigger)

    await expect(scrollToRenderTarget('child-a', { retryMs: 0 })).resolves.toBe(true)

    expect(trigger).toHaveBeenCalledOnce()
  })

  it('returns false when the target does not appear within the retry window', async () => {
    await expect(scrollToRenderTarget('missing', { retryMs: 0 })).resolves.toBe(false)
  })
})
