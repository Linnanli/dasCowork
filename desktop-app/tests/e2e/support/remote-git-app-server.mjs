#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test-only JSON-RPC peer. */

import { spawn } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'

const running = new Map()
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })

input.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.method === 'initialize') {
    respond(message.id, { serverInfo: { name: 'e2e-remote-git', version: '1.0.0' } })
    return
  }
  if (message.method === 'command/exec') {
    void execute(message)
    return
  }
  if (message.method === 'command/exec/write') {
    writeToProcess(message)
    return
  }
  if (message.method === 'command/exec/terminate') {
    running.get(message.params?.processId)?.kill('SIGKILL')
    respond(message.id, {})
    return
  }
  if (message.id !== undefined && message.method) respond(message.id, {})
})

async function execute(message) {
  const { command, cwd, env, processId } = message.params ?? {}
  if (!Array.isArray(command) || !command.every((part) => typeof part === 'string')) {
    respond(message.id, { processId: processId ?? 'invalid', exitCode: 2, stdout: '', stderr: '' })
    return
  }

  const crashControlFile = process.env.DASCOWORK_E2E_REMOTE_GIT_CRASH_ON_CONTROL_FILE
  if (crashControlFile && existsSync(crashControlFile)) {
    unlinkSync(crashControlFile)
    process.exit(0)
  }

  if (command[0] === 'codex' && command[1] === '--version') {
    emitOutput(processId, 'stdout', 'codex-cli 1.2.3\n')
    respond(message.id, { processId, exitCode: 0, stdout: '', stderr: '' })
    return
  }

  const [executable, ...args] = command
  const child = spawn(executable, args, {
    cwd: typeof cwd === 'string' ? cwd : undefined,
    env: mergeEnvironment(env),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (typeof processId === 'string') running.set(processId, child)
  child.stdout.on('data', (chunk) => emitOutput(processId, 'stdout', chunk))
  child.stderr.on('data', (chunk) => emitOutput(processId, 'stderr', chunk))
  child.once('error', (error) => {
    emitOutput(processId, 'stderr', error.message)
  })
  child.once('close', (exitCode) => {
    if (typeof processId === 'string') running.delete(processId)
    respond(message.id, { processId, exitCode: exitCode ?? 1, stdout: '', stderr: '' })
  })
}

function writeToProcess(message) {
  const child = running.get(message.params?.processId)
  if (child && typeof message.params?.deltaBase64 === 'string') {
    child.stdin.write(Buffer.from(message.params.deltaBase64, 'base64'))
  }
  if (child && message.params?.closeStdin) child.stdin.end()
  respond(message.id, {})
}

function mergeEnvironment(overrides) {
  const environment = { ...process.env }
  if (!overrides || typeof overrides !== 'object') return environment
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete environment[key]
    else if (typeof value === 'string') environment[key] = value
  }
  return environment
}

function emitOutput(processId, stream, chunk) {
  if (typeof processId !== 'string') return
  emit({
    method: 'command/exec/outputDelta',
    params: {
      processId,
      stream,
      deltaBase64: Buffer.from(chunk).toString('base64'),
      capReached: false
    }
  })
}

function respond(id, result) {
  if (id !== undefined) emit({ id, result })
}

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
