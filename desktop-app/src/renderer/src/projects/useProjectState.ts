import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  LocalProject,
  ProjectSelection,
  ProjectState
} from '../../../shared/projects/projectTypes'

export type ProjectStateController = {
  state: ProjectState | null
  hasSelection: boolean
  currentLabel: string
  currentDetail: string | null
  pickWorkspaceRoot: () => Promise<void>
  createLocalProject: (input: { name?: string; sourceRoots: string[] }) => Promise<LocalProject>
  selectProject: (selection: ProjectSelection) => Promise<void>
}

export function useProjectState(): ProjectStateController {
  const [state, setState] = useState<ProjectState | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.desktopApp.projects.getState().then((nextState) => {
      if (!cancelled) setState(nextState)
    })
    const removeStateListener = window.desktopApp.projects.onStateChange((nextState) => {
      setState(nextState)
    })

    return () => {
      cancelled = true
      removeStateListener()
    }
  }, [])

  const pickWorkspaceRoot = useCallback(async () => {
    const option = await window.desktopApp.projects.pickWorkspaceRoot()
    if (!option) return
    const nextState = await window.desktopApp.projects.getState()
    setState(nextState)
  }, [])

  const createLocalProject = useCallback(
    async (input: { name?: string; sourceRoots: string[] }) => {
      const project = await window.desktopApp.projects.createLocalProject(input)
      const nextState = await window.desktopApp.projects.getState()
      setState(nextState)
      return project
    },
    []
  )

  const selectProject = useCallback(async (selection: ProjectSelection) => {
    const nextState = await window.desktopApp.projects.selectProject(selection)
    setState(nextState)
  }, [])

  const summary = useMemo(() => describeProjectState(state), [state])

  return {
    state,
    hasSelection: summary.hasSelection,
    currentLabel: summary.label,
    currentDetail: summary.detail,
    pickWorkspaceRoot,
    createLocalProject,
    selectProject
  }
}

function describeProjectState(state: ProjectState | null): {
  hasSelection: boolean
  label: string
  detail: string | null
} {
  if (!state) return { hasSelection: false, label: 'Loading project', detail: null }

  const selection = state.activeProjectSelection
  if (selection?.projectKind === 'projectless') {
    return { hasSelection: true, label: 'Projectless', detail: 'Working without a project' }
  }

  if (selection?.projectKind === 'local') {
    const project = state.localProjects[selection.projectId]
    if (project) {
      return {
        hasSelection: true,
        label: project.name,
        detail:
          project.writableRoots.length === 1
            ? project.writableRoots[0]
            : `${project.writableRoots.length} roots`
      }
    }
  }

  if (selection?.projectKind === 'remote') {
    const project = state.remoteProjects.find((candidate) => candidate.id === selection.projectId)
    if (project) {
      return {
        hasSelection: true,
        label: project.label,
        detail: `${project.hostId}:${project.remotePath}`
      }
    }
  }

  if (selection?.projectKind === 'path') {
    return {
      hasSelection: true,
      label: selection.path.split(/[\\/]/).filter(Boolean).at(-1) ?? selection.path,
      detail: selection.path
    }
  }

  const activeRoots = state.activeWorkspaceRoots ?? []
  if (activeRoots.length > 0) {
    const root = activeRoots[0] ?? ''
    return {
      hasSelection: true,
      label: root.split(/[\\/]/).filter(Boolean).at(-1) ?? root,
      detail: activeRoots.length === 1 ? root : `${activeRoots.length} roots`
    }
  }

  return { hasSelection: false, label: 'Choose project', detail: null }
}
