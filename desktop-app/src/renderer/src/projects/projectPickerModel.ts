import type {
  LocalProject,
  ProjectSelection,
  ProjectState,
  RemoteProject,
  WorkspaceRootOption
} from '../../../shared/projects/projectTypes'

export type ProjectPickerKind = 'local' | 'path' | 'remote'

export type ProjectPickerOption = {
  id: string
  kind: ProjectPickerKind
  label: string
  detail: string | null
  searchText: string
  selection: ProjectSelection
  selected: boolean
  missing: boolean
}

export type ProjectSelectionDescription = {
  kind: ProjectPickerKind | 'projectless'
  label: string
  detail: string | null
  missing: boolean
}

export function buildProjectPickerOptions(
  state: ProjectState,
  activeSelection: ProjectSelection | undefined
): ProjectPickerOption[] {
  const activeKey = projectSelectionKey(activeSelection)
  const localProjects = orderedLocalProjects(state)
  const coveredLocalRoots = new Set(localProjects.flatMap((project) => project.writableRoots))

  const localOptions = localProjects.map((project) => localProjectOption(state, project, activeKey))
  const pathOptions = state.workspaceRootOptions
    .filter((option) => option.hostId === 'local' && !coveredLocalRoots.has(option.root))
    .map((option) => pathProjectOption(option, activeKey))
  const remoteOptions = state.remoteProjects.map((project) =>
    remoteProjectOption(project, activeKey)
  )

  return [...localOptions, ...pathOptions, ...remoteOptions]
}

export function filterProjectPickerOptions(
  options: ProjectPickerOption[],
  query: string
): ProjectPickerOption[] {
  const normalizedQuery = normalizeSearch(query)
  if (!normalizedQuery) return options

  return options.filter((option) => normalizeSearch(option.searchText).includes(normalizedQuery))
}

export function projectSelectionKey(selection: ProjectSelection | null | undefined): string {
  if (!selection || selection.projectKind === 'projectless') return 'projectless'

  if (selection.projectKind === 'local') {
    return `local:${selection.projectId}`
  }
  if (selection.projectKind === 'remote') {
    return `remote:${selection.hostId}:${selection.projectId}`
  }
  return `path:${selection.path}`
}

export function describeProjectSelection(
  state: ProjectState,
  selection: ProjectSelection | undefined
): ProjectSelectionDescription {
  if (!selection || selection.projectKind === 'projectless') {
    return {
      kind: 'projectless',
      label: '选择项目',
      detail: null,
      missing: false
    }
  }

  if (selection.projectKind === 'local') {
    const project = state.localProjects[selection.projectId]
    if (!project) {
      return {
        kind: 'local',
        label: selection.projectId,
        detail: null,
        missing: true
      }
    }
    return {
      kind: 'local',
      label: project.name,
      detail: localProjectDetail(project),
      missing: hasMissingLocalRoot(state, project)
    }
  }

  if (selection.projectKind === 'remote') {
    const project = state.remoteProjects.find(
      (candidate) => candidate.id === selection.projectId && candidate.hostId === selection.hostId
    )
    if (!project) {
      return {
        kind: 'remote',
        label: selection.projectId,
        detail: selection.hostId,
        missing: true
      }
    }
    return {
      kind: 'remote',
      label: project.label,
      detail: remoteProjectDetail(project),
      missing: false
    }
  }

  const option = state.workspaceRootOptions.find(
    (candidate) => candidate.hostId === 'local' && candidate.root === selection.path
  )
  return {
    kind: 'path',
    label: option?.label ?? basename(selection.path),
    detail: selection.path,
    missing: option?.missing ?? false
  }
}

function orderedLocalProjects(state: ProjectState): LocalProject[] {
  const projectIds = unique([
    ...state.pinnedProjectIds,
    ...state.projectOrder,
    ...Object.keys(state.localProjects)
  ])

  return projectIds
    .map((projectId) => state.localProjects[projectId])
    .filter((project): project is LocalProject => Boolean(project))
}

function localProjectOption(
  state: ProjectState,
  project: LocalProject,
  activeKey: string
): ProjectPickerOption {
  const selection: ProjectSelection = {
    projectKind: 'local',
    projectId: project.id
  }
  const id = projectSelectionKey(selection)

  return {
    id,
    kind: 'local',
    label: project.name,
    detail: localProjectDetail(project),
    searchText: searchText([project.name, project.defaultCwd, ...project.writableRoots]),
    selection,
    selected: id === activeKey,
    missing: hasMissingLocalRoot(state, project)
  }
}

function pathProjectOption(option: WorkspaceRootOption, activeKey: string): ProjectPickerOption {
  const selection: ProjectSelection = {
    projectKind: 'path',
    path: option.root
  }
  const id = projectSelectionKey(selection)

  return {
    id,
    kind: 'path',
    label: option.label ?? basename(option.root),
    detail: option.root,
    searchText: searchText([option.label, option.root]),
    selection,
    selected: id === activeKey,
    missing: option.missing ?? false
  }
}

function remoteProjectOption(project: RemoteProject, activeKey: string): ProjectPickerOption {
  const selection: ProjectSelection = {
    projectKind: 'remote',
    projectId: project.id,
    hostId: project.hostId
  }
  const id = projectSelectionKey(selection)

  return {
    id,
    kind: 'remote',
    label: project.label,
    detail: remoteProjectDetail(project),
    searchText: searchText([project.label, project.hostId, project.remotePath]),
    selection,
    selected: id === activeKey,
    missing: false
  }
}

function localProjectDetail(project: LocalProject): string | null {
  if (project.writableRoots.length === 1) return project.writableRoots[0] ?? null
  if (project.writableRoots.length > 1) return `${project.writableRoots.length} roots`
  return project.defaultCwd ?? null
}

function remoteProjectDetail(project: RemoteProject): string {
  return `${project.hostId}:${project.remotePath}`
}

function hasMissingLocalRoot(state: ProjectState, project: LocalProject): boolean {
  const missingRoots = new Set(
    state.workspaceRootOptions
      .filter((option) => option.hostId === 'local' && option.missing)
      .map((option) => option.root)
  )
  return project.writableRoots.some((root) => missingRoots.has(root))
}

function searchText(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join('\n')
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
