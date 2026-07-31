#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test-only SSH transport. */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const appServer = process.env.DASCOWORK_E2E_REMOTE_GIT_APP_SERVER_BIN
const sshLog = process.env.DASCOWORK_E2E_REMOTE_GIT_SSH_LOG

if (!appServer) {
  throw new Error('Fake SSH requires DASCOWORK_E2E_REMOTE_GIT_APP_SERVER_BIN.')
}

const [hostId] = process.argv.slice(2)
if (sshLog) appendFileSync(sshLog, `${hostId ?? ''}\n`, 'utf8')

// GitHostRegistry starts `ssh <alias> <remote-command>`. This fixture deliberately
// ignores the shell command and connects the production CodexCommandClient to a
// local JSON-RPC app-server stand-in. The host alias remains observable through
// the real registry and all remote Git calls still travel over that client.
const child = spawn(process.execPath, [appServer], {
  env: process.env,
  stdio: 'inherit'
})

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal)
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))
child.once('error', (error) => {
  console.error('[e2e-fake-ssh] unable to launch remote app-server', error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
