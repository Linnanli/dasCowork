import { z } from 'zod'

import { composerContextReferenceSchema } from './composerContext'
import { projectSelectionSchema } from './projects/projectSchemas'

export const COMPOSER_CONTEXT_SEARCH_VERSION = 1 as const

const excludedThreadIdsSchema = z
  .array(z.string().min(1))
  .max(100)
  .transform((ids) => [...new Set(ids)])

export const composerContextSearchStartRequestSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_SEARCH_VERSION),
  cwd: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  projectSelection: projectSelectionSchema.optional(),
  excludedThreadIds: excludedThreadIdsSchema.optional()
})

export type ComposerContextSearchStartRequest = z.infer<
  typeof composerContextSearchStartRequestSchema
>

export const composerContextSearchStartResultSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_SEARCH_VERSION),
  sessionId: z.string().min(1),
  hostId: z.string().min(1),
  filesAvailable: z.boolean(),
  tasksAvailable: z.boolean()
})

export type ComposerContextSearchStartResult = z.infer<
  typeof composerContextSearchStartResultSchema
>

export const composerContextSearchUpdateRequestSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_SEARCH_VERSION),
  sessionId: z.string().min(1),
  query: z.string().max(500),
  excludedThreadIds: excludedThreadIdsSchema.optional()
})

export type ComposerContextSearchUpdateRequest = z.infer<
  typeof composerContextSearchUpdateRequestSchema
>

export const composerContextSearchStopRequestSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_SEARCH_VERSION),
  sessionId: z.string().min(1)
})

export type ComposerContextSearchStopRequest = z.infer<
  typeof composerContextSearchStopRequestSchema
>

export const composerContextSearchSectionEventSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_SEARCH_VERSION),
  sessionId: z.string().min(1),
  query: z.string().max(500),
  sectionId: z.enum(['files', 'tasks']),
  status: z.enum(['loading', 'ready', 'error']),
  items: z.array(composerContextReferenceSchema),
  complete: z.boolean(),
  error: z.string().optional()
})

export type ComposerContextSearchSectionEvent = z.infer<
  typeof composerContextSearchSectionEventSchema
>
