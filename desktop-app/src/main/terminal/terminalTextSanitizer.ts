import { TERMINAL_REPLAY_TAIL_MAX_CHARACTERS } from '../../shared/terminalWorkspaceApi'

/* eslint-disable no-control-regex -- this module removes terminal escape and control bytes. */
const controlSequence = /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2AB])/gu
const unsafeControl = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu

export function sanitizeTerminalText(value: string): { text: string; truncated: boolean } {
  const withoutSequences = value.replace(controlSequence, '').replace(unsafeControl, '')
  if (withoutSequences.length <= TERMINAL_REPLAY_TAIL_MAX_CHARACTERS) {
    return { text: withoutSequences, truncated: false }
  }
  return {
    text: withoutSequences.slice(-TERMINAL_REPLAY_TAIL_MAX_CHARACTERS),
    truncated: true
  }
}
