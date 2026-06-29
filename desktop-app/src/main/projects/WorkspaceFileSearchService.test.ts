import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ProjectService } from './ProjectService'
import { ProjectStore, createDefaultProjectState } from './ProjectStore'
import { WorkspaceFileSearchService } from './WorkspaceFileSearchService'

const now = '2026-06-29T00:00:00.000Z'

describe('WorkspaceFileSearchService', () => {
  it('searches files from the active resolved local project roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dascowork-file-search-'))

    try {
      await mkdir(join(tempRoot, 'src'), { recursive: true })
      await mkdir(join(tempRoot, 'node_modules', 'ignored'), { recursive: true })
      await writeFile(join(tempRoot, 'src', 'App.tsx'), 'export function App() {}', 'utf8')
      await writeFile(join(tempRoot, 'node_modules', 'ignored', 'App.tsx'), 'ignored', 'utf8')

      const store = ProjectStore.inMemory({
        ...createDefaultProjectState(),
        activeProjectSelection: { projectKind: 'path', path: tempRoot },
        workspaceRootOptions: [
          {
            root: tempRoot,
            hostId: 'local',
            addedAt: now,
            lastOpenedAt: now
          }
        ]
      })
      const projectService = new ProjectService({
        store,
        validateLocalRoot: async (path) => ({ realPath: path }),
        validateRemoteRoot: async () => undefined,
        createProjectlessWorkspace: async () => ({
          cwd: '/tmp/projectless',
          workspaceRoot: '/tmp/projectless',
          outputDirectory: '/tmp/projectless/out'
        })
      })
      const search = new WorkspaceFileSearchService({ projectStore: store, projectService })

      const response = await search.createFuzzyFileSearchSession({ query: 'app', limit: 10 })

      expect(response.results).toEqual([
        expect.objectContaining({
          path: join(tempRoot, 'src', 'App.tsx'),
          label: 'src/App.tsx',
          root: tempRoot
        })
      ])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not create or search a projectless workspace for composer mentions', async () => {
    const store = ProjectStore.inMemory({
      ...createDefaultProjectState(),
      activeProjectSelection: { projectKind: 'projectless' }
    })
    const projectService = new ProjectService({
      store,
      validateLocalRoot: async (path) => ({ realPath: path }),
      validateRemoteRoot: async () => undefined,
      createProjectlessWorkspace: async () => {
        throw new Error('should not create projectless workspace')
      }
    })
    const search = new WorkspaceFileSearchService({ projectStore: store, projectService })

    await expect(search.createFuzzyFileSearchSession({ query: 'app' })).resolves.toEqual({
      results: []
    })
  })
})
