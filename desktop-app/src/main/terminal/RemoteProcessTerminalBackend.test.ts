import { describe, expect, it, vi } from 'vitest'

import { RemoteProcessTerminalBackend } from './RemoteProcessTerminalBackend'

describe('RemoteProcessTerminalBackend', () => {
  it('forwards process output, exit and connection loss without replaying input', async () => {
    const dataListeners = new Set<(data: string) => void>()
    const exitListeners = new Set<(event: { exitCode: number | null }) => void>()
    const lostListeners = new Set<(error: Error) => void>()
    const session = {
      processHandle: 'remote-1',
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      onData: (listener: (data: string) => void) => {
        dataListeners.add(listener)
        return () => dataListeners.delete(listener)
      },
      onExit: (listener: (event: { exitCode: number | null }) => void) => {
        exitListeners.add(listener)
        return () => exitListeners.delete(listener)
      },
      onConnectionLost: (listener: (error: Error) => void) => {
        lostListeners.add(listener)
        return () => lostListeners.delete(listener)
      }
    }
    const client = { spawn: vi.fn(async () => session) }
    const backend = await RemoteProcessTerminalBackend.create({
      client: client as never,
      command: ['/bin/sh'],
      cwd: '/remote/workspace',
      cols: 80,
      rows: 24
    })
    const onData = vi.fn()
    const onExit = vi.fn()
    const onLost = vi.fn()
    backend.onData(onData)
    backend.onExit(onExit)
    backend.onConnectionLost(onLost)

    dataListeners.forEach((listener) => listener('ready'))
    exitListeners.forEach((listener) => listener({ exitCode: 0 }))
    lostListeners.forEach((listener) => listener(new Error('connection lost')))

    expect(onData).toHaveBeenCalledWith('ready')
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, signal: null })
    expect(onLost).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection lost' }))
    await backend.dispose()
    expect(session.kill).toHaveBeenCalledOnce()
  })
})
