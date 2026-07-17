// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateBlankProjectDialog } from './CreateBlankProjectDialog'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('CreateBlankProjectDialog', () => {
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

  it('shows and selects the default project name', async () => {
    await act(async () => {
      root.render(<CreateBlankProjectDialog open onCreate={vi.fn()} onOpenChange={vi.fn()} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>('[data-slot="blank-project-name-input"]')

    expect(document.body.textContent).toContain('为项目命名')
    expect(document.body.textContent).toContain('保持简短且易识别')
    expect(input?.value).toBe('New project')
    expect(input?.className).toContain('bg-transparent')
    expect(document.activeElement).toBe(input)
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe('New project'.length)
    expect(
      document.querySelector('[data-slot="create-blank-project-dialog"]')?.className
    ).toContain('bg-popover/90')
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      '保存'
    )
  })

  it('trims the project name and closes after creation succeeds', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    act(() => {
      root.render(<CreateBlankProjectDialog open onCreate={onCreate} onOpenChange={onOpenChange} />)
    })

    const input = document.querySelector<HTMLInputElement>('[data-slot="blank-project-name-input"]')
    act(() => {
      if (input) setInputValue(input, '  Demo Project  ')
    })
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith('Demo Project', expect.any(String))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a validation error without calling the desktop API for a blank name', async () => {
    const onCreate = vi.fn()

    act(() => {
      root.render(<CreateBlankProjectDialog open onCreate={onCreate} onOpenChange={vi.fn()} />)
    })
    const input = document.querySelector<HTMLInputElement>('[data-slot="blank-project-name-input"]')
    act(() => {
      if (input) setInputValue(input, '   ')
    })
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('请输入项目名称')
  })

  it('keeps the dialog open and displays API errors', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('无法创建目录'))
    const onOpenChange = vi.fn()

    act(() => {
      root.render(<CreateBlankProjectDialog open onCreate={onCreate} onOpenChange={onOpenChange} />)
    })

    const input = document.querySelector<HTMLInputElement>('[data-slot="blank-project-name-input"]')
    act(() => {
      if (input) setInputValue(input, 'Demo')
    })
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法创建目录')
  })

  it('reuses the same operation id when a failed creation is retried', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('状态保存失败'))
      .mockResolvedValueOnce(undefined)

    act(() => {
      root.render(<CreateBlankProjectDialog open onCreate={onCreate} onOpenChange={vi.fn()} />)
    })

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onCreate.mock.calls[0]?.[1]).toBe(onCreate.mock.calls[1]?.[1])
  })
})

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
