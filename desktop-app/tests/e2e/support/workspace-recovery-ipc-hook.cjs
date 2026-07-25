/* eslint-disable @typescript-eslint/no-require-imports -- Electron's IPC hook is CommonJS. */
const { existsSync, readFileSync } = require('node:fs')

const statusPath = process.env.DASCOWORK_E2E_WORKSPACE_RECOVERY_STATUS_PATH

if (statusPath) {
  const { ipcMain } = require('electron')
  const originalHandle = ipcMain.handle.bind(ipcMain)

  ipcMain.handle = (channel, listener) => {
    if (channel !== 'codex:projects:get-workspace-recovery' && channel !== 'codex:projects:restore-workspace') {
      return originalHandle(channel, listener)
    }

    return originalHandle(channel, async (...args) => {
      const state = readStatusFixture(statusPath)
      const injected = channel === 'codex:projects:get-workspace-recovery' ? state.get : state.restore
      return injected ?? listener(...args)
    })
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- CommonJS test fixture.
function readStatusFixture(path) {
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}
