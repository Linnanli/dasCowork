#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unused-expressions -- Node E2E helper uses JavaScript. */

import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'

const [socketPath, codexCommand, ...appServerArgs] = process.argv.slice(2)
const readyPath = process.env.DASCOWORK_E2E_RELAY_READY_PATH
const relayPidPath = process.env.DASCOWORK_E2E_RELAY_PID_PATH
const restartPath = process.env.DASCOWORK_E2E_RELAY_RESTART_PATH

if (!socketPath || !codexCommand || !readyPath || !relayPidPath) {
  throw new Error(
    'Persistent app-server relay requires socket, Codex CLI command, ready, and PID paths.'
  )
}

if (existsSync(socketPath)) rmSync(socketPath)

/** @type {import('node:net').Socket | undefined} */
let activeProxy
/** @type {string[]} */
const bufferedOutput = []
let bufferedOutputBytes = 0
const maxBufferedOutputBytes = 4 * 1024 * 1024
let childOutputBuffer = ''
let proxyInputBuffer = ''
let initialInitializeRequestId
let initialInitializeResult
let initializationNotificationForwarded = false
let child
let restarting = false
let shuttingDown = false
/** @type {string[]} */
const pendingInput = []

const writeToProxy = (line) => {
  if (activeProxy && !activeProxy.destroyed && activeProxy.writable) {
    activeProxy.write(`${line}\n`)
    return
  }
  bufferedOutput.push(line)
  bufferedOutputBytes += Buffer.byteLength(line) + 1
  while (bufferedOutputBytes > maxBufferedOutputBytes && bufferedOutput.length > 0) {
    bufferedOutputBytes -= Buffer.byteLength(bufferedOutput.shift()) + 1
  }
}

const flushLines = (buffer, onLine) => {
  const lines = buffer.split('\n')
  const remainder = lines.pop() ?? ''
  for (const line of lines) {
    if (line) onLine(line)
  }
  return remainder
}

const forwardToChild = (line) => {
  if (restarting || !child || child.killed || !child.stdin.writable) {
    pendingInput.push(line)
    return
  }
  child.stdin.write(`${line}\n`)
}

const startChild = () => {
  childOutputBuffer = ''
  child = spawn(codexCommand, ['app-server', ...appServerArgs], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit']
  })
  child.stdout.on('data', (chunk) => {
    childOutputBuffer = flushLines(`${childOutputBuffer}${chunk.toString('utf8')}`, (line) => {
      try {
        const message = JSON.parse(line)
        if (
          initialInitializeRequestId !== undefined &&
          message.id === initialInitializeRequestId &&
          message.result
        ) {
          initialInitializeResult = message.result
        }
      } catch {
        undefined
      }
      writeToProxy(line)
    })
  })
  child.stdin.on('error', () => undefined)
  child.once('exit', (code) => {
    if (restarting) {
      restarting = false
      startChild()
      for (const line of pendingInput.splice(0)) forwardToChild(line)
      return
    }
    if (shuttingDown) return
    if (existsSync(socketPath)) rmSync(socketPath)
    process.exitCode = code ?? 1
    server.close(() => undefined)
  })
}

const restartChild = () => {
  if (restarting || shuttingDown || !child) return
  restarting = true
  initialInitializeRequestId = undefined
  initialInitializeResult = undefined
  initializationNotificationForwarded = false
  if (activeProxy && !activeProxy.destroyed) activeProxy.destroy()
  if (!child.killed) child.kill('SIGKILL')
}

const server = net.createServer((proxy) => {
  if (activeProxy && !activeProxy.destroyed) activeProxy.destroy()
  activeProxy = proxy
  for (const chunk of bufferedOutput.splice(0)) {
    if (!proxy.destroyed) proxy.write(`${chunk}\n`)
  }
  bufferedOutputBytes = 0

  proxy.on('data', (chunk) => {
    proxyInputBuffer = flushLines(`${proxyInputBuffer}${chunk.toString('utf8')}`, (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        forwardToChild(line)
        return
      }

      if (message.method === 'initialize') {
        if (initialInitializeResult) {
          proxy.write(`${JSON.stringify({ id: message.id, result: initialInitializeResult })}\n`)
          return
        }
        initialInitializeRequestId = message.id
      }
      if (message.method === 'initialized' && initializationNotificationForwarded) {
        return
      }
      if (message.method === 'initialized') initializationNotificationForwarded = true
      forwardToChild(line)
    })
  })
  proxy.on('close', () => {
    if (activeProxy === proxy) activeProxy = undefined
  })
  proxy.on('error', () => undefined)
})

server.listen(socketPath, () => {
  startChild()
  writeFileSync(readyPath, 'ready\n', 'utf8')
  writeFileSync(relayPidPath, `${process.pid}\n`, 'utf8')
})

const restartTimer = restartPath
  ? setInterval(() => {
      if (!existsSync(restartPath)) return
      rmSync(restartPath)
      restartChild()
    }, 25)
  : undefined

const shutdown = () => {
  shuttingDown = true
  if (restartTimer) clearInterval(restartTimer)
  if (activeProxy && !activeProxy.destroyed) activeProxy.destroy()
  server.close(() => undefined)
  if (child && !child.killed) child.kill('SIGTERM')
  if (existsSync(socketPath)) rmSync(socketPath)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
