import type {
  LocalProject,
  ProjectState,
  RemoteProject
} from '../../../shared/projects/projectTypes'

export type ThreadProjectSection = {
  key: string
  title: string
  groups: ThreadProjectGroup[]
}

export type ThreadProjectGroup = {
  key: string
  label: string
  detail?: string
  threadCount: number
  warning?: string
}

export function buildThreadProjectSections(
  state: ProjectState | null,
  currentLabel: string,
  currentDetail: string | null
): ThreadProjectSection[] {
  if (!state) {
    return [
      {
        key: 'current',
        title: 'Current project',
        groups: [
          {
            key: 'loading',
            label: currentLabel,
            detail: currentDetail ?? undefined,
            threadCount: 0
          }
        ]
      }
    ]
  }

  const sections: ThreadProjectSection[] = []
  const pinnedProjectIds = new Set(state.pinnedProjectIds)
  const pinnedProjects = state.pinnedProjectIds
    .map((projectId) => state.localProjects[projectId])
    .filter((project): project is LocalProject => Boolean(project))
  const localProjects = state.projectOrder
    .map((projectId) => state.localProjects[projectId])
    .filter((project): project is LocalProject => Boolean(project))
    .filter((project) => !pinnedProjectIds.has(project.id))

  if (pinnedProjects.length > 0) {
    sections.push({
      key: 'pinned',
      title: 'Pinned',
      groups: pinnedProjects.map((project) => localProjectGroup(state, project))
    })
  }

  if (localProjects.length > 0) {
    sections.push({
      key: 'local',
      title: 'Local projects',
      groups: localProjects.map((project) => localProjectGroup(state, project))
    })
  }

  if (state.remoteProjects.length > 0) {
    sections.push({
      key: 'remote',
      title: 'Remote projects',
      groups: state.remoteProjects.map((project) => remoteProjectGroup(state, project))
    })
  }

  const projectlessThreadCount =
    state.projectlessThreadIds.length ||
    Object.values(state.threadProjectAssignments).filter(
      (assignment) => assignment.projectKind === 'projectless'
    ).length
  if (projectlessThreadCount > 0 || state.activeProjectSelection?.projectKind === 'projectless') {
    sections.push({
      key: 'projectless',
      title: 'Projectless',
      groups: [
        {
          key: 'projectless',
          label: 'Projectless',
          detail: projectlessDetail(state),
          threadCount: projectlessThreadCount
        }
      ]
    })
  }

  if (state.activeProjectSelection?.projectKind === 'path') {
    const activePath = state.activeProjectSelection.path
    const option = state.workspaceRootOptions.find((candidate) => candidate.root === activePath)
    sections.push({
      key: 'current-path',
      title: 'Current project',
      groups: [
        {
          key: `path:${activePath}`,
          label: option?.label ?? currentLabel,
          detail: activePath,
          threadCount: countPathThreads(state, activePath),
          warning: option?.missing ? 'Workspace root is missing' : undefined
        }
      ]
    })
  }

  if (sections.length === 0) {
    sections.push({
      key: 'current',
      title: 'Current project',
      groups: [
        { key: 'current', label: currentLabel, detail: currentDetail ?? undefined, threadCount: 0 }
      ]
    })
  }

  return sections
}

function localProjectGroup(state: ProjectState, project: LocalProject): ThreadProjectGroup {
  const missingRoots = missingLocalRoots(state, project.writableRoots)

  return {
    key: `local:${project.id}`,
    label: project.name,
    detail:
      project.writableRoots.length === 1
        ? project.writableRoots[0]
        : `${project.writableRoots.length} roots`,
    threadCount: Object.values(state.threadProjectAssignments).filter(
      (assignment) => assignment.projectKind === 'local' && assignment.projectId === project.id
    ).length,
    warning: missingRoots.length > 0 ? `Missing roots: ${missingRoots.join(', ')}` : undefined
  }
}

function remoteProjectGroup(state: ProjectState, project: RemoteProject): ThreadProjectGroup {
  return {
    key: `remote:${project.hostId}:${project.id}`,
    label: project.label,
    detail: `${project.hostId}:${project.remotePath}`,
    threadCount: Object.values(state.threadProjectAssignments).filter(
      (assignment) =>
        assignment.projectKind === 'remote' &&
        assignment.projectId === project.id &&
        assignment.hostId === project.hostId
    ).length
  }
}

function missingLocalRoots(state: ProjectState, roots: string[]): string[] {
  return roots.filter((root) =>
    state.workspaceRootOptions.some(
      (option) => option.hostId === 'local' && option.root === root && option.missing
    )
  )
}

function countPathThreads(state: ProjectState, path: string): number {
  return Object.values(state.threadProjectAssignments).filter(
    (assignment) =>
      (assignment.projectKind === 'local' &&
        (assignment.path === path || assignment.cwd === path)) ||
      (assignment.projectKind === 'projectless' && assignment.workspaceRoot === path)
  ).length
}

function projectlessDetail(state: ProjectState): string | undefined {
  const hints = Object.values(state.projectlessHints)
  const firstHint = hints.find((hint) => hint.workspaceRoot || hint.outputDirectory)
  if (!firstHint) return undefined
  if (firstHint.workspaceRoot && firstHint.outputDirectory) {
    return `${firstHint.workspaceRoot} -> ${firstHint.outputDirectory}`
  }
  return firstHint.workspaceRoot ?? firstHint.outputDirectory ?? undefined
}
