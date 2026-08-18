import { describe, expect, it, vi } from 'vitest'

import { sendToActiveRenderer } from './rendererIpc'

describe('sendToActiveRenderer', () => {
  it('sends an IPC event when the renderer is available', () => {
    const webContents = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    }

    expect(sendToActiveRenderer(webContents, 'codex:status-change', { state: 'ready' })).toBe(true)
    expect(webContents.send).toHaveBeenCalledWith('codex:status-change', { state: 'ready' })
  })

  it('does not send to destroyed web contents', () => {
    const webContents = {
      isDestroyed: vi.fn(() => true),
      send: vi.fn()
    }

    expect(sendToActiveRenderer(webContents, 'codex:status-change')).toBe(false)
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('suppresses the close race where Electron has disposed the render frame', () => {
    const webContents = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      })
    }

    expect(sendToActiveRenderer(webContents, 'codex:status-change')).toBe(false)
  })

  it('preserves unrelated IPC send failures', () => {
    const failure = new Error('IPC channel is unavailable')
    const webContents = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        throw failure
      })
    }

    expect(() => sendToActiveRenderer(webContents, 'codex:status-change')).toThrow(failure)
  })
})
