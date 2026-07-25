/* eslint-disable @typescript-eslint/no-require-imports -- Electron bootstrap must remain CommonJS. */
const { app } = require('electron')
const { join, resolve } = require('node:path')

const appRoot = resolve(__dirname, '..', '..', '..')

app.setAppPath(appRoot)
require('./preload-message-port-fault-hook.cjs')
require('./recovery-error-ipc-hook.cjs')
require('./workspace-recovery-ipc-hook.cjs')
require(join(appRoot, 'out', 'main', 'index.js'))
