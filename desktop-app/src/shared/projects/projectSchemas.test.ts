import { describe, expect, it } from 'vitest'

import { projectCreateBlankPayloadSchema, projectSelectionSchema } from './projectSchemas'

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

describe('blank project payload schema', () => {
  it('trims and accepts a safe directory name', () => {
    expect(
      projectCreateBlankPayloadSchema.parse({
        operationId: '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b',
        name: '  New App  '
      })
    ).toEqual({
      operationId: '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b',
      name: 'New App'
    })
  })

  it.each(['', '   ', '.', '..', 'nested/project', 'nested\\project', 'bad\0name'])(
    'rejects unsafe project name %j',
    (name) => {
      expect(
        projectCreateBlankPayloadSchema.safeParse({
          operationId: '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b',
          name
        }).success
      ).toBe(false)
    }
  )

  it('rejects names longer than 80 characters', () => {
    expect(
      projectCreateBlankPayloadSchema.safeParse({
        operationId: '4c1dbf20-e0b4-4e50-b70b-78090e19ef6b',
        name: 'a'.repeat(81)
      }).success
    ).toBe(false)
  })

  it('requires a valid idempotency operation id', () => {
    expect(
      projectCreateBlankPayloadSchema.safeParse({
        operationId: 'not-a-uuid',
        name: 'New App'
      }).success
    ).toBe(false)
  })
})
