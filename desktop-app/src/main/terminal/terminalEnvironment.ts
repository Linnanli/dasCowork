export function terminalEnvironment(environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]]))
  )
  for (const key of Object.keys(env)) {
    if (key === 'TERMINFO' || key.startsWith('TERMINFO_')) delete env[key]
  }
  env.TERM = 'xterm-256color'
  return env
}
