import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopCodexFollowUpApi,
  DesktopComposerContextApi,
  DesktopConversationsApi,
  DesktopGitApi,
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
  git: DesktopGitApi
}

declare global {
  interface Window {
    desktopApp: DesktopAppApi
  }
}
