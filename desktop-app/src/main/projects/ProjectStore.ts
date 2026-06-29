import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ThreadProjectAssignment } from '../../shared/projects/projectTypes'

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

export function createDefaultProjectState(): ProjectState {
  return {
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
}

function cloneState(state: ProjectState): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState
}

export class ProjectStore {
  private state: ProjectState

  private constructor(private readonly filePath?: string, initialState = createDefaultProjectState()) {
    this.state = cloneState(initialState)
  }

  static inMemory(initialState?: ProjectState): ProjectStore {
    return new ProjectStore(undefined, initialState)
  }

  static onDisk(filePath: string, initialState?: ProjectState): ProjectStore {
    return new ProjectStore(filePath, initialState)
  }

  async getState(): Promise<ProjectState> {
    if (!this.filePath) {
      return cloneState(this.state)
    }

    try {
      const contents = await readFile(this.filePath, 'utf8')
      this.state = JSON.parse(contents) as ProjectState
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error
      }
    }

    return cloneState(this.state)
  }

  async setState(state: ProjectState): Promise<void> {
    this.state = cloneState(state)

    if (!this.filePath) {
      return
    }

    await writeJsonAtomically(this.filePath, this.state)
  }
}

async function writeJsonAtomically(filePath: string, state: ProjectState): Promise<void> {
  const directory = dirname(filePath)
  const tempPath = join(
    directory,
    `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  )

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
