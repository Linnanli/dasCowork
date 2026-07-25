import type { ConversationRecoveryPhase } from '../../runtime/ConversationChatRegistry'
import { classifyConversationRecoveryError } from '../../runtime/classifyConversationRecoveryError'

export function ConversationRecoveryStatus({
  phase,
  error
}: {
  phase: ConversationRecoveryPhase
  error?: Error
}): React.JSX.Element | null {
  if (phase === 'attached' || phase === 'resumed') return null
  const diagnostic = classifyConversationRecoveryError(error)
  let message = '任务正在等待重新连接。'
  if (phase === 'resuming') message = '正在重新连接任务…'
  if (phase === 'needs_resume' && diagnostic) {
    message = `${diagnostic.title}。${diagnostic.action}`
  }
  return (
    <p
      data-slot="conversation-recovery-status"
      data-recovery-kind={diagnostic?.kind}
      role="status"
      aria-live="polite"
      className="px-2 py-1 text-xs text-muted-foreground"
    >
      {message}
    </p>
  )
}
