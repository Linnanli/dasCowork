import { CodexSteerError } from '@janole/ai-sdk-provider-codex-asp'

import type {
  ConversationFollowUpState,
  FollowUpClaimNextPayload
} from '../../shared/codexFollowUpApi'
import type { CodexChatRuntimeService } from '../codexChatRuntimeService'
import type { ConversationFollowUpQueueService } from './ConversationFollowUpQueueService'

type SteerRuntime = Pick<CodexChatRuntimeService, 'steerConversation'>
type SteerFailureDisposition = {
  status: 'queued' | 'paused-failed' | 'paused-recovery-uncertain'
  kind: 'steer-rejected' | 'turn-race' | 'attachment-unavailable' | 'recovery-uncertain'
  resultUnknown: boolean
}

export async function steerQueuedFollowUp(
  queue: ConversationFollowUpQueueService,
  runtime: SteerRuntime,
  request: FollowUpClaimNextPayload
): Promise<ConversationFollowUpState> {
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

  try {
    await runtime.steerConversation(
      request.conversationKey,
      { id: message.id, role: 'user', parts: message.parts },
      message.id
    )
  } catch (error) {
    const code = error instanceof CodexSteerError ? error.code : undefined
    const disposition = steerFailureDisposition(code)
    const failedState = await queue.failClaim(
      claim.conversationKey,
      claim.item.id,
      claim.leaseToken,
      {
        status: disposition.status,
        kind: disposition.kind,
        userMessage: errorMessage(error)
      }
    )
    if (disposition.resultUnknown) return failedState
    throw error
  }

  try {
    return await queue.commitClaim(claim.conversationKey, claim.item.id, claim.leaseToken)
  } catch {
    return await queue.failClaim(claim.conversationKey, claim.item.id, claim.leaseToken, {
      status: 'paused-recovery-uncertain',
      kind: 'recovery-uncertain',
      userMessage: 'The steer was accepted, but its local queue record could not be finalized.'
    })
  }
}

function steerFailureDisposition(
  code: CodexSteerError['code'] | undefined
): SteerFailureDisposition {
  switch (code) {
    case 'steer_result_unknown':
      return {
        status: 'paused-recovery-uncertain',
        kind: 'recovery-uncertain',
        resultUnknown: true
      }
    case 'expected_turn_mismatch':
    case 'session_inactive':
    case 'unsupported_active_turn_kind':
      return {
        status: 'queued',
        kind: 'turn-race',
        resultUnknown: false
      }
    case 'attachment_resolution_failed':
      return {
        status: 'paused-failed',
        kind: 'attachment-unavailable',
        resultUnknown: false
      }
    default:
      return {
        status: 'paused-failed',
        kind: 'steer-rejected',
        resultUnknown: false
      }
  }
}

function errorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim()
  if (!message) return 'The steer operation failed.'
  if (message.length <= 2_000) return message
  return `${message.slice(0, 1_999)}…`
}
