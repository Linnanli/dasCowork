import type { Page } from '@playwright/test'

export type FollowUpQueueState = {
  conversationKey: string
  revision: number
  items: Array<{
    id: string
    status: string
    text: string
    lease: { operation: string; owner: string } | null
  }>
}

/**
 * The app-server thread id is the durable follow-up queue key once a turn has
 * started. Parse it from the real protocol trace so an empty queue can still
 * be inspected after its UI list has unmounted.
 */
export function conversationKeyForStartedTurn(
  logs: readonly string[],
  occurrence = 0
): string {
  const keys = [...logs.join('\n').matchAll(/"method":"turn\/started","params":\{"threadId":"([^"]+)"/gu)].map(
    (match) => match[1]
  )
  const conversationKey = keys[occurrence]
  if (!conversationKey) {
    throw new Error(`Expected a turn/started protocol event at index ${occurrence}.`)
  }
  return conversationKey
}

export async function readFollowUpQueueState(
  page: Page,
  conversationKey: string
): Promise<FollowUpQueueState> {
  return page.evaluate(async (key) => {
    const state = await window.desktopApp.followUps.getState(key)
    return {
      conversationKey: state.conversationKey,
      revision: state.revision,
      items: state.items.map((item) => ({
        id: item.id,
        status: item.status,
        text: item.message.text,
        lease: item.lease ? { operation: item.lease.operation, owner: item.lease.owner } : null
      }))
    }
  }, conversationKey)
}
