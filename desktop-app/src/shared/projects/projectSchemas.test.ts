import { describe, expect, it } from 'vitest'

import { projectSelectionSchema } from './projectSchemas'

describe('project selection schema', () => {
  it('accepts local, remote, path, and projectless selections', () => {
    expect(
      projectSelectionSchema.safeParse({ projectKind: 'local', projectId: 'project-1' }).success
    ).toBe(true)
    expect(
      projectSelectionSchema.safeParse({
        projectKind: 'remote',
        projectId: 'project-1',
        hostId: 'host-1'
      }).success
    ).toBe(true)
    expect(
      projectSelectionSchema.safeParse({ projectKind: 'path', path: '/Users/test/project' }).success
    ).toBe(true)
    expect(
      projectSelectionSchema.safeParse({
        projectKind: 'path',
        path: '/Users/test/project',
        hostId: 'local'
      }).success
    ).toBe(true)
    expect(projectSelectionSchema.safeParse({ projectKind: 'projectless' }).success).toBe(true)
  })

  it('rejects invalid selections', () => {
    expect(projectSelectionSchema.safeParse({ projectKind: 'local', projectId: '' }).success).toBe(
      false
    )
    expect(
      projectSelectionSchema.safeParse({
        projectKind: 'remote',
        projectId: 'project-1',
        hostId: ''
      }).success
    ).toBe(false)
    expect(projectSelectionSchema.safeParse({ projectKind: 'path', path: '' }).success).toBe(false)
    expect(
      projectSelectionSchema.safeParse({
        projectKind: 'path',
        path: '/Users/test/project',
        hostId: 'remote-host'
      }).success
    ).toBe(false)
    expect(projectSelectionSchema.safeParse({ projectKind: 'unknown' }).success).toBe(false)
  })
})
