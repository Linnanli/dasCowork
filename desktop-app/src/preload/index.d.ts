import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopCodexFollowUpApi,
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
  followUps: DesktopCodexFollowUpApi
}

declare global {
  interface Window {
    desktopApp: DesktopAppApi
  }
}
