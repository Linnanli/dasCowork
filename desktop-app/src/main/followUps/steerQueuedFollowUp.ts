import type {
  FollowUpClaimNextPayload,
  FollowUpSteerPendingAck
} from '../../shared/codexFollowUpApi'
import type { CodexChatRuntimeService } from '../codexChatRuntimeService'
import type { ConversationFollowUpQueueService } from './ConversationFollowUpQueueService'

type SteerRuntime = Pick<CodexChatRuntimeService, 'steerClaimedFollowUp'>

export async function steerQueuedFollowUp(
  queue: ConversationFollowUpQueueService,
  runtime: SteerRuntime,
  request: FollowUpClaimNextPayload
): Promise<FollowUpSteerPendingAck> {
  const claim = request.itemId
    ? await queue.claimItemForSteer(request.conversationKey, request.itemId)
    : await queue.claimHead(request.conversationKey, 'turn-steer')
  let message: Awaited<ReturnType<typeof queue.materializeClaimMessage>>
  try {
    message = await queue.materializeClaimMessage(claim)
  } catch (error) {
    await queue.failClaim(claim.conversationKey, claim.item.id, claim.leaseToken, {
      kind: 'attachment-unavailable',
      userMessage: errorMessage(error)
    })
    throw error
  }

  const result = await runtime.steerClaimedFollowUp(claim, {
    id: message.id,
    role: 'user',
    parts: message.parts
  })

  return {
    delivery: 'pending-ack',
    clientUserMessageId: message.id,
    targetTurnId: result.turnId
  }
}

function errorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim()
  if (!message) return 'The steer operation failed.'
  if (message.length <= 2_000) return message
  return `${message.slice(0, 1_999)}…`
}
