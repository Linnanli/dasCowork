import type { SidebarConversation, SidebarPreferences } from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'

export type SidebarProjectGroup = {
  id: string
  label: string
  selection: ProjectSelection
  conversations: SidebarConversation[]
  threadCount: number
  warning?: string
  collapsed: boolean
  active: boolean
}

export type SidebarViewModel = {
  preferences: SidebarPreferences
  projectGroups: SidebarProjectGroup[]
  quickChats: SidebarConversation[]
  chronologicalChats: SidebarConversation[]
}
