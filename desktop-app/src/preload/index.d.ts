import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopComposerContextApi,
  DesktopConversationsApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'

export type DesktopAppApi = {
  environment: {
    platform: NodeJS.Platform
  }
  codex: DesktopCodexApi
  chat: DesktopCodexChatApi
  composerContext: DesktopComposerContextApi
  projects: DesktopProjectsApi
  conversations: DesktopConversationsApi
}

declare global {
  interface Window {
    desktopApp: DesktopAppApi
  }
}
