export type WorkspaceKind = 'project' | 'projectless'

/**
 * Persisted only for a worktree that this desktop app created and owns.  The
 * renderer never supplies these values when asking main to inspect or restore
 * a workspace.
 */
export type ManagedWorktreeMetadata = {
  workspaceKind: 'managed-worktree'
  managedByApp: true
  repositoryRoot: string
  worktreePath: string
  branch: string
  ref: string
  createdFrom: 'conversation-fork' | 'new-task'
  recoverable: true
}

export type WorkspaceRecoveryState =
  | 'available'
  | 'checking-failed'
  | 'restorable'
  | 'restoring'
  | 'gone'
  | 'init-failed'
  | 'restore-failed'
  | 'remote-unavailable'
  | 'not-applicable'

export type WorkspaceRecoveryStatus = {
  state: WorkspaceRecoveryState
  message?: string
}

export type ProjectSelection =
  | { projectKind: 'local'; projectId: string }
  | { projectKind: 'remote'; projectId: string; hostId: string }
  | { projectKind: 'path'; path: string; hostId?: 'local' }
  | { projectKind: 'projectless' }

export type ThreadProjectAssignment =
  | {
      projectKind: 'local'
      projectId: string
      cwd: string | null
      path?: string
      pendingCoreUpdate?: boolean
      managedWorktree?: ManagedWorktreeMetadata
    }
  | {
      projectKind: 'remote'
      projectId: string
      hostId: string
      cwd: string | null
      pendingCoreUpdate?: boolean
    }
  | {
      projectKind: 'projectless'
      cwd: string | null
      workspaceRoot: string | null
      outputDirectory: string | null
      pendingCoreUpdate?: boolean
    }

export type ResolvedExecutionTarget = {
  hostId: string
  cwd: string | null
  /** Main-validated project/host shell override; never supplied by a terminal renderer request. */
  terminalCommand?: string
  workspaceRoots: string[]
  workspaceKind: WorkspaceKind
  projectAssignment?: ThreadProjectAssignment
}

export type WorkspaceRootOption = {
  root: string
  label?: string
  hostId: string
  addedAt: string
  lastOpenedAt: string
  missing?: boolean
}

export type LocalProject = {
  id: string
  kind: 'local'
  name: string
  hostId: 'local'
  createdAt: string
  updatedAt: string
  writableRoots: string[]
  defaultCwd?: string
}

export type RemoteProject = {
  id: string
  kind: 'remote'
  hostId: string
  label: string
  remotePath: string
  terminalCommand?: string
  createdAt: string
  updatedAt: string
}

export type ProjectState = {
  activeWorkspaceRoots?: string[]
  activeProjectSelection?: ProjectSelection
  workspaceRootOptions: WorkspaceRootOption[]
  localProjects: Record<string, LocalProject>
  remoteProjects: RemoteProject[]
  activeLocalProjectId?: string
  activeRemoteProjectId?: string
  projectOrder: string[]
  pinnedProjectIds: string[]
  projectWritableRoots: Record<string, string[]>
  threadProjectAssignments: Record<string, ThreadProjectAssignment>
  threadWritableRoots: Record<string, string[]>
  threadWorkspaceRootHints: Record<string, string[]>
  threadProjectlessOutputDirectories: Record<string, string | null>
  projectlessThreadIds: string[]
  projectlessHints: Record<string, { workspaceRoot: string | null; outputDirectory: string | null }>
}
