export type TerminalExit = {
  exitCode: number | null
  signal: string | null
}

export interface TerminalBackend {
  write(data: string): Promise<void> | void
  resize(cols: number, rows: number): Promise<void> | void
  dispose(): Promise<void> | void
  onData(listener: (data: string) => void): () => void
  onExit(listener: (event: TerminalExit) => void): () => void
  onError(listener: (error: Error) => void): () => void
  onConnectionLost?(listener: (error: Error) => void): () => void
}
