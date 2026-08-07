import type { BrowserWindow, MenuItemConstructorOptions, WebContents } from 'electron'
import { nativeContextMenuRequestSchema } from '../shared/nativeContextMenuApi'

type ContextMenuPoint = {
  x: number
  y: number
}

type ContextMenuWebContents = {
  inspectElement(x: number, y: number): void
  openDevTools(options: { mode: 'undocked' }): void
  reload(): void
  on(channel: 'context-menu', listener: (event: unknown, params: ContextMenuPoint) => void): void
}

type PopupMenu = {
  popup(options: { window?: BrowserWindow; callback?: () => void }): void
}

type MenuBuilder = {
  buildFromTemplate(template: MenuItemConstructorOptions[]): PopupMenu
}

type ContextMenuInvokeEvent = {
  sender: WebContents
}

export function createWindowContextMenuTemplate(
  webContents: Pick<ContextMenuWebContents, 'inspectElement' | 'openDevTools' | 'reload'>,
  point: ContextMenuPoint
): MenuItemConstructorOptions[] {
  return [
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    {
      label: '检查元素',
      click: () => webContents.inspectElement(point.x, point.y)
    },
    {
      label: '打开控制台',
      click: () => webContents.openDevTools({ mode: 'undocked' })
    },
    {
      label: '刷新页面',
      click: () => webContents.reload()
    }
  ]
}

export function installWindowContextMenu(
  mainWindow: BrowserWindow,
  menuBuilder: MenuBuilder
): void {
  const webContents = mainWindow.webContents as ContextMenuWebContents

  webContents.on('context-menu', (_event, params) => {
    const menu = menuBuilder.buildFromTemplate(createWindowContextMenuTemplate(webContents, params))
    menu.popup({ window: mainWindow })
  })
}

export function createNativeContextMenuHandler(
  menuBuilder: MenuBuilder,
  resolveWindow: (event: ContextMenuInvokeEvent) => BrowserWindow | undefined
): (event: ContextMenuInvokeEvent, payload: unknown) => Promise<string | null> {
  return async (event, payload) => {
    const request = nativeContextMenuRequestSchema.parse(payload)
    const window = resolveWindow(event)

    return new Promise((resolve) => {
      let settled = false
      const settle = (id: string | null): void => {
        if (settled) return
        settled = true
        resolve(id)
      }
      const menu = menuBuilder.buildFromTemplate(
        request.items.map((item): MenuItemConstructorOptions => {
          if (item.type === 'separator') return { type: 'separator' }
          return {
            id: item.id,
            label: item.label,
            enabled: item.enabled ?? true,
            click: () => settle(item.id)
          }
        })
      )
      menu.popup({ window, callback: () => settle(null) })
    })
  }
}
