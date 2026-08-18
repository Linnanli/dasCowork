import type { WebContents } from 'electron'

type RendererIpcTarget = Pick<WebContents, 'isDestroyed' | 'send'>

export function sendToActiveRenderer(
  webContents: RendererIpcTarget,
  channel: string,
  ...args: unknown[]
): boolean {
  if (webContents.isDestroyed()) return false

  try {
    webContents.send(channel, ...args)
    return true
  } catch (error) {
    if (isDisposedRenderFrameError(error)) return false
    throw error
  }
}

function isDisposedRenderFrameError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Render frame was disposed')
}
