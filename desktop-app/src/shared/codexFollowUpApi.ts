import { z } from 'zod'

import {
  composerContextReferenceSchema,
  LOCAL_FILE_ATTACHMENT_MEDIA_TYPE,
  LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE
} from './composerContext'
import { projectSelectionSchema } from './projects/projectSchemas'

export const FOLLOW_UP_QUEUE_STATE_VERSION = 2 as const
export const FOLLOW_UP_QUEUE_MAX_ITEMS_PER_CONVERSATION = 20
export const FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM = 10 * 1024 * 1024
export const FOLLOW_UP_QUEUE_MAX_TOTAL_ASSET_BYTES = 50 * 1024 * 1024
export const FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS =
  Math.ceil(FOLLOW_UP_QUEUE_MAX_ASSET_BYTES_PER_ITEM / 3) * 4

const nonEmptyIdSchema = z.string().min(1).max(256)
const isoDateTimeSchema = z.string().datetime({ offset: true })
const mediaTypeSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u)

export const followUpModeSchema = z.enum(['queue', 'steer'])
export type FollowUpMode = z.infer<typeof followUpModeSchema>

export const followUpStatusSchema = z.enum([
  'queued',
  'editing',
  'steering',
  'sending',
  'accepted',
  'paused-interrupted',
  'paused-failed',
  'paused-recovery-uncertain'
])
export type FollowUpStatus = z.infer<typeof followUpStatusSchema>

export const followUpPauseKindSchema = z.enum([
  'interrupted',
  'send-failed',
  'steer-rejected',
  'turn-race',
  'attachment-unavailable',
  'recovery-uncertain'
])
export type FollowUpPauseKind = z.infer<typeof followUpPauseKindSchema>

export const followUpPauseSchema = z.object({
  kind: followUpPauseKindSchema,
  userMessage: z.string().min(1).max(2_000)
})
export type FollowUpPause = z.infer<typeof followUpPauseSchema>

export const followUpEditableStatusSchema = z.enum([
  'queued',
  'paused-interrupted',
  'paused-failed',
  'paused-recovery-uncertain'
])
export type FollowUpEditableStatus = z.infer<typeof followUpEditableStatusSchema>

export const followUpAssetInputSchema = z.object({
  id: nonEmptyIdSchema,
  displayName: z.string().min(1).max(512),
  mediaType: mediaTypeSchema,
  encoding: z.literal('base64'),
  data: z.string().min(1).max(FOLLOW_UP_QUEUE_MAX_BASE64_CHARACTERS)
})
export type FollowUpAssetInput = z.infer<typeof followUpAssetInputSchema>

export const followUpLocalImageInputSchema = z.object({
  kind: z.literal('local-image'),
  id: nonEmptyIdSchema,
  path: z.string().min(1).max(32_768),
  capabilityToken: nonEmptyIdSchema,
  previewUrl: z
    .string()
    .regex(/^app:\/\/fs\/@fs\//u, 'preview URL must use the local media protocol'),
  displayName: z.string().min(1).max(512),
  mediaType: mediaTypeSchema.refine((value) => value.startsWith('image/'), {
    message: 'local image media type must be an image'
  })
})
export type FollowUpLocalImageInput = z.infer<typeof followUpLocalImageInputSchema>

export const followUpPersistedAssetSchema = z.object({
  kind: z.literal('persisted-asset'),
  id: nonEmptyIdSchema,
  displayName: z.string().min(1).max(512),
  mediaType: mediaTypeSchema,
  relativePath: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
      message: 'asset path must be relative and may not traverse parent directories'
    }),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u)
})
export type FollowUpPersistedAsset = z.infer<typeof followUpPersistedAssetSchema>

export const followUpLocalAttachmentSchema = z.object({
  kind: z.enum(['file', 'folder']),
  path: z.string().min(1).max(32_768),
  label: z.string().min(1).max(512),
  fileUrl: z.string().regex(/^file:/u)
})
export type FollowUpLocalAttachment = z.infer<typeof followUpLocalAttachmentSchema>

export const followUpLocalAttachmentInputSchema = followUpLocalAttachmentSchema.extend({
  capabilityToken: nonEmptyIdSchema.optional()
})
export type FollowUpLocalAttachmentInput = z.infer<typeof followUpLocalAttachmentInputSchema>

export const queuedFollowUpAttachmentSchema = z.discriminatedUnion('kind', [
  followUpPersistedAssetSchema,
  followUpLocalAttachmentSchema
])
export type QueuedFollowUpAttachment = z.infer<typeof queuedFollowUpAttachmentSchema>

export const queuedFollowUpAttachmentInputSchema = z.discriminatedUnion('kind', [
  followUpPersistedAssetSchema,
  followUpLocalAttachmentInputSchema,
  followUpLocalImageInputSchema,
  followUpAssetInputSchema.extend({ kind: z.literal('inline-asset') })
])
export type QueuedFollowUpAttachmentInput = z.infer<typeof queuedFollowUpAttachmentInputSchema>

export const queuedFollowUpTrustedContextSchema = z.object({
  conversationId: nonEmptyIdSchema,
  threadId: nonEmptyIdSchema.optional(),
  projectSelection: projectSelectionSchema.optional(),
  hostId: nonEmptyIdSchema,
  cwd: z.string().min(1).nullable(),
  workspaceRoots: z.array(z.string().min(1)).max(100)
})
export type QueuedFollowUpTrustedContext = z.infer<typeof queuedFollowUpTrustedContextSchema>

const queuedUserMessageBaseSchema = z.object({
  id: nonEmptyIdSchema,
  text: z.string().max(1_000_000),
  contextReferences: z.array(composerContextReferenceSchema).max(100).default([]),
  trustedContext: queuedFollowUpTrustedContextSchema
})

export const queuedUserMessageSnapshotSchema = queuedUserMessageBaseSchema.extend({
  attachments: z.array(queuedFollowUpAttachmentSchema).max(100).default([])
})
export type QueuedUserMessageSnapshot = z.infer<typeof queuedUserMessageSnapshotSchema>

export const queuedUserMessageSnapshotInputSchema = queuedUserMessageBaseSchema.extend({
  attachments: z.array(queuedFollowUpAttachmentInputSchema).max(100).default([])
})
export type QueuedUserMessageSnapshotInput = z.infer<typeof queuedUserMessageSnapshotInputSchema>

export const materializedQueuedUserMessagePartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string()
  }),
  z.object({
    type: z.literal('file'),
    filename: z.string().min(1).max(512),
    mediaType: mediaTypeSchema,
    url: z
      .string()
      .refine(
        (value) => value.startsWith('data:') || value.startsWith('file:'),
        'materialized file URL must use data: or file:'
      )
  })
])
export type MaterializedQueuedUserMessagePart = z.infer<
  typeof materializedQueuedUserMessagePartSchema
>

export const materializedQueuedUserMessageSchema = z.object({
  id: nonEmptyIdSchema,
  parts: z.array(materializedQueuedUserMessagePartSchema).min(1),
  contextReferences: z.array(composerContextReferenceSchema).max(100),
  trustedContext: queuedFollowUpTrustedContextSchema
})
export type MaterializedQueuedUserMessage = z.infer<typeof materializedQueuedUserMessageSchema>

export function materializedMediaTypeForLocalAttachment(kind: 'file' | 'folder'): string {
  return kind === 'folder' ? LOCAL_FOLDER_ATTACHMENT_MEDIA_TYPE : LOCAL_FILE_ATTACHMENT_MEDIA_TYPE
}

export const queuedFollowUpItemSchema = z
  .object({
    id: nonEmptyIdSchema,
    conversationKey: nonEmptyIdSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    preferredMode: followUpModeSchema,
    message: queuedUserMessageSnapshotSchema,
    status: followUpStatusSchema,
    pause: followUpPauseSchema.optional(),
    edit: z
      .object({
        previousStatus: followUpEditableStatusSchema,
        previousPause: followUpPauseSchema.optional(),
        begunAt: isoDateTimeSchema
      })
      .optional(),
    lease: z
      .object({
        token: nonEmptyIdSchema,
        operation: z.enum(['turn-start', 'turn-steer']),
        claimedAt: isoDateTimeSchema,
        owner: nonEmptyIdSchema.default('legacy')
      })
      .optional()
  })
  .superRefine((value, context) => {
    if (value.status === 'editing' && !value.edit) {
      context.addIssue({
        code: 'custom',
        path: ['edit'],
        message: 'editing follow-ups must retain their previous status'
      })
    }
    if (value.status !== 'editing' && value.edit) {
      context.addIssue({
        code: 'custom',
        path: ['edit'],
        message: 'only editing follow-ups may retain an edit reservation'
      })
    }
  })
export type QueuedFollowUpItem = z.infer<typeof queuedFollowUpItemSchema>

export const conversationFollowUpStateSchema = z.object({
  version: z.literal(FOLLOW_UP_QUEUE_STATE_VERSION),
  revision: z.number().int().nonnegative(),
  conversationKey: nonEmptyIdSchema,
  defaultMode: followUpModeSchema,
  archived: z.boolean(),
  items: z.array(queuedFollowUpItemSchema)
})
export type ConversationFollowUpState = z.infer<typeof conversationFollowUpStateSchema>

export const followUpGetStatePayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema
})
export type FollowUpGetStatePayload = z.infer<typeof followUpGetStatePayloadSchema>

export const followUpEnqueuePayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema,
  snapshot: queuedUserMessageSnapshotInputSchema,
  preferredMode: followUpModeSchema
})
export type FollowUpEnqueuePayload = z.infer<typeof followUpEnqueuePayloadSchema>

export const followUpEditPayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema,
  replacementSnapshot: queuedUserMessageSnapshotInputSchema
})
export type FollowUpEditPayload = z.infer<typeof followUpEditPayloadSchema>

export const followUpCommitEditPayloadSchema = followUpEditPayloadSchema.superRefine(
  (value, context) => {
    if (value.replacementSnapshot.id !== value.itemId) {
      context.addIssue({
        code: 'custom',
        path: ['replacementSnapshot', 'id'],
        message: 'commit-edit must preserve the stable item id'
      })
    }
  }
)
export type FollowUpCommitEditPayload = z.infer<typeof followUpCommitEditPayloadSchema>

export const followUpItemActionPayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema
})
export type FollowUpItemActionPayload = z.infer<typeof followUpItemActionPayloadSchema>

export const followUpSteerItemPayloadSchema = followUpItemActionPayloadSchema
export type FollowUpSteerItemPayload = z.infer<typeof followUpSteerItemPayloadSchema>

export const followUpReorderPayloadSchema = followUpItemActionPayloadSchema
  .extend({
    beforeId: nonEmptyIdSchema.optional(),
    afterId: nonEmptyIdSchema.optional()
  })
  .superRefine((value, context) => {
    if (Boolean(value.beforeId) === Boolean(value.afterId)) {
      context.addIssue({
        code: 'custom',
        message: 'provide exactly one of beforeId or afterId'
      })
    }
  })
export type FollowUpReorderPayload = z.infer<typeof followUpReorderPayloadSchema>

export const followUpConversationActionPayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema
})
export type FollowUpConversationActionPayload = z.infer<
  typeof followUpConversationActionPayloadSchema
>

export const followUpSetDefaultModePayloadSchema = z.object({
  mode: followUpModeSchema
})
export type FollowUpSetDefaultModePayload = z.infer<typeof followUpSetDefaultModePayloadSchema>

export const followUpClaimNextPayloadSchema = z.object({
  conversationKey: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema.optional()
})
export type FollowUpClaimNextPayload = z.infer<typeof followUpClaimNextPayloadSchema>

export const followUpTurnStartRequestSchema = z.object({
  conversationKey: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema
})
export type FollowUpTurnStartRequest = z.infer<typeof followUpTurnStartRequestSchema>

export type PreparedFollowUpTurnStart = {
  request: FollowUpTurnStartRequest
  message: MaterializedQueuedUserMessage
}

export type FollowUpSteerPendingAck = {
  delivery: 'pending-ack'
  clientUserMessageId: string
  targetTurnId: string
  state?: ConversationFollowUpState
}

export const followUpBeginEditResultSchema = z.object({
  state: conversationFollowUpStateSchema,
  message: materializedQueuedUserMessageSchema
})
export type PreparedFollowUpEdit = z.infer<typeof followUpBeginEditResultSchema>

export const followUpQueueChangeEventSchema = z.object({
  revision: z.number().int().nonnegative(),
  state: conversationFollowUpStateSchema
})
export type FollowUpQueueChangeEvent = z.infer<typeof followUpQueueChangeEventSchema>

export type DesktopCodexFollowUpApi = {
  getState(conversationKey: string): Promise<ConversationFollowUpState>
  enqueue(
    conversationKey: string,
    snapshot: QueuedUserMessageSnapshotInput,
    preferredMode: FollowUpMode
  ): Promise<ConversationFollowUpState>
  edit(
    conversationKey: string,
    itemId: string,
    replacementSnapshot: QueuedUserMessageSnapshotInput
  ): Promise<ConversationFollowUpState>
  beginEdit(conversationKey: string, itemId: string): Promise<PreparedFollowUpEdit>
  commitEdit(
    conversationKey: string,
    itemId: string,
    replacementSnapshot: QueuedUserMessageSnapshotInput
  ): Promise<ConversationFollowUpState>
  cancelEdit(conversationKey: string, itemId: string): Promise<ConversationFollowUpState>
  delete(conversationKey: string, itemId: string): Promise<ConversationFollowUpState>
  reorder(
    conversationKey: string,
    itemId: string,
    position: { beforeId: string } | { afterId: string }
  ): Promise<ConversationFollowUpState>
  requestSendNow(conversationKey: string, itemId: string): Promise<ConversationFollowUpState>
  retry(conversationKey: string, itemId: string): Promise<ConversationFollowUpState>
  resume(conversationKey: string): Promise<ConversationFollowUpState>
  clear(conversationKey: string): Promise<ConversationFollowUpState>
  setDefaultMode(mode: FollowUpMode): Promise<void>
  prepareNextTurn(conversationKey: string, itemId?: string): Promise<PreparedFollowUpTurnStart>
  materializeItem(conversationKey: string, itemId: string): Promise<MaterializedQueuedUserMessage>
  steerItem(conversationKey: string, itemId: string): Promise<FollowUpSteerPendingAck>
  steerNext(conversationKey: string, itemId?: string): Promise<FollowUpSteerPendingAck>
  subscribe(listener: (event: FollowUpQueueChangeEvent) => void): () => void
}
