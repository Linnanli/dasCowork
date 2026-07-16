import { describe, expect, it } from 'vitest'

import {
  composerContextCatalogChangeEventSchema,
  composerContextCatalogRefreshPayloadSchema,
  composerContextCatalogRequestSchema,
  composerContextCatalogResultSchema,
  composerContextReferenceSchema,
  localAttachmentValidationRequestSchema
} from './composerContext'

describe('composer context schemas', () => {
  it('requires the versioned catalog contract and canonical reference identity', () => {
    expect(
      composerContextReferenceSchema.safeParse({
        version: 1,
        kind: 'chat',
        canonicalId: 'chat:thread-1',
        label: 'Chat',
        presentation: 'mention',
        threadId: 'thread-1',
        uri: 'thread://thread-1'
      }).success
    ).toBe(true)
    expect(
      composerContextReferenceSchema.safeParse({
        version: 1,
        kind: 'chat',
        label: 'Chat',
        presentation: 'mention',
        threadId: 'thread-1',
        uri: 'https://example.com'
      }).success
    ).toBe(false)
    expect(composerContextCatalogRequestSchema.safeParse({ version: 2 }).success).toBe(false)
  })

  it('accepts canonical mention names while keeping older v1 app/plugin references readable', () => {
    const app = {
      version: 1,
      kind: 'app',
      canonicalId: 'app:slack',
      label: 'Slack',
      presentation: 'mention',
      appId: 'slack',
      uri: 'app://slack'
    }

    expect(composerContextReferenceSchema.safeParse(app).success).toBe(true)
    expect(composerContextReferenceSchema.safeParse({ ...app, mentionName: 'slack' }).success).toBe(
      true
    )
    expect(composerContextReferenceSchema.safeParse({ ...app, mentionName: '' }).success).toBe(
      false
    )
  })

  it('accepts fail-soft sections with items and a scoped error', () => {
    expect(
      composerContextCatalogResultSchema.safeParse({
        version: 1,
        generatedAt: '2026-07-14T00:00:00.000Z',
        sections: [
          {
            id: 'plugins',
            status: 'error',
            error: 'unavailable',
            items: []
          }
        ]
      }).success
    ).toBe(true)
  })

  it('validates scoped changes and targeted refresh payloads', () => {
    expect(
      composerContextCatalogChangeEventSchema.safeParse({
        version: 1,
        sectionIds: ['agents'],
        scope: { threadId: 'thread-1' }
      }).success
    ).toBe(true)
    expect(
      composerContextCatalogChangeEventSchema.safeParse({ version: 1, sectionIds: [] }).success
    ).toBe(false)
    expect(
      composerContextCatalogRefreshPayloadSchema.safeParse({
        input: { version: 1, cwd: '/repo' },
        options: { sectionIds: ['skills'] }
      }).success
    ).toBe(true)
  })

  it('limits validation to local path-backed attachment references', () => {
    expect(
      localAttachmentValidationRequestSchema.safeParse({
        version: 1,
        references: [{ kind: 'folder', path: '/repo', fileUrl: 'file:///repo', label: 'repo' }]
      }).success
    ).toBe(true)
    expect(
      localAttachmentValidationRequestSchema.safeParse({
        version: 1,
        references: [{ kind: 'remote', path: '/repo', label: 'repo' }]
      }).success
    ).toBe(false)
  })
})
