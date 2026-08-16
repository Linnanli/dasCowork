export type CodexAppServerLaunchOptions = {
  command: string
  args: string[]
  cwd?: string
  displayBinary: string
  env?: NodeJS.ProcessEnv
}

export type CodexAppServerLaunchOptionsInput = {
  env?: NodeJS.ProcessEnv
}

const SERVER_ARGS = ['--listen', 'stdio://']
const CODEX_CLI_ARGS = ['app-server', ...SERVER_ARGS]

export function resolveCodexAppServerLaunchOptions(
  options: CodexAppServerLaunchOptionsInput = {}
): CodexAppServerLaunchOptions {
  const env = options.env ?? process.env
  const explicitBinary = env.CODEX_APP_SERVER_BIN
  if (explicitBinary) {
    return {
      command: explicitBinary,
      args: [...SERVER_ARGS],
      displayBinary: `${explicitBinary} ${SERVER_ARGS.join(' ')}`,
      env
    }
  }

  return {
    command: 'codex',
    args: [...CODEX_CLI_ARGS],
    displayBinary: `codex ${CODEX_CLI_ARGS.join(' ')}`,
    env
  }
}
