import { describe, expect, it } from 'vitest'

import type { ProjectState } from '../../shared/projects/projectTypes'
import {
  buildThreadProjectSections,
  getThreadProjectBadge
} from '../src/threads/threadProjectSections'

const baseState: ProjectState = {
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

describe('buildThreadProjectSections', () => {
  it('orders pinned, local, remote, and projectless groups with counts and missing-root warnings', () => {
    const sections = buildThreadProjectSections(
      {
        ...baseState,
        workspaceRootOptions: [
          {
            root: '/repo/missing',
            hostId: 'local',
            addedAt: '2026-06-29T00:00:00.000Z',
            lastOpenedAt: '2026-06-29T00:00:00.000Z',
            missing: true
          }
        ],
        localProjects: {
          pinned: {
            id: 'pinned',
            kind: 'local',
            name: 'Pinned App',
            hostId: 'local',
            createdAt: '2026-06-29T00:00:00.000Z',
            updatedAt: '2026-06-29T00:00:00.000Z',
            writableRoots: ['/repo/missing']
          },
          local: {
            id: 'local',
            kind: 'local',
            name: 'Local App',
            hostId: 'local',
            createdAt: '2026-06-29T00:00:00.000Z',
            updatedAt: '2026-06-29T00:00:00.000Z',
            writableRoots: ['/repo/local']
          }
        },
        remoteProjects: [
          {
            id: 'remote',
            kind: 'remote',
            hostId: 'ssh-dev',
            label: 'Remote App',
            remotePath: '/srv/app',
            createdAt: '2026-06-29T00:00:00.000Z',
            updatedAt: '2026-06-29T00:00:00.000Z'
          }
        ],
        projectOrder: ['pinned', 'local'],
        pinnedProjectIds: ['pinned'],
        threadProjectAssignments: {
          'thread-1': { projectKind: 'local', projectId: 'pinned', cwd: '/repo/missing' },
          'thread-2': { projectKind: 'local', projectId: 'local', cwd: '/repo/local' },
          'thread-3': {
            projectKind: 'remote',
            projectId: 'remote',
            hostId: 'ssh-dev',
            cwd: '/srv/app'
          }
        },
        projectlessThreadIds: ['thread-4'],
        projectlessHints: {
          'thread-4': { workspaceRoot: null, outputDirectory: '/tmp/codex/thread-4' }
        }
      },
      'Local App',
      '/repo/local'
    )

    expect(sections.map((section) => section.title)).toEqual([
      'Pinned',
      'Local projects',
      'Remote projects',
      'Projectless'
    ])
    expect(sections[0]?.groups[0]).toMatchObject({
      label: 'Pinned App',
      threadCount: 1,
      warning: 'Missing roots: /repo/missing'
    })
    expect(sections[1]?.groups[0]).toMatchObject({ label: 'Local App', threadCount: 1 })
    expect(sections[2]?.groups[0]).toMatchObject({
      label: 'Remote App',
      detail: 'ssh-dev:/srv/app',
      threadCount: 1
    })
    expect(sections[3]?.groups[0]).toMatchObject({
      label: 'Projectless',
      detail: '/tmp/codex/thread-4',
      threadCount: 1
    })
  })

  it('derives item badges from each thread assignment instead of the active project', () => {
    const state: ProjectState = {
      ...baseState,
      localProjects: {
        local: {
          id: 'local',
          kind: 'local',
          name: 'Local App',
          hostId: 'local',
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
          writableRoots: ['/repo/local']
        },
        other: {
          id: 'other',
          kind: 'local',
          name: 'Other App',
          hostId: 'local',
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
          writableRoots: ['/repo/other']
        }
      },
      activeProjectSelection: { projectKind: 'local', projectId: 'local' },
      threadProjectAssignments: {
        'thread-1': { projectKind: 'local', projectId: 'local', cwd: '/repo/local' },
        'thread-2': { projectKind: 'local', projectId: 'other', cwd: '/repo/other' }
      }
    }

    expect(getThreadProjectBadge(state, ['thread-1'], 'Active App')).toMatchObject({
      label: 'Local App'
    })
    expect(getThreadProjectBadge(state, ['thread-2'], 'Active App')).toMatchObject({
      label: 'Other App'
    })
  })
})
