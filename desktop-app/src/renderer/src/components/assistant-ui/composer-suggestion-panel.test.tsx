// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerSuggestionPanel } from './composer-suggestion-panel'
import type { ComposerSuggestionItem } from '@/composer/composerSuggestionTypes'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const command: ComposerSuggestionItem = {
  id: 'command:new-chat',
  kind: 'command',
  label: 'New chat',
  description: '创建一个新的空白任务',
  selection: { type: 'action', run: vi.fn() }
}

describe('ComposerSuggestionPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders grouped results with stable listbox semantics and pointer selection', async () => {
    const onHighlight = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        <ComposerSuggestionPanel
          ariaLabel="命令"
          emptyLabel="没有匹配命令"
          highlightedId={command.id}
          onHighlight={onHighlight}
          onSelect={onSelect}
          sections={[
            { id: 'general', label: 'General', items: [command] },
            { id: 'search', label: '搜索结果', items: [], showTitle: false }
          ]}
        />
      )
    })

    const listbox = container.querySelector('[role="listbox"]')
    const option = container.querySelector<HTMLElement>('[role="option"]')
    expect(listbox?.getAttribute('aria-activedescendant')).toBe(option?.id)
    expect((listbox as HTMLElement).style.maxHeight).toBe('96px')
    expect(option?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('General')

    await act(async () => {
      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onHighlight).toHaveBeenCalledWith(command.id)
    expect(onSelect).toHaveBeenCalledWith(command)
  })

  it('renders loading, retry, placeholder and empty states without leaking an option', async () => {
    const onRetry = vi.fn()
    const onHighlight = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        <ComposerSuggestionPanel
          ariaLabel="添加上下文"
          emptyLabel="没有可引用的上下文"
          highlightedId={null}
          onHighlight={onHighlight}
          onSelect={onSelect}
          sections={[
            {
              id: 'catalog',
              label: '上下文',
              items: [],
              loading: true,
              error: '目录暂时不可用',
              onRetry,
              placeholder: '输入以搜索文件或任务'
            }
          ]}
        />
      )
    })

    expect(container.textContent).toContain('正在加载…')
    expect(container.textContent).toContain('目录暂时不可用')
    expect(container.textContent).toContain('输入以搜索文件或任务')
    expect(container.querySelector('[role="option"]')).toBeNull()

    await act(async () => {
      container
        .querySelector('button[aria-label="重试加载 上下文"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRetry).toHaveBeenCalledOnce()

    await act(async () => {
      root.render(
        <ComposerSuggestionPanel
          ariaLabel="添加上下文"
          emptyLabel="没有可引用的上下文"
          highlightedId={null}
          onHighlight={onHighlight}
          onSelect={onSelect}
          sections={[]}
        />
      )
    })
    expect(container.textContent).toContain('没有可引用的上下文')
  })
})
