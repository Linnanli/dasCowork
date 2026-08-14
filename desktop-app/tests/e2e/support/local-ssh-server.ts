import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Server, type Connection, type ServerChannel } from 'ssh2'

const execFile = promisify(execFileCallback)
const E2E_SSH_HOST = 'e2e-remote'
const E2E_SSH_USER = 'dascowork-e2e'
const EXPECTED_REMOTE_COMMAND = "exec 'codex' app-server --listen stdio://"

export type LocalSshServer = {
  sshBinDirectory: string
  sshConfigPath: string
  realSshPath: string
  remoteCommands: readonly string[]
  authenticatedConnectionCount: () => number
  close: () => Promise<void>
}

/**
 * Starts an isolated loopback SSH endpoint for Electron E2E tests. The app still
 * invokes the production `ssh <alias> <remote-command>` transport; a temporary
 * PATH wrapper only supplies a test-specific OpenSSH configuration before it
 * execs the real system SSH client.
 */
export async function startLocalSshServer({
  appServerPath,
  terminalTracePath,
  commandTracePath
}: {
  appServerPath: string
  terminalTracePath: string
  commandTracePath?: string
}): Promise<LocalSshServer> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-ssh-'))
  const sshBinDirectory = join(tempDirectory, 'bin')
  const sshConfigPath = join(tempDirectory, 'config')
  const clientKeyPath = join(tempDirectory, 'client_rsa')
  const sshWrapperPath = join(sshBinDirectory, 'ssh')
  const hostKey = createRsaPrivateKey()
  const clientKey = createRsaPrivateKey()
  const remoteCommands: string[] = []
  const connections = new Set<Connection>()
  const childProcesses = new Set<ChildProcess>()
  let authenticatedConnections = 0

  await mkdir(sshBinDirectory, { recursive: true })
  await writeFile(clientKeyPath, clientKey, { encoding: 'utf8', mode: 0o600 })
  await chmod(clientKeyPath, 0o600)
  await writeFile(
    sshConfigPath,
    [
      `Host ${E2E_SSH_HOST}`,
      '  HostName 127.0.0.1',
      `  User ${E2E_SSH_USER}`,
      `  IdentityFile ${clientKeyPath}`,
      '  IdentitiesOnly yes',
      '  BatchMode yes',
      '  PasswordAuthentication no',
      '  KbdInteractiveAuthentication no',
      '  StrictHostKeyChecking no',
      `  UserKnownHostsFile ${join(tempDirectory, 'known_hosts')}`,
      '  LogLevel ERROR',
      ''
    ].join('\n'),
    'utf8'
  )

  const server = new Server({ hostKeys: [hostKey] }, (connection) => {
    connections.add(connection)
    connection.on('error', () => undefined)
    connection.once('close', () => connections.delete(connection))
    connection.on('authentication', (context) => {
      if (context.method === 'publickey' && context.username === E2E_SSH_USER) {
        authenticatedConnections += 1
        context.accept()
        return
      }
      context.reject(['publickey'])
    })
    connection.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acceptExec, rejectExec, info) => {
        remoteCommands.push(info.command)
        if (info.command !== EXPECTED_REMOTE_COMMAND) {
          rejectExec()
          return
        }
        const channel = acceptExec()
        forwardAppServer(
          channel,
          appServerPath,
          terminalTracePath,
          commandTracePath,
          childProcesses
        )
      })
    })
  })
  server.on('error', () => undefined)

  try {
    const port = await listenOnLoopback(server)
    await writeFile(
      sshConfigPath,
      [
        `Host ${E2E_SSH_HOST}`,
        '  HostName 127.0.0.1',
        `  Port ${String(port)}`,
        `  User ${E2E_SSH_USER}`,
        `  IdentityFile ${clientKeyPath}`,
        '  IdentitiesOnly yes',
        '  BatchMode yes',
        '  PasswordAuthentication no',
        '  KbdInteractiveAuthentication no',
        '  StrictHostKeyChecking no',
        `  UserKnownHostsFile ${join(tempDirectory, 'known_hosts')}`,
        '  LogLevel ERROR',
        ''
      ].join('\n'),
      'utf8'
    )
    const realSshPath = (await execFile('which', ['ssh'])).stdout.trim()
    if (!realSshPath) throw new Error('The local SSH smoke test requires a system ssh client')

    await writeFile(sshWrapperPath, createSshWrapper(), { encoding: 'utf8', mode: 0o700 })
    await chmod(sshWrapperPath, 0o700)

    return {
      sshBinDirectory,
      sshConfigPath,
      realSshPath,
      remoteCommands,
      authenticatedConnectionCount: () => authenticatedConnections,
      close: async () => {
        for (const child of childProcesses) stopChild(child)
        for (const connection of connections) connection.end()
        await closeServer(server)
        await rm(tempDirectory, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  } catch (error) {
    await closeServer(server)
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}

function forwardAppServer(
  channel: ServerChannel,
  appServerPath: string,
  terminalTracePath: string,
  commandTracePath: string | undefined,
  childProcesses: Set<ChildProcess>
): void {
  const child = spawn(process.execPath, [appServerPath], {
    env: {
      ...process.env,
      DASCOWORK_E2E_REMOTE_TERMINAL_TRACE: terminalTracePath,
      DASCOWORK_E2E_REMOTE_COMMAND_TRACE: commandTracePath
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  childProcesses.add(child)
  channel.on('data', (chunk: Buffer) => child.stdin?.write(chunk))
  channel.once('end', () => child.stdin?.end())
  channel.once('close', () => stopChild(child))
  child.stdout?.on('data', (chunk: Buffer) => {
    if (!channel.destroyed) channel.write(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const stderr = channel.stderr
    if ('write' in stderr && typeof stderr.write === 'function') stderr.write(chunk)
  })
  child.once('error', () => undefined)
  child.once('close', (code) => {
    childProcesses.delete(child)
    if (channel.destroyed) return
    channel.exit(code ?? 1)
    channel.end()
  })
}

function createRsaPrivateKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey
}

function createSshWrapper(): string {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process'

const realSshPath = process.env.DASCOWORK_E2E_REAL_SSH_PATH
const sshConfigPath = process.env.DASCOWORK_E2E_SSH_CONFIG
if (!realSshPath || !sshConfigPath) {
  throw new Error('Local SSH E2E wrapper is missing its isolated SSH configuration.')
}

const child = spawn(realSshPath, ['-F', sshConfigPath, ...process.argv.slice(2)], { stdio: 'inherit' })
const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal)
}
process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))
child.once('error', (error) => {
  console.error('[e2e-local-ssh] unable to launch system ssh', error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
`
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      server.off('error', fail)
      reject(error)
    }
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Local SSH server did not expose a TCP port'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function stopChild(child: ChildProcess): void {
  if (!child.killed && child.exitCode === null) child.kill('SIGKILL')
}
