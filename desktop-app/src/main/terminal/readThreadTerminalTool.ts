import { sanitizeTerminalText } from './terminalTextSanitizer'

export type ThreadTerminalReader = (threadId: string) =>
  | {
      terminalAttached: boolean
      sessionId?: string
      cwd?: string
      status?: string
      exitCode?: number | null
      output?: string
      truncated?: boolean
    }
  | Promise<{
      terminalAttached: boolean
      sessionId?: string
      cwd?: string
      status?: string
      exitCode?: number | null
      output?: string
      truncated?: boolean
    }>

export async function readThreadTerminalToolResult(
  readThreadTerminal: ThreadTerminalReader,
  threadId: string | undefined
): Promise<{ terminalAttached: boolean; sessionId?: string; cwd?: string; status?: string; exitCode?: number | null; output?: string; truncated?: boolean }> {
  if (!threadId) return { terminalAttached: false }
  const result = await readThreadTerminal(threadId)
  if (!result.terminalAttached) return { terminalAttached: false }
  const sanitized = sanitizeTerminalText(result.output ?? '')
  return {
    terminalAttached: true,
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    ...(result.cwd ? { cwd: result.cwd } : {}),
    ...(result.status ? { status: result.status } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    output: sanitized.text,
    truncated: Boolean(result.truncated || sanitized.truncated)
  }
}
