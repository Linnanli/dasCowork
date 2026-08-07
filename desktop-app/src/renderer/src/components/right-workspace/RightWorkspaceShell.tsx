import type { ReactNode } from 'react'

import {
  WorkspacePanelShell,
  type WorkspaceOpenTarget,
  type WorkspaceTabRecord
} from '../workspace-container'
import { useRightWorkspace } from './RightWorkspaceProvider'
import { WorkspaceLauncher } from './WorkspaceLauncher'
import type { RightWorkspaceTab, RightWorkspaceTabType } from './workspaceState'

type Props = {
  className?: string
  renderTab?(tab: RightWorkspaceTab | undefined): ReactNode
  onTabClosed?(tab: RightWorkspaceTab): void
  onOverlayVisibilityChange?(visible: boolean): void
}

/** Compatibility facade that keeps the previous right-workspace API intact. */
export function RightWorkspaceShell({
  className,
  renderTab,
  onTabClosed,
  onOverlayVisibilityChange
}: Props): React.JSX.Element {
  const workspace = useRightWorkspace()
  const tabs = workspace.state.tabs.map(toDescriptor)
  const panel = {
    id: 'right' as const,
    isOpen: workspace.state.isOpen,
    isMaximized: workspace.state.isMaximized,
    size: workspace.state.panelWidth,
    tabIds: tabs.map((tab) => tab.id),
    activeTabId: workspace.state.activeTabId,
    activationHistory: []
  }

  function setOpen(isOpen: boolean): void {
    if (isOpen) {
      workspace.restore()
      return
    }
    workspace.collapse()
  }

  return (
    <WorkspacePanelShell
      panelId="right"
      panel={panel}
      tabs={tabs}
      className={className}
      renderLauncher={() => <WorkspaceLauncher />}
      renderTab={(tab) =>
        renderTab?.(workspace.state.tabs.find((candidate) => candidate.id === tab?.id))
      }
      onActivate={workspace.activateTab}
      onClose={(tabId) => {
        const tab = workspace.state.tabs.find((candidate) => candidate.id === tabId)
        if (tab) onTabClosed?.(tab)
        workspace.closeTab(tabId)
      }}
      onOpen={(target) => openTarget(workspace, target)}
      onSetSize={workspace.setPanelWidth}
      onSetOpen={setOpen}
      onOverlayVisibilityChange={onOverlayVisibilityChange}
    />
  )
}

function openTarget(
  workspace: ReturnType<typeof useRightWorkspace>,
  target: WorkspaceOpenTarget
): void {
  if (target.type === 'review') return workspace.openReview(target.source)
  if (target.type === 'file') return workspace.openFile(target.relativePath, target.title)
  workspace.openTab(target.type as Exclude<RightWorkspaceTabType, 'review' | 'file'>)
}

function toDescriptor(tab: RightWorkspaceTab): WorkspaceTabRecord {
  if (tab.type === 'file') {
    return {
      id: tab.id,
      kind: 'file',
      title: tab.title,
      props: { relativePath: tab.relativePath },
      isPreview: false,
      isClosable: true
    }
  }
  return {
    id: tab.id,
    kind: tab.type,
    title: tab.title,
    props: {},
    isPreview: false,
    isClosable: true
  }
}
