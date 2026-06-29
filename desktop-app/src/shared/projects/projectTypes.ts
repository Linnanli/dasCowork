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
