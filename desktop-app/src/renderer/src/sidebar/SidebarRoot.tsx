import type { ProjectStateController } from '../projects/useProjectState'
import { buildSidebarViewModel } from './sidebarModel'
import { SidebarChatsSection } from './SidebarChatsSection'
import { SidebarPrimaryActions } from './SidebarPrimaryActions'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import type { ConversationStateController } from './useConversationState'

export function SidebarRoot({
  nativeBackdrop,
  projectState,
  conversationState,
  onNewChat
}: {
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
  onNewChat: () => void
}): React.JSX.Element {
  const model = buildSidebarViewModel({
    projectState: projectState.state,
    conversations: conversationState.state.conversations,
    preferences: conversationState.preferences
  })

  return (
    <div className="flex flex-col gap-4">
      <SidebarPrimaryActions nativeBackdrop={nativeBackdrop} onNewChat={onNewChat} />
      {conversationState.state.error ? (
        <button
          className="rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
          type="button"
          onClick={() => void conversationState.refresh()}
        >
          {conversationState.state.error}
        </button>
      ) : null}
      <SidebarProjectsSection
        groups={model.projectGroups}
        nativeBackdrop={nativeBackdrop}
        projectState={projectState}
        conversationState={conversationState}
        onNewChat={onNewChat}
      />
      <SidebarChatsSection
        quickChats={model.quickChats}
        chronologicalChats={model.chronologicalChats}
        showChronological={model.preferences.organizeMode === 'chronological'}
        nativeBackdrop={nativeBackdrop}
        conversationState={conversationState}
        onNewQuickChat={() => {
          onNewChat()
          void projectState.selectProject({ projectKind: 'projectless' })
        }}
      />
    </div>
  )
}
