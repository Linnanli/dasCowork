import { TERMINAL_REPLAY_TAIL_MAX_CHARACTERS } from '../../shared/terminalWorkspaceApi'

export type TerminalOutputSnapshot = {
  output: string
  truncated: boolean
}

/** Keeps only the renderer/AI-safe replay tail; live terminal output never grows without bound. */
export class TerminalOutputBuffer {
  private value = ''
  private wasTruncated = false

  append(data: string): void {
    if (!data) return
    const next = `${this.value}${data}`
    if (next.length <= TERMINAL_REPLAY_TAIL_MAX_CHARACTERS) {
      this.value = next
      return
    }
    this.value = next.slice(-TERMINAL_REPLAY_TAIL_MAX_CHARACTERS)
    this.wasTruncated = true
  }

  snapshot(): TerminalOutputSnapshot {
    return { output: this.value, truncated: this.wasTruncated }
  }
}
