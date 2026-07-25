import { createHash } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ProjectApiService } from './ProjectApiService'
import { ProjectService, type ThreadReader } from './ProjectService'
import { ProjectStore } from './ProjectStore'
import { WorkspaceRecoveryService } from './WorkspaceRecoveryService'

export type ProjectRuntimeServices = {
  projectStore: ProjectStore
  projectService: ProjectService
  projectApi: ProjectApiService
  workspaceRecovery: WorkspaceRecoveryService
}

export function createProjectRuntimeServices({
  userDataPath,
  documentsPath = join(userDataPath, 'Documents'),
  readThread,
  pickWorkspaceRoot
}: {
  userDataPath: string
  documentsPath?: string
  readThread?: ThreadReader
  pickWorkspaceRoot?: () => Promise<string | null>
}): ProjectRuntimeServices {
  const blankProjectRootOperations = new Map<string, { name: string; root: Promise<string> }>()
  const projectStore = ProjectStore.onDisk(join(userDataPath, 'projects', 'state.json'))
  const projectService = new ProjectService({
    store: projectStore,
    validateLocalRoot,
    validateRemoteRoot: async () => undefined,
    createProjectlessWorkspace: ({ prompt }) =>
      createProjectlessWorkspace({ userDataPath, prompt }),
    readThread
  })
  const projectApi = new ProjectApiService({
    store: projectStore,
    validateLocalRoot,
    validateRemoteRoot: async () => undefined,
    pickWorkspaceRoot: pickWorkspaceRoot ?? (async () => null),
    createBlankProjectRoot: (name, operationId) => {
      const existingOperation = blankProjectRootOperations.get(operationId)
      if (existingOperation) {
        if (existingOperation.name !== name) {
          throw new Error('Blank project retry must use the original project name')
        }
        return existingOperation.root
      }

      const root = createBlankProjectRoot({ documentsPath, name })
      blankProjectRootOperations.set(operationId, { name, root })
      void root.catch(() => {
        if (blankProjectRootOperations.get(operationId)?.root === root) {
          blankProjectRootOperations.delete(operationId)
        }
      })
      return root
    }
  })
  const workspaceRecovery = new WorkspaceRecoveryService({ store: projectStore })
  return { projectStore, projectService, projectApi, workspaceRecovery }
}

export async function createBlankProjectRoot({
  documentsPath,
  name
}: {
  documentsPath: string
  name: string
}): Promise<string> {
  for (let suffix = 1; ; suffix += 1) {
    const directoryName = suffix === 1 ? name : `${name} ${suffix}`
    const candidate = join(documentsPath, directoryName)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (isFileSystemError(error) && error.code === 'EEXIST') continue
      throw error
    }
  }
}

async function validateLocalRoot(path: string): Promise<{ realPath: string }> {
  const realPath = await realpath(path)
  const localStat = await stat(realPath)

  if (!localStat.isDirectory()) {
    throw new Error(`Local root is not a directory: ${path}`)
  }

  return { realPath }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function createProjectlessWorkspace({
  userDataPath,
  prompt
}: {
  userDataPath: string
  prompt: string
}): Promise<{ cwd: string; workspaceRoot: string; outputDirectory: string }> {
  const workspaceRoot = join(userDataPath, 'projectless', projectlessWorkspaceName(prompt))
  const outputDirectory = join(workspaceRoot, 'out')

  await mkdir(outputDirectory, { recursive: true })

  return {
    cwd: workspaceRoot,
    workspaceRoot,
    outputDirectory
  }
}

function projectlessWorkspaceName(prompt: string): string {
  const normalizedPrompt = prompt.trim() || 'untitled'
  const slug = normalizedPrompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  const hash = createHash('sha256').update(normalizedPrompt).digest('hex').slice(0, 12)

  return `${slug || 'untitled'}-${hash}`
}
