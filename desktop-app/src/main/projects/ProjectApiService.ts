import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  WorkspaceRootOption
} from '../../shared/projects/projectTypes'
import type { ProjectStore } from './ProjectStore'

type LocalRootValidation = {
  realPath: string
}

export type ProjectApiServiceDependencies = {
  store: ProjectStore
  validateLocalRoot: (path: string) => Promise<LocalRootValidation>
  pickWorkspaceRoot: () => Promise<string | null>
}

export class ProjectApiService {
  constructor(private readonly dependencies: ProjectApiServiceDependencies) {}

  getState(): Promise<ProjectState> {
    return this.dependencies.store.getState()
  }

  async pickWorkspaceRoot(): Promise<WorkspaceRootOption | null> {
    const selectedPath = await this.dependencies.pickWorkspaceRoot()
    if (!selectedPath) return null

    const { realPath } = await this.dependencies.validateLocalRoot(selectedPath)
    const now = new Date().toISOString()
    const state = await this.dependencies.store.getState()
    const option = upsertWorkspaceRootOption(state.workspaceRootOptions, {
      root: realPath,
      label: basename(realPath),
      hostId: 'local',
      addedAt: now,
      lastOpenedAt: now
    })

    await this.dependencies.store.setState({
      ...state,
      workspaceRootOptions: option.options,
      activeLocalProjectId: undefined,
      activeRemoteProjectId: undefined,
      activeProjectSelection: { projectKind: 'path', path: realPath },
      activeWorkspaceRoots: [realPath]
    })

    return option.current
  }

  async createLocalProject(input: { name?: string; sourceRoots: string[] }): Promise<LocalProject> {
    const roots = await this.validateLocalRoots(input.sourceRoots)
    const now = new Date().toISOString()
    const id = randomUUID()
    const project: LocalProject = {
      id,
      kind: 'local',
      name: input.name?.trim() || basename(roots[0] ?? id),
      hostId: 'local',
      createdAt: now,
      updatedAt: now,
      writableRoots: roots,
      defaultCwd: roots[0]
    }
    const state = await this.dependencies.store.getState()

    await this.dependencies.store.setState({
      ...state,
      localProjects: {
        ...state.localProjects,
        [id]: project
      },
      projectOrder: [...state.projectOrder.filter((projectId) => projectId !== id), id],
      projectWritableRoots: {
        ...state.projectWritableRoots,
        [id]: roots
      },
      activeLocalProjectId: id,
      activeRemoteProjectId: undefined,
      activeProjectSelection: { projectKind: 'local', projectId: id },
      activeWorkspaceRoots: roots
    })

    return project
  }

  async selectProject(selection: ProjectSelection): Promise<ProjectState> {
    const state = await this.dependencies.store.getState()

    if (selection.projectKind === 'local') {
      const project = state.localProjects[selection.projectId]
      if (!project) throw new Error(`Local project not found: ${selection.projectId}`)
      const roots = await this.validateLocalRoots(project.writableRoots)
      const nextState: ProjectState = {
        ...state,
        activeLocalProjectId: project.id,
        activeRemoteProjectId: undefined,
        activeProjectSelection: selection,
        activeWorkspaceRoots: roots
      }
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    if (selection.projectKind === 'remote') {
      const project = state.remoteProjects.find((candidate) => candidate.id === selection.projectId)
      if (!project) throw new Error(`Remote project not found: ${selection.projectId}`)
      if (project.hostId !== selection.hostId) {
        throw new Error(`Remote project host mismatch: ${selection.projectId}`)
      }
      const nextState: ProjectState = {
        ...state,
        activeLocalProjectId: undefined,
        activeRemoteProjectId: project.id,
        activeProjectSelection: selection,
        activeWorkspaceRoots: [project.remotePath]
      }
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    if (selection.projectKind === 'path') {
      const { realPath } = await this.dependencies.validateLocalRoot(selection.path)
      const now = new Date().toISOString()
      const option = upsertWorkspaceRootOption(state.workspaceRootOptions, {
        root: realPath,
        label: basename(realPath),
        hostId: 'local',
        addedAt: now,
        lastOpenedAt: now
      })
      const nextState: ProjectState = {
        ...state,
        workspaceRootOptions: option.options,
        activeLocalProjectId: undefined,
        activeRemoteProjectId: undefined,
        activeProjectSelection: { projectKind: 'path', path: realPath },
        activeWorkspaceRoots: [realPath]
      }
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    const nextState: ProjectState = {
      ...state,
      activeLocalProjectId: undefined,
      activeRemoteProjectId: undefined,
      activeProjectSelection: { projectKind: 'projectless' },
      activeWorkspaceRoots: []
    }
    await this.dependencies.store.setState(nextState)
    return nextState
  }

  private async validateLocalRoots(paths: string[]): Promise<string[]> {
    const roots = new Set<string>()

    for (const path of paths) {
      const { realPath } = await this.dependencies.validateLocalRoot(path)
      roots.add(realPath)
    }

    const validatedRoots = [...roots]
    if (validatedRoots.length === 0)
      throw new Error('Local project requires at least one source root')
    return validatedRoots
  }
}

function upsertWorkspaceRootOption(
  options: WorkspaceRootOption[],
  next: WorkspaceRootOption
): { current: WorkspaceRootOption; options: WorkspaceRootOption[] } {
  const existing = options.find(
    (option) => option.root === next.root && option.hostId === next.hostId
  )
  const current = {
    ...next,
    addedAt: existing?.addedAt ?? next.addedAt
  }

  return {
    current,
    options: [
      current,
      ...options.filter((option) => option.root !== next.root || option.hostId !== next.hostId)
    ]
  }
}
