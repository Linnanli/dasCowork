import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  WorkspaceRootOption
} from '../../shared/projects/projectTypes'
import type { ProjectStore } from './ProjectStore'

type LocalRootValidation = {
  realPath: string
}

export type ProjectApiServiceDependencies = {
  store: ProjectStore
  validateLocalRoot: (path: string) => Promise<LocalRootValidation>
  validateRemoteRoot?: (hostId: string, path: string) => Promise<void>
  pickWorkspaceRoot: () => Promise<string | null>
}

export type ProjectRenameInput =
  | { projectKind: 'local'; projectId: string; label: string }
  | { projectKind: 'remote'; projectId: string; label: string }
  | { projectKind: 'path'; path: string; label: string }

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

  async createRemoteProject(input: {
    hostId: string
    label: string
    remotePath: string
  }): Promise<RemoteProject> {
    await this.dependencies.validateRemoteRoot?.(input.hostId, input.remotePath)

    const now = new Date().toISOString()
    const project: RemoteProject = {
      id: randomUUID(),
      kind: 'remote',
      hostId: input.hostId,
      label: input.label.trim(),
      remotePath: input.remotePath,
      createdAt: now,
      updatedAt: now
    }
    const state = await this.dependencies.store.getState()

    await this.dependencies.store.setState({
      ...state,
      remoteProjects: [...state.remoteProjects, project],
      projectOrder: [
        ...state.projectOrder.filter((projectId) => projectId !== project.id),
        project.id
      ],
      activeLocalProjectId: undefined,
      activeRemoteProjectId: project.id,
      activeProjectSelection: {
        projectKind: 'remote',
        projectId: project.id,
        hostId: project.hostId
      },
      activeWorkspaceRoots: [project.remotePath]
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
      const trustedRoot = state.workspaceRootOptions.find(
        (option) => option.hostId === 'local' && option.root === realPath
      )
      if (!trustedRoot) {
        throw new Error(`Workspace root is not registered: ${selection.path}`)
      }
      const now = new Date().toISOString()
      const option = upsertWorkspaceRootOption(state.workspaceRootOptions, {
        root: realPath,
        label: trustedRoot.label ?? basename(realPath),
        hostId: 'local',
        addedAt: trustedRoot.addedAt,
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

  async removeProject(selection: ProjectSelection): Promise<ProjectState> {
    const state = await this.dependencies.store.getState()

    if (selection.projectKind === 'local') {
      if (!state.localProjects[selection.projectId]) {
        throw new Error(`Local project not found: ${selection.projectId}`)
      }
      const localProjects = { ...state.localProjects }
      delete localProjects[selection.projectId]
      const projectWritableRoots = { ...state.projectWritableRoots }
      delete projectWritableRoots[selection.projectId]
      const nextState = clearActiveSelection(
        {
          ...state,
          localProjects,
          projectWritableRoots,
          projectOrder: state.projectOrder.filter((projectId) => projectId !== selection.projectId),
          pinnedProjectIds: state.pinnedProjectIds.filter(
            (projectId) => projectId !== selection.projectId
          )
        },
        selection
      )
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    if (selection.projectKind === 'remote') {
      const project = state.remoteProjects.find((candidate) => candidate.id === selection.projectId)
      if (!project) throw new Error(`Remote project not found: ${selection.projectId}`)
      if (project.hostId !== selection.hostId) {
        throw new Error(`Remote project host mismatch: ${selection.projectId}`)
      }
      const nextState = clearActiveSelection(
        {
          ...state,
          remoteProjects: state.remoteProjects.filter(
            (candidate) => candidate.id !== selection.projectId
          ),
          projectOrder: state.projectOrder.filter((projectId) => projectId !== selection.projectId),
          pinnedProjectIds: state.pinnedProjectIds.filter(
            (projectId) => projectId !== selection.projectId
          )
        },
        selection
      )
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    if (selection.projectKind === 'path') {
      const { realPath } = await this.dependencies.validateLocalRoot(selection.path)
      const nextState = clearActiveSelection(
        {
          ...state,
          workspaceRootOptions: state.workspaceRootOptions.filter(
            (option) => option.hostId !== 'local' || option.root !== realPath
          )
        },
        { projectKind: 'path', path: realPath }
      )
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    const nextState = clearActiveSelection(state, selection)
    await this.dependencies.store.setState(nextState)
    return nextState
  }

  async renameProject(input: ProjectRenameInput): Promise<ProjectState> {
    const state = await this.dependencies.store.getState()
    const label = input.label.trim()

    if (input.projectKind === 'local') {
      const project = state.localProjects[input.projectId]
      if (!project) throw new Error(`Local project not found: ${input.projectId}`)
      const nextState = {
        ...state,
        localProjects: {
          ...state.localProjects,
          [input.projectId]: {
            ...project,
            name: label,
            updatedAt: new Date().toISOString()
          }
        }
      }
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    if (input.projectKind === 'remote') {
      const project = state.remoteProjects.find((candidate) => candidate.id === input.projectId)
      if (!project) throw new Error(`Remote project not found: ${input.projectId}`)
      const nextState = {
        ...state,
        remoteProjects: state.remoteProjects.map((candidate) =>
          candidate.id === input.projectId
            ? { ...candidate, label, updatedAt: new Date().toISOString() }
            : candidate
        )
      }
      await this.dependencies.store.setState(nextState)
      return nextState
    }

    const { realPath } = await this.dependencies.validateLocalRoot(input.path)
    const option = state.workspaceRootOptions.find(
      (candidate) => candidate.hostId === 'local' && candidate.root === realPath
    )
    if (!option) throw new Error(`Workspace root is not registered: ${input.path}`)
    const nextState = {
      ...state,
      workspaceRootOptions: state.workspaceRootOptions.map((candidate) =>
        candidate.hostId === 'local' && candidate.root === realPath
          ? { ...candidate, label }
          : candidate
      )
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

function clearActiveSelection(state: ProjectState, selection: ProjectSelection): ProjectState {
  if (!isActiveSelection(state.activeProjectSelection, selection)) {
    return state
  }

  return {
    ...state,
    activeLocalProjectId: undefined,
    activeRemoteProjectId: undefined,
    activeProjectSelection: undefined,
    activeWorkspaceRoots: []
  }
}

function isActiveSelection(
  activeSelection: ProjectSelection | undefined,
  selection: ProjectSelection
): boolean {
  if (!activeSelection) return false

  if (selection.projectKind === 'local') {
    return (
      activeSelection.projectKind === 'local' && activeSelection.projectId === selection.projectId
    )
  }

  if (selection.projectKind === 'remote') {
    return (
      activeSelection.projectKind === 'remote' &&
      activeSelection.projectId === selection.projectId &&
      activeSelection.hostId === selection.hostId
    )
  }

  if (selection.projectKind === 'path') {
    return activeSelection.projectKind === 'path' && activeSelection.path === selection.path
  }

  return activeSelection.projectKind === 'projectless'
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
