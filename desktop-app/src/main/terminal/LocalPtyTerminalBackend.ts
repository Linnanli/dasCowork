import { createRequire } from 'node:module'

import type { TerminalBackend, TerminalExit } from './TerminalBackend'

const requireNodeModule = createRequire(__filename)

export type LocalPtySpawnOptions = {
  shell: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

type PtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

type NodePty = {
  spawn(
    file: string,
    args: string[],
    options: {
      cwd: string
      env: Record<string, string>
      cols: number
      rows: number
      name: string
    }
  ): PtyProcess
}

/** node-pty stays strictly in Electron main. */
export class LocalPtyTerminalBackend implements TerminalBackend {
  private readonly process: PtyProcess

  constructor(options: LocalPtySpawnOptions) {
    let pty: NodePty
    try {
      pty = requireNodeModule('node-pty') as NodePty
    } catch (error) {
      throw new Error(
        `Terminal support is unavailable because node-pty could not be loaded: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.process = pty.spawn(options.shell, options.args, {
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
      name: 'xterm-256color'
    })
  }

  write(data: string): void {
    this.process.write(data)
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows)
  }

  dispose(): void {
    this.process.kill()
  }

  onData(listener: (data: string) => void): () => void {
    const subscription = this.process.onData(listener)
    return () => subscription.dispose()
  }

  onExit(listener: (event: TerminalExit) => void): () => void {
    const subscription = this.process.onExit((event) =>
      listener({ exitCode: event.exitCode, signal: event.signal?.toString() ?? null })
    )
    return () => subscription.dispose()
  }

  onError(_listener: (error: Error) => void): () => void {
    // node-pty reports startup failure synchronously and runtime termination through onExit.
    void _listener
    return () => undefined
  }
}
