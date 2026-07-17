import { describe, expect, it } from 'vitest'

import type { ProjectSelection, ProjectState } from '../../../shared/projects/projectTypes'
import {
  buildProjectPickerOptions,
  describeProjectSelection,
  filterProjectPickerOptions,
  projectSelectionKey
} from './projectPickerModel'

const state: ProjectState = {
  workspaceRootOptions: [
    {
      root: '/repo/pinned',
      hostId: 'local',
      addedAt: '2026-07-01T00:00:00.000Z',
      lastOpenedAt: '2026-07-05T00:00:00.000Z',
      missing: true
    },
    {
      root: '/repo/recent-path',
      label: 'Recent Folder',
      hostId: 'local',
      addedAt: '2026-07-02T00:00:00.000Z',
      lastOpenedAt: '2026-07-04T00:00:00.000Z'
    },
    {
      root: '/repo/missing-path',
      hostId: 'local',
      addedAt: '2026-07-03T00:00:00.000Z',
      lastOpenedAt: '2026-07-03T00:00:00.000Z',
      missing: true
    },
    {
      root: '/remote/not-selectable',
      hostId: 'ssh-other',
      addedAt: '2026-07-04T00:00:00.000Z',
      lastOpenedAt: '2026-07-04T00:00:00.000Z'
    }
  ],
  localProjects: {
    first: {
      id: 'first',
      kind: 'local',
      name: 'First Project',
      hostId: 'local',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      writableRoots: ['/repo/first', '/repo/first-docs'],
      defaultCwd: '/repo/first/apps/desktop'
    },
    pinned: {
      id: 'pinned',
      kind: 'local',
      name: 'Pinned Project',
      hostId: 'local',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      writableRoots: ['/repo/pinned']
    },
    orphan: {
      id: 'orphan',
      kind: 'local',
      name: 'Orphan Project',
      hostId: 'local',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      writableRoots: []
    }
  },
  remoteProjects: [
    {
      id: 'remote-first',
      kind: 'remote',
      hostId: 'ssh-dev',
      label: 'Remote API',
      remotePath: '/srv/api',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    },
    {
      id: 'remote-second',
      kind: 'remote',
      hostId: 'ssh-prod',
      label: 'Production Web',
      remotePath: '/srv/web',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
  ],
  projectOrder: ['first', 'pinned'],
  pinnedProjectIds: ['pinned', 'missing-project'],
  projectWritableRoots: {},
  threadProjectAssignments: {},
  threadWritableRoots: {},
  threadWorkspaceRootHints: {},
  threadProjectlessOutputDirectories: {},
  projectlessThreadIds: [],
  projectlessHints: {}
}

describe('buildProjectPickerOptions', () => {
  it('orders pinned, projectOrder, remaining local, path, and remote projects', () => {
    const options = buildProjectPickerOptions(state, undefined)

    expect(options.map((option) => option.id)).toEqual([
      'local:pinned',
      'local:first',
      'local:orphan',
      'path:/repo/recent-path',
      'path:/repo/missing-path',
      'remote:ssh-dev:remote-first',
      'remote:ssh-prod:remote-second'
    ])
  })

  it('deduplicates path options covered by local projects and skips non-local roots', () => {
    const options = buildProjectPickerOptions(state, undefined)

    expect(options.map((option) => option.id)).not.toContain('path:/repo/pinned')
    expect(options.map((option) => option.id)).not.toContain('path:/remote/not-selectable')
  })

  it('provides labels, details, searchable values, missing state, and exact selections', () => {
    const options = buildProjectPickerOptions(state, {
      projectKind: 'remote',
      projectId: 'remote-second',
      hostId: 'ssh-prod'
    })

    expect(options.find((option) => option.id === 'local:first')).toMatchObject({
      kind: 'local',
      label: 'First Project',
      detail: '2 roots',
      searchText: expect.stringContaining('/repo/first/apps/desktop'),
      selection: { projectKind: 'local', projectId: 'first' },
      selected: false,
      missing: false
    })
    expect(options.find((option) => option.id === 'local:pinned')).toMatchObject({
      detail: '/repo/pinned',
      missing: true
    })
    expect(options.find((option) => option.id === 'path:/repo/missing-path')).toMatchObject({
      label: 'missing-path',
      detail: '/repo/missing-path',
      missing: true
    })
    expect(options.find((option) => option.id === 'remote:ssh-prod:remote-second')).toMatchObject({
      detail: 'ssh-prod:/srv/web',
      selected: true,
      missing: false
    })
    expect(options.filter((option) => option.selected)).toHaveLength(1)
  })

  it('does not select a regular project for either Projectless representation', () => {
    expect(
      buildProjectPickerOptions(state, { projectKind: 'projectless' }).some(
        (option) => option.selected
      )
    ).toBe(false)
    expect(buildProjectPickerOptions(state, undefined).some((option) => option.selected)).toBe(
      false
    )
  })
})

describe('filterProjectPickerOptions', () => {
  const options = buildProjectPickerOptions(state, undefined)

  it.each([
    ['  FIRST PROJECT  ', ['local:first']],
    ['first/apps', ['local:first']],
    ['recent folder', ['path:/repo/recent-path']],
    ['SSH-PROD', ['remote:ssh-prod:remote-second']],
    ['/SRV/API', ['remote:ssh-dev:remote-first']]
  ])('searches case-insensitively across labels and project details: %s', (query, ids) => {
    expect(filterProjectPickerOptions(options, query).map((option) => option.id)).toEqual(ids)
  })

  it('returns the complete ordered list for an empty query', () => {
    expect(filterProjectPickerOptions(options, '   ')).toBe(options)
  })
})

describe('projectSelectionKey', () => {
  it.each<[ProjectSelection | null | undefined, string]>([
    [undefined, 'projectless'],
    [null, 'projectless'],
    [{ projectKind: 'projectless' }, 'projectless'],
    [{ projectKind: 'local', projectId: 'alpha' }, 'local:alpha'],
    [{ projectKind: 'path', path: '/repo/alpha' }, 'path:/repo/alpha'],
    [{ projectKind: 'remote', projectId: 'alpha', hostId: 'ssh-dev' }, 'remote:ssh-dev:alpha']
  ])('builds a stable key for %j', (selection, expected) => {
    expect(projectSelectionKey(selection)).toBe(expected)
  })
})

describe('describeProjectSelection', () => {
  it('uses one Projectless description for empty and explicit Projectless selections', () => {
    expect(describeProjectSelection(state, undefined)).toEqual({
      kind: 'projectless',
      label: '选择项目',
      detail: null,
      missing: false
    })
    expect(describeProjectSelection(state, { projectKind: 'projectless' })).toEqual(
      describeProjectSelection(state, undefined)
    )
  })

  it('describes known local, path, and exact remote selections', () => {
    expect(describeProjectSelection(state, { projectKind: 'local', projectId: 'pinned' })).toEqual({
      kind: 'local',
      label: 'Pinned Project',
      detail: '/repo/pinned',
      missing: true
    })
    expect(
      describeProjectSelection(state, {
        projectKind: 'path',
        path: '/repo/missing-path'
      })
    ).toEqual({
      kind: 'path',
      label: 'missing-path',
      detail: '/repo/missing-path',
      missing: true
    })
    expect(
      describeProjectSelection(state, {
        projectKind: 'remote',
        projectId: 'remote-first',
        hostId: 'ssh-dev'
      })
    ).toEqual({
      kind: 'remote',
      label: 'Remote API',
      detail: 'ssh-dev:/srv/api',
      missing: false
    })
  })

  it('keeps stale selections identifiable and marks missing records', () => {
    expect(
      describeProjectSelection(state, {
        projectKind: 'local',
        projectId: 'deleted-local'
      })
    ).toEqual({
      kind: 'local',
      label: 'deleted-local',
      detail: null,
      missing: true
    })
    expect(
      describeProjectSelection(state, {
        projectKind: 'remote',
        projectId: 'remote-first',
        hostId: 'wrong-host'
      })
    ).toEqual({
      kind: 'remote',
      label: 'remote-first',
      detail: 'wrong-host',
      missing: true
    })
  })
})
