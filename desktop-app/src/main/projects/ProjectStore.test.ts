import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { ProjectStore, type ProjectState } from './ProjectStore'

const storedState: ProjectState = {
  workspaceRootOptions: [],
  localProjects: {
    abc: {
      id: 'abc',
      kind: 'local',
      name: 'desktop-app',
      hostId: 'local',
      createdAt: '2026-06-29T00:00:00.000Z',
      updatedAt: '2026-06-29T00:00:00.000Z',
      writableRoots: ['/repo']
    }
  },
  remoteProjects: [],
  projectOrder: ['abc'],
  pinnedProjectIds: [],
  projectWritableRoots: {},
  threadProjectAssignments: {},
  threadWritableRoots: {},
  threadWorkspaceRootHints: {},
  threadProjectlessOutputDirectories: {},
  projectlessThreadIds: [],
  projectlessHints: {},
  activeLocalProjectId: 'abc',
  activeWorkspaceRoots: ['/repo']
}

describe('ProjectStore', () => {
  it('stores active roots and local projects', async () => {
    const store = ProjectStore.inMemory()

    await store.setState(storedState)

    expect((await store.getState()).activeLocalProjectId).toBe('abc')
    expect((await store.getState()).activeWorkspaceRoots).toEqual(['/repo'])
  })

  it('loads persisted state from disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-store-'))
    const filePath = join(directory, 'projects.json')

    try {
      const store = ProjectStore.onDisk(filePath)
      await store.setState(storedState)

      const reloadedStore = ProjectStore.onDisk(filePath)

      expect(await reloadedStore.getState()).toEqual(storedState)
      await expect(readFile(filePath, 'utf8')).resolves.toContain('"activeLocalProjectId": "abc"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('returns cloned state snapshots', async () => {
    const store = ProjectStore.inMemory(storedState)

    const state = await store.getState()
    state.activeWorkspaceRoots?.push('/mutated')
    state.localProjects.abc.writableRoots.push('/mutated')

    expect((await store.getState()).activeWorkspaceRoots).toEqual(['/repo'])
    expect((await store.getState()).localProjects.abc.writableRoots).toEqual(['/repo'])
  })
})
