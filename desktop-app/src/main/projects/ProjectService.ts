import type {
  ProjectSelection,
  ResolvedExecutionTarget,
  ThreadProjectAssignment
} from '../../shared/projects/projectTypes'
import type { ProjectStore, ProjectState, LocalProject, RemoteProject } from './ProjectStore'

type LocalRootValidation = {
  realPath: string
}

type ProjectlessWorkspace = {
  cwd: string
  workspaceRoot: string
  outputDirectory: string
}

type ThreadReadResult = {
  thread?: {
    cwd?: string | null
  }
}

export type ThreadReader = (threadId: string) => Promise<ThreadReadResult>

export type ProjectServiceDependencies = {
  store: ProjectStore
  validateLocalRoot: (path: string) => Promise<LocalRootValidation>
  validateLocalRoots?: (paths: string[]) => Promise<string[]>
  validateRemoteRoot: (hostId: string, path: string) => Promise<void>
  createProjectlessWorkspace: (input: { prompt: string }) => Promise<ProjectlessWorkspace>
  readThread?: ThreadReader
}

export type ResolveNewThreadTargetInput = {
  selection?: ProjectSelection | null
  prompt: string
}

export type ResolveExistingThreadTargetInput = {
  conversationId: string
  threadId?: string | null
  routeFallback?: ResolvedExecutionTarget | null
  allowActiveProjectFallback?: boolean
}

export class ProjectService {
  constructor(private readonly dependencies: ProjectServiceDependencies) {}

  async resolveNewThreadTarget(
    input: ResolveNewThreadTargetInput
  ): Promise<ResolvedExecutionTarget> {
    const selection = input.selection

    if (!selection || selection.projectKind === 'projectless') {
      return this.resolveProjectlessTarget(input.prompt)
    }

    if (selection.projectKind === 'local') {
      const state = await this.dependencies.store.getState()
      const project = state.localProjects[selection.projectId]

      if (!project) {
        throw new Error(`Local project not found: ${selection.projectId}`)
      }

      return this.resolveLocalProject(project)
    }

    if (selection.projectKind === 'remote') {
      const state = await this.dependencies.store.getState()
      const project = state.remoteProjects.find((candidate) => candidate.id === selection.projectId)

      if (!project) {
        throw new Error(`Remote project not found: ${selection.projectId}`)
      }

      if (project.hostId !== selection.hostId) {
        throw new Error(
          `Remote project host mismatch: ${selection.projectId} is on ${project.hostId}, not ${selection.hostId}`
        )
      }

      return this.resolveRemoteProject(project)
    }

    const { realPath } = await this.dependencies.validateLocalRoot(selection.path)

    return {
      hostId: 'local',
      cwd: realPath,
      workspaceRoots: [realPath],
      workspaceKind: 'project',
      projectAssignment: {
        projectKind: 'local',
        projectId: realPath,
        path: realPath,
        cwd: realPath
      }
    }
  }

  async resolveExistingThreadTarget(
    input: ResolveExistingThreadTargetInput
  ): Promise<ResolvedExecutionTarget | null> {
    const state = await this.dependencies.store.getState()
    const assignment = state.threadProjectAssignments[input.conversationId]

    if (assignment) {
      return this.resolveAssignmentTarget(assignment, state)
    }

    const threadCwd = await this.readThreadCwd(input.threadId)
    if (threadCwd) {
      return {
        hostId: 'local',
        cwd: threadCwd,
        workspaceRoots: [threadCwd],
        workspaceKind: 'project'
      }
    }

    if (input.routeFallback) {
      return input.routeFallback
    }

    if (input.allowActiveProjectFallback && !input.threadId) {
      return this.resolveActiveProjectFallback(state)
    }

    return null
  }

  private async resolveProjectlessTarget(prompt: string): Promise<ResolvedExecutionTarget> {
    const generated = await this.dependencies.createProjectlessWorkspace({ prompt })

    return {
      hostId: 'local',
      cwd: generated.cwd,
      workspaceRoots: [generated.workspaceRoot],
      workspaceKind: 'projectless',
      projectAssignment: {
        projectKind: 'projectless',
        cwd: generated.cwd,
        workspaceRoot: generated.workspaceRoot,
        outputDirectory: generated.outputDirectory
      }
    }
  }

  private async resolveLocalProject(project: LocalProject): Promise<ResolvedExecutionTarget> {
    const roots = await this.validateLocalRoots(project.writableRoots)
    const cwd = project.defaultCwd ?? roots[0] ?? null

    if (project.defaultCwd) {
      await this.dependencies.validateLocalRoot(project.defaultCwd)
    }

    return {
      hostId: 'local',
      cwd,
      workspaceRoots: roots,
      workspaceKind: 'project',
      projectAssignment: {
        projectKind: 'local',
        projectId: project.id,
        cwd
      }
    }
  }

  private async resolveRemoteProject(project: RemoteProject): Promise<ResolvedExecutionTarget> {
    await this.dependencies.validateRemoteRoot(project.hostId, project.remotePath)

    return {
      hostId: project.hostId,
      cwd: project.remotePath,
      workspaceRoots: [project.remotePath],
      workspaceKind: 'project',
      projectAssignment: {
        projectKind: 'remote',
        projectId: project.id,
        hostId: project.hostId,
        cwd: project.remotePath
      }
    }
  }

  private async validateLocalRoots(paths: string[]): Promise<string[]> {
    if (this.dependencies.validateLocalRoots) {
      return this.dependencies.validateLocalRoots(paths)
    }

    const roots: string[] = []

    for (const path of paths) {
      const { realPath } = await this.dependencies.validateLocalRoot(path)
      roots.push(realPath)
    }

    return roots
  }

  private async readThreadCwd(threadId?: string | null): Promise<string | null> {
    if (!threadId || !this.dependencies.readThread) {
      return null
    }

    const result = await this.dependencies.readThread(threadId)

    return result.thread?.cwd ?? null
  }

  private resolveAssignmentTarget(
    assignment: ThreadProjectAssignment,
    state: ProjectState
  ): ResolvedExecutionTarget {
    if (assignment.projectKind === 'remote') {
      return {
        hostId: assignment.hostId,
        cwd: assignment.cwd,
        workspaceRoots: assignment.cwd ? [assignment.cwd] : [],
        workspaceKind: 'project',
        projectAssignment: assignment
      }
    }

    if (assignment.projectKind === 'projectless') {
      return {
        hostId: 'local',
        cwd: assignment.cwd,
        workspaceRoots: assignment.workspaceRoot ? [assignment.workspaceRoot] : [],
        workspaceKind: 'projectless',
        projectAssignment: assignment
      }
    }

    const project = state.localProjects[assignment.projectId]
    const workspaceRoots = project?.writableRoots ?? (assignment.cwd ? [assignment.cwd] : [])

    return {
      hostId: 'local',
      cwd: assignment.cwd,
      workspaceRoots,
      workspaceKind: 'project',
      projectAssignment: assignment
    }
  }

  private async resolveActiveProjectFallback(
    state: ProjectState
  ): Promise<ResolvedExecutionTarget | null> {
    if (state.activeLocalProjectId) {
      const project = state.localProjects[state.activeLocalProjectId]

      if (!project) {
        throw new Error(`Active local project not found: ${state.activeLocalProjectId}`)
      }

      return this.resolveLocalProject(project)
    }

    if (state.activeRemoteProjectId) {
      const project = state.remoteProjects.find(
        (candidate) => candidate.id === state.activeRemoteProjectId
      )

      if (!project) {
        throw new Error(`Active remote project not found: ${state.activeRemoteProjectId}`)
      }

      return this.resolveRemoteProject(project)
    }

    return null
  }
}
