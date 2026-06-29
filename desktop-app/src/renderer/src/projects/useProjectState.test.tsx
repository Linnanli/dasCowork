// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopProjectsApi } from '../../../shared/codexIpcApi'
import type { ProjectState } from '../../../shared/projects/projectTypes'
import { useProjectState, type ProjectStateController } from './useProjectState'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const emptyState: ProjectState = {
  workspaceRootOptions: [],
  localProjects: {},
  remoteProjects: [],
  projectOrder: [],
  pinnedProjectIds: [],
  projectWritableRoots: {},
  threadProjectAssignments: {},
  threadWritableRoots: {},
  threadWorkspaceRootHints: {},
  threadProjectlessOutputDirectories: {},
  projectlessThreadIds: [],
  projectlessHints: {}
}

describe('useProjectState', () => {
  let container: HTMLDivElement
  let root: Root
  let controller: ProjectStateController | null
  let stateChange: ((state: ProjectState) => void) | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    controller = null
    stateChange = null
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('loads project state and updates from subscriptions', async () => {
    const selectedState: ProjectState = {
      ...emptyState,
      activeProjectSelection: { projectKind: 'projectless' },
      activeWorkspaceRoots: []
    }
    installDesktopProjects({
      getState: vi.fn().mockResolvedValue(emptyState),
      onStateChange: (callback) => {
        stateChange = callback
        return vi.fn()
      },
      selectProject: vi.fn().mockResolvedValue(selectedState)
    })

    await act(async () => {
      root.render(<Probe onController={(nextController) => (controller = nextController)} />)
    })

    expect(controller?.hasSelection).toBe(false)

    await act(async () => {
      stateChange?.(selectedState)
    })

    expect(controller?.hasSelection).toBe(true)
    expect(controller?.currentLabel).toBe('Projectless')
  })

  it('selects projectless mode through the desktop project bridge', async () => {
    const selectProject = vi.fn().mockResolvedValue({
      ...emptyState,
      activeProjectSelection: { projectKind: 'projectless' },
      activeWorkspaceRoots: []
    } satisfies ProjectState)
    installDesktopProjects({
      getState: vi.fn().mockResolvedValue(emptyState),
      onStateChange: vi.fn(() => vi.fn()),
      selectProject
    })

    await act(async () => {
      root.render(<Probe onController={(nextController) => (controller = nextController)} />)
    })
    await act(async () => {
      await controller?.selectProject({ projectKind: 'projectless' })
    })

    expect(selectProject).toHaveBeenCalledWith({ projectKind: 'projectless' })
    expect(controller?.currentLabel).toBe('Projectless')
  })
})

function Probe({
  onController
}: {
  onController: (controller: ProjectStateController) => void
}): null {
  const projectState = useProjectState()

  useEffect(() => {
    onController(projectState)
  }, [onController, projectState])

  return null
}

function installDesktopProjects(overrides: Partial<DesktopProjectsApi>): void {
  vi.stubGlobal('desktopProjects', {
    getState: vi.fn().mockResolvedValue(emptyState),
    pickWorkspaceRoot: vi.fn().mockResolvedValue(null),
    createLocalProject: vi.fn(),
    selectProject: vi.fn(),
    createFuzzyFileSearchSession: vi.fn().mockResolvedValue({ results: [] }),
    onStateChange: vi.fn(() => vi.fn()),
    ...overrides
  } satisfies DesktopProjectsApi)
}
