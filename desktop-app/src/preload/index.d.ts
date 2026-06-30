import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DesktopCodexApi,
  DesktopCodexChatApi,
  DesktopProjectsApi
} from '../shared/codexIpcApi'

export type DesktopAppApi = {
  electron: ElectronAPI
  codex: DesktopCodexApi
  chat: DesktopCodexChatApi
  projects: DesktopProjectsApi
}

declare global {
  interface Window {
    desktopApp: DesktopAppApi
  }
}
