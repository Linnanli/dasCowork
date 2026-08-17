import packageJson from '../../package.json'

export type CodexClientInfo = {
  name: string
  title: string
  version: string
}

export const desktopAppVersion = packageJson.version

export function createCodexClientInfo(name: string, title: string): CodexClientInfo {
  return { name, title, version: desktopAppVersion }
}
