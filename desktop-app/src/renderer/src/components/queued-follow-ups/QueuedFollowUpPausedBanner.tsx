import { AlertTriangleIcon, PlayIcon } from 'lucide-react'

import type { QueuedFollowUpItem } from '../../../../shared/codexFollowUpApi'
import { Button } from '../ui/button'

export function QueuedFollowUpPausedBanner({
  item,
  busy = false,
  onResume,
  onActionError
}: {
  item?: QueuedFollowUpItem
  busy?: boolean
  onResume?: () => void | Promise<void>
  onActionError?: (error: unknown) => void
}): React.JSX.Element | null {
  if (!item || !item.status.startsWith('paused-')) return null

  const canResume = item.status === 'paused-interrupted' && onResume

  return (
    <div
      aria-live="polite"
      className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm"
      data-slot="queued-follow-up-paused-banner"
      role="status"
    >
      <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{pauseTitle(item)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.pause?.userMessage ?? pauseFallback(item)}
        </p>
      </div>
      {canResume ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          aria-label="Resume follow-up queue"
          disabled={busy}
          onClick={() => {
            void runAction(onResume, onActionError)
          }}
        >
          <PlayIcon aria-hidden />
          Resume
        </Button>
      ) : null}
    </div>
  )
}

function pauseTitle(item: QueuedFollowUpItem): string {
  switch (item.status) {
    case 'paused-interrupted':
      return 'Queue paused after interruption'
    case 'paused-failed':
      return 'Follow-up needs attention'
    case 'paused-recovery-uncertain':
      return 'Delivery status is uncertain'
    default:
      return 'Queue paused'
  }
}

function pauseFallback(item: QueuedFollowUpItem): string {
  if (item.status === 'paused-recovery-uncertain') {
    return 'Retry or delete the first follow-up before the queue can continue.'
  }
  if (item.status === 'paused-failed') {
    return 'Fix, retry, or delete the first follow-up before the queue can continue.'
  }
  return 'Resume when you are ready to continue with the queued follow-ups.'
}

async function runAction(
  action: () => void | Promise<void>,
  onActionError?: (error: unknown) => void
): Promise<void> {
  try {
    await action()
  } catch (error) {
    onActionError?.(error)
  }
}
