/* eslint-disable @typescript-eslint/no-require-imports -- Electron's IPC hook is CommonJS. */
const { existsSync, readFileSync } = require('node:fs')

const errorPath = process.env.DASCOWORK_E2E_RECOVERY_ERROR_PATH

if (errorPath) {
  const { ipcMain } = require('electron')
  const registerHandler = ipcMain.handle.bind(ipcMain)

  ipcMain.handle = (channel, listener) => {
    if (channel !== 'codex-chat:get-active-run') return registerHandler(channel, listener)
    return registerHandler(channel, async (...args) => {
      if (existsSync(errorPath)) {
        throw new Error(readFileSync(errorPath, 'utf8').trim())
      }
      return listener(...args)
    })
  }
}
