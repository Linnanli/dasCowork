import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createBlankProjectRoot, createProjectRuntimeServices } from './projectRuntimeServices'

describe('createProjectRuntimeServices', () => {
  it('creates blank projects under Documents with deterministic conflict suffixes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const documentsPath = join(tempRoot, 'Documents')
      await mkdir(documentsPath)
      await mkdir(join(documentsPath, 'Demo'))
      await mkdir(join(documentsPath, 'Demo 2'))
      const services = createProjectRuntimeServices({
        userDataPath: tempRoot,
        documentsPath
      })

      const { option } = await services.projectApi.createBlankProject(
        'Demo',
        '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b'
      )

      expect(option.root).toBe(await realpath(join(documentsPath, 'Demo 3')))
      expect(option.label).toBe('Demo')
      expect((await stat(option.root)).isDirectory()).toBe(true)
      await expect(services.projectStore.getState()).resolves.toMatchObject({
        activeProjectSelection: { projectKind: 'path', path: option.root },
        activeWorkspaceRoots: [option.root]
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('suffixes both directory and display name for a deliberate duplicate project', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const documentsPath = join(tempRoot, 'Documents')
      await mkdir(documentsPath)
      const services = createProjectRuntimeServices({
        userDataPath: tempRoot,
        documentsPath
      })

      const first = await services.projectApi.createBlankProject(
        'Demo',
        '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b'
      )
      const second = await services.projectApi.createBlankProject(
        'Demo',
        '1745fbce-8097-4f9e-880e-7a15a2f02144'
      )

      expect(first.option).toMatchObject({
        root: await realpath(join(documentsPath, 'Demo')),
        label: 'Demo'
      })
      expect(second.option).toMatchObject({
        root: await realpath(join(documentsPath, 'Demo 2')),
        label: 'Demo 2'
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('propagates directory creation errors without registering project state', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const documentsPath = join(tempRoot, 'missing', 'Documents')
      const services = createProjectRuntimeServices({
        userDataPath: tempRoot,
        documentsPath
      })
      const initialState = await services.projectStore.getState()

      await expect(
        services.projectApi.createBlankProject('Demo', '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b')
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(services.projectStore.getState()).resolves.toEqual(initialState)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('retries registration with the same directory after creation already succeeded', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const documentsPath = join(tempRoot, 'Documents')
      await mkdir(documentsPath)
      const services = createProjectRuntimeServices({
        userDataPath: tempRoot,
        documentsPath
      })
      const setState = services.projectStore.setState.bind(services.projectStore)
      vi.spyOn(services.projectStore, 'setState')
        .mockRejectedValueOnce(new Error('write failed'))
        .mockImplementation(setState)
      const operationId = '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b'

      await expect(services.projectApi.createBlankProject('Demo', operationId)).rejects.toThrow(
        join(documentsPath, 'Demo')
      )
      const { option } = await services.projectApi.createBlankProject('Demo', operationId)

      expect(option.root).toBe(await realpath(join(documentsPath, 'Demo')))
      await expect(stat(join(documentsPath, 'Demo 2'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('creates a requested directory atomically when no conflict exists', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-project-runtime-'))

    try {
      const documentsPath = join(tempRoot, 'Documents')
      await mkdir(documentsPath)

      await expect(createBlankProjectRoot({ documentsPath, name: 'Fresh' })).resolves.toBe(
        join(documentsPath, 'Fresh')
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

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
