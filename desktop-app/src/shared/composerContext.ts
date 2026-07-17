import { z } from 'zod'

import { projectSelectionSchema } from './projects/projectSchemas'

export const COMPOSER_CONTEXT_CATALOG_VERSION = 1 as const
export const LOCAL_FILE_ATTACHMENT_MEDIA_TYPE = 'application/vnd.dascowork.local-file'
export const LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE = 'application/vnd.dascowork.local-folder'

export const composerContextSectionIdSchema = z.enum([
  'files',
  'chats',
  'agents',
  'skills',
  'plugins',
  'apps'
])

export type ComposerContextSectionId = z.infer<typeof composerContextSectionIdSchema>

const composerContextReferenceBaseSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  canonicalId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  presentation: z.enum(['attachment', 'mention'])
})

export const composerContextReferenceSchema = z.discriminatedUnion('kind', [
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('file'),
    presentation: z.literal('mention'),
    path: z.string().min(1),
    root: z.string().min(1).optional(),
    score: z.number().finite().optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('folder'),
    presentation: z.literal('mention'),
    path: z.string().min(1),
    root: z.string().min(1).optional(),
    score: z.number().finite().optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('chat'),
    presentation: z.literal('mention'),
    threadId: z.string().min(1),
    uri: z.string().regex(/^thread:\/\//u),
    updatedAt: z.string().optional(),
    cwd: z.string().nullable().optional(),
    searchTitle: z.string().optional(),
    snippet: z.string().optional(),
    gitBranch: z.string().optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('liveAgent'),
    presentation: z.literal('mention'),
    threadId: z.string().min(1),
    parentThreadId: z.string().min(1),
    uri: z.string().regex(/^agent:\/\//u),
    agentPath: z.string().optional(),
    status: z.enum(['running', 'completed', 'failed', 'interrupted'])
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('configuredAgent'),
    presentation: z.literal('mention'),
    roleName: z.string().min(1),
    uri: z.string().regex(/^subagent:\/\//u),
    nicknameCandidates: z.array(z.string()).optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('skill'),
    presentation: z.literal('mention'),
    name: z.string().min(1),
    path: z.string().min(1),
    scope: z.string().optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('plugin'),
    presentation: z.literal('mention'),
    pluginId: z.string().min(1),
    uri: z.string().regex(/^plugin:\/\//u),
    mentionName: z.string().min(1).optional()
  }),
  composerContextReferenceBaseSchema.extend({
    kind: z.literal('app'),
    presentation: z.literal('mention'),
    appId: z.string().min(1),
    uri: z.string().regex(/^app:\/\//u),
    mentionName: z.string().min(1).optional(),
    pluginDisplayNames: z.array(z.string()).optional()
  })
])

export type ComposerContextReference = z.infer<typeof composerContextReferenceSchema>

export const composerContextSectionSchema = z.object({
  id: composerContextSectionIdSchema,
  status: z.enum(['ready', 'error']),
  items: z.array(composerContextReferenceSchema),
  error: z.string().optional()
})

export type ComposerContextSection = z.infer<typeof composerContextSectionSchema>

export const composerContextCatalogRequestSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  cwd: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  projectSelection: projectSelectionSchema.optional(),
  sectionIds: z
    .array(z.enum(['agents', 'skills', 'plugins', 'apps']))
    .min(1)
    .optional()
})

export type ComposerContextCatalogRequest = z.infer<typeof composerContextCatalogRequestSchema>

export const composerContextCatalogResultSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  generatedAt: z.string(),
  sections: z.array(composerContextSectionSchema)
})

export type ComposerContextCatalogResult = z.infer<typeof composerContextCatalogResultSchema>

export const composerContextCatalogRefreshOptionsSchema = z.object({
  sectionIds: z.array(composerContextSectionIdSchema).min(1).optional()
})

export type ComposerContextCatalogRefreshOptions = z.infer<
  typeof composerContextCatalogRefreshOptionsSchema
>

export const composerContextCatalogRefreshPayloadSchema = z.object({
  input: composerContextCatalogRequestSchema,
  options: composerContextCatalogRefreshOptionsSchema.optional()
})

export type ComposerContextCatalogRefreshPayload = z.infer<
  typeof composerContextCatalogRefreshPayloadSchema
>

export const composerContextCatalogChangeEventSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  sectionIds: z.array(composerContextSectionIdSchema).min(1),
  scope: z
    .object({
      hostId: z.string().min(1).optional(),
      cwd: z.string().min(1).optional(),
      threadId: z.string().min(1).optional()
    })
    .optional()
})

export type ComposerContextCatalogChangeEvent = z.infer<
  typeof composerContextCatalogChangeEventSchema
>

export const localAttachmentReferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['file', 'folder']),
    path: z.string().min(1),
    fileUrl: z.string().regex(/^file:/u),
    label: z.string().min(1)
  }),
  z.object({
    kind: z.literal('image'),
    path: z.string().min(1),
    label: z.string().min(1)
  })
])

export type LocalAttachmentReference = z.infer<typeof localAttachmentReferenceSchema>

export const localAttachmentValidationRequestSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  references: z.array(localAttachmentReferenceSchema).max(100)
})

export type LocalAttachmentValidationRequest = z.infer<
  typeof localAttachmentValidationRequestSchema
>

export const localAttachmentValidationEntrySchema = z.object({
  reference: localAttachmentReferenceSchema,
  valid: z.boolean(),
  error: z.string().optional()
})

export const localAttachmentValidationResultSchema = z.object({
  version: z.literal(COMPOSER_CONTEXT_CATALOG_VERSION),
  valid: z.boolean(),
  entries: z.array(localAttachmentValidationEntrySchema)
})

export type LocalAttachmentValidationResult = z.infer<typeof localAttachmentValidationResultSchema>

export type DesktopComposerContextApi = {
  list(input: ComposerContextCatalogRequest): Promise<ComposerContextCatalogResult>
  refresh(
    input: ComposerContextCatalogRequest,
    options?: ComposerContextCatalogRefreshOptions
  ): Promise<ComposerContextCatalogResult>
  onDidChange(callback: (event: ComposerContextCatalogChangeEvent) => void): () => void
  validateLocalAttachments(
    input: LocalAttachmentValidationRequest
  ): Promise<LocalAttachmentValidationResult>
  startSearch(
    input: import('./composerContextSearch').ComposerContextSearchStartRequest
  ): Promise<import('./composerContextSearch').ComposerContextSearchStartResult>
  updateSearch(
    input: import('./composerContextSearch').ComposerContextSearchUpdateRequest
  ): Promise<void>
  stopSearch(
    input: import('./composerContextSearch').ComposerContextSearchStopRequest
  ): Promise<void>
  onSearchUpdate(
    callback: (event: import('./composerContextSearch').ComposerContextSearchSectionEvent) => void
  ): () => void
}
