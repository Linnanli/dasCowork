import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createProjectRuntimeServices } from './projectRuntimeServices'

describe('createProjectRuntimeServices', () => {
  it('creates production project services backed by app-owned storage', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const repo = join(tempRoot, 'repo')
      await mkdir(repo)
      const realRepo = await realpath(repo)
      const services = createProjectRuntimeServices({
        userDataPath: tempRoot,
        pickWorkspaceRoot: async () => repo
      })
      await services.projectApi.pickWorkspaceRoot()

      const target = await services.projectService.resolveNewThreadTarget({
        selection: { projectKind: 'path', path: repo },
        prompt: 'fix bug'
      })

      expect(target).toMatchObject({
        hostId: 'local',
        cwd: realRepo,
        workspaceRoots: [realRepo],
        workspaceKind: 'project'
      })

      const projectless = await services.projectService.resolveNewThreadTarget({
        prompt: 'scratch work'
      })
      expect(projectless.cwd).toContain(join(tempRoot, 'projectless'))
      expect(projectless.workspaceRoots).toEqual([projectless.cwd])
      const projectlessStat = await stat(projectless.cwd ?? '')
      expect(projectlessStat.isDirectory()).toBe(true)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects local roots that are not directories', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const filePath = join(tempRoot, 'not-a-directory')
      await writeFile(filePath, 'not a directory', 'utf8')
      const services = createProjectRuntimeServices({ userDataPath: tempRoot })

      await expect(
        services.projectService.resolveNewThreadTarget({
          selection: { projectKind: 'path', path: filePath },
          prompt: 'fix bug'
        })
      ).rejects.toThrow('Local root is not a directory')
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
