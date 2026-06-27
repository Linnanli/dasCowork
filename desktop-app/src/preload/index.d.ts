import { ElectronAPI } from '@electron-toolkit/preload'
import type { DesktopCodexApi, DesktopCodexChatApi } from '../shared/codexIpcApi'

declare global {
  interface Window {
    electron: ElectronAPI
    desktopCodex: DesktopCodexApi
    desktopCodexChat: DesktopCodexChatApi
  }
}
