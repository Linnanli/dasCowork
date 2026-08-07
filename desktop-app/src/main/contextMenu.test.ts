import { describe, expect, it, vi } from 'vitest'

import type { MenuItemConstructorOptions, WebContents } from 'electron'

import { createNativeContextMenuHandler, createWindowContextMenuTemplate } from './contextMenu'

function clickMenuItem(
  template: ReturnType<typeof createWindowContextMenuTemplate>,
  label: string
): void {
  const item = template.find((entry) => entry.label === label)

  expect(item?.click).toBeTypeOf('function')
  ;(item?.click as () => void)()
}

describe('window context menu', () => {
  it('offers inspect element and reload actions for the clicked position', () => {
    const inspectElement = vi.fn()
    const openDevTools = vi.fn()
    const reload = vi.fn()

    const template = createWindowContextMenuTemplate(
      { inspectElement, openDevTools, reload },
      { x: 12, y: 34 }
    )

    expect(template.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'copy',
      'paste',
      'separator',
      '检查元素',
      '打开控制台',
      '刷新页面'
    ])

    clickMenuItem(template, '检查元素')
    clickMenuItem(template, '打开控制台')
    clickMenuItem(template, '刷新页面')

    expect(inspectElement).toHaveBeenCalledWith(12, 34)
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'undocked' })
    expect(reload).toHaveBeenCalledOnce()
  })
})

describe('native action context menu', () => {
  it('returns the selected menu item identifier', async () => {
    let template: MenuItemConstructorOptions[] = []
    const popup = vi.fn(({ callback }: { callback?: () => void }) => {
      const closeItem = template.find((item) => item.id === 'close')
      expect(closeItem?.click).toBeTypeOf('function')
      ;(closeItem?.click as () => void)()
      callback?.()
    })
    const menuBuilder = {
      buildFromTemplate: vi.fn((nextTemplate: MenuItemConstructorOptions[]) => {
        template = nextTemplate
        return { popup }
      })
    }
    const handler = createNativeContextMenuHandler(menuBuilder, () => undefined)

    await expect(
      handler(
        { sender: {} as WebContents },
        {
          items: [
            { type: 'action', id: 'close', label: '关闭' },
            { type: 'separator' },
            { type: 'action', id: 'close-others', label: '关闭其他标签页', enabled: false }
          ]
        }
      )
    ).resolves.toBe('close')

    expect(menuBuilder.buildFromTemplate).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'close', label: '关闭', enabled: true }),
      { type: 'separator' },
      expect.objectContaining({ id: 'close-others', label: '关闭其他标签页', enabled: false })
    ])
  })

  it('returns null when the menu closes without an action', async () => {
    const handler = createNativeContextMenuHandler(
      {
        buildFromTemplate: () => ({ popup: ({ callback }) => callback?.() })
      },
      () => undefined
    )

    await expect(
      handler(
        { sender: {} as WebContents },
        { items: [{ type: 'action', id: 'close', label: '关闭' }] }
      )
    ).resolves.toBeNull()
  })
})
