import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopConversationsApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'

export type DesktopAppApi = {
  environment: {
    platform: NodeJS.Platform
  }
  codex: DesktopCodexApi
  chat: DesktopCodexChatApi
  projects: DesktopProjectsApi
  conversations: DesktopConversationsApi
}

declare global {
  interface Window {
    desktopApp: DesktopAppApi
  }
}
