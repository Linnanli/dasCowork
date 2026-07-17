export type WorkspaceKind = 'project' | 'projectless'

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
