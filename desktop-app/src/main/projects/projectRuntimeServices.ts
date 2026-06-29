import { createHash } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ProjectApiService } from './ProjectApiService'
import { ProjectService, type ThreadReader } from './ProjectService'
import { ProjectStore } from './ProjectStore'

export type ProjectRuntimeServices = {
  projectStore: ProjectStore
  projectService: ProjectService
  projectApi: ProjectApiService
}

export function createProjectRuntimeServices({
  userDataPath,
  readThread,
  pickWorkspaceRoot
}: {
  userDataPath: string
  readThread?: ThreadReader
  pickWorkspaceRoot?: () => Promise<string | null>
}): ProjectRuntimeServices {
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
    pickWorkspaceRoot: pickWorkspaceRoot ?? (async () => null)
  })

  return { projectStore, projectService, projectApi }
}

async function validateLocalRoot(path: string): Promise<{ realPath: string }> {
  const realPath = await realpath(path)
  const localStat = await stat(realPath)

  if (!localStat.isDirectory()) {
    throw new Error(`Local root is not a directory: ${path}`)
  }

  return { realPath }
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
