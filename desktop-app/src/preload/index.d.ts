import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopConversationsApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'

export type DesktopAppApi = {
  electron: ElectronAPI
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
