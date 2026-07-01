import { PlusIcon } from 'lucide-react'

import type { ProjectStateController } from '../projects/useProjectState'
import { ProjectGroupRow } from './ProjectGroupRow'
import type { SidebarProjectGroup } from './sidebarTypes'
import type { ConversationStateController } from './useConversationState'

export function SidebarProjectsSection({
  groups,
  nativeBackdrop,
  projectState,
  conversationState,
  onNewChat
}: {
  groups: SidebarProjectGroup[]
  nativeBackdrop: boolean
  projectState: ProjectStateController
  conversationState: ConversationStateController
  onNewChat: () => void
}): React.JSX.Element {
  const toggleGroupCollapsed = (group: SidebarProjectGroup): void => {
    const collapsedGroupIds = group.collapsed
      ? conversationState.preferences.collapsedGroupIds.filter((groupId) => groupId !== group.id)
      : [...conversationState.preferences.collapsedGroupIds, group.id]

    void conversationState.setPreferences({ collapsedGroupIds })
  }

  return (
    <section className="min-w-0 space-y-1" aria-label="Projects">
      <div className="flex min-w-0 items-center justify-between px-2 text-[11px] text-muted-foreground uppercase">
        <span className="min-w-0 truncate">Projects</span>
        <button
          aria-label="Open folder"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Open folder"
          type="button"
          onClick={() => void projectState.pickWorkspaceRoot()}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-w-0 space-y-0.5">
        {groups.length === 0 ? (
          <button
            className="w-full min-w-0 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
            type="button"
            onClick={() => void projectState.pickWorkspaceRoot()}
          >
            Open a local project folder
          </button>
        ) : (
          groups.map((group) => (
            <ProjectGroupRow
              key={group.id}
              group={group}
              nativeBackdrop={nativeBackdrop}
              onToggleCollapsed={() => toggleGroupCollapsed(group)}
              onNewChat={() => {
                onNewChat()
                void projectState.selectProject(group.selection)
              }}
              onRemoveProject={() => void projectState.removeProject(group.selection)}
              onOpenConversation={(conversationId) =>
                void conversationState.openConversation({ conversationId })
              }
              onInterruptConversation={(conversationId) =>
                void conversationState.interruptConversation({ conversationId })
              }
            />
          ))
        )}
      </div>
    </section>
  )
}
