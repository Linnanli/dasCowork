import { describe, expect, it } from 'vitest'

import {
  composerContextSearchSectionEventSchema,
  composerContextSearchStartRequestSchema,
  composerContextSearchUpdateRequestSchema
} from './composerContextSearch'

describe('composer context search schemas', () => {
  it('validates and deduplicates bounded thread exclusions', () => {
    expect(
      composerContextSearchStartRequestSchema.parse({
        version: 1,
        cwd: '/repo',
        excludedThreadIds: ['thread-1', 'thread-1', 'thread-2']
      }).excludedThreadIds
    ).toEqual(['thread-1', 'thread-2'])

    expect(
      composerContextSearchUpdateRequestSchema.safeParse({
        version: 1,
        sessionId: 'search-1',
        query: 'x'.repeat(501)
      }).success
    ).toBe(false)
  })

  it('rejects invalid dynamic section events', () => {
    const valid = {
      version: 1,
      sessionId: 'search-1',
      query: 'needle',
      sectionId: 'tasks',
      status: 'ready',
      items: [],
      complete: true
    }
    expect(composerContextSearchSectionEventSchema.safeParse(valid).success).toBe(true)
    expect(
      composerContextSearchSectionEventSchema.safeParse({ ...valid, sectionId: 'agents' }).success
    ).toBe(false)
  })
})
