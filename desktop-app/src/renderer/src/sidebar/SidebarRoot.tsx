import type { ProjectStateController } from '../projects/useProjectState'
import { ScrollArea } from '../components/ui/scroll-area'
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3">
      <SidebarPrimaryActions nativeBackdrop={nativeBackdrop} onNewChat={onNewChat} />
      {conversationState.state.error ? (
        <button
          className="min-w-0 shrink-0 rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
          type="button"
          onClick={() => void conversationState.refresh()}
        >
          {conversationState.state.error}
        </button>
      ) : null}
      <ScrollArea className="min-h-0 w-full min-w-0 flex-1" aria-label="Projects and quick chats">
        <div className="w-full min-w-0 space-y-3 p-3">
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
      </ScrollArea>
    </div>
  )
}
