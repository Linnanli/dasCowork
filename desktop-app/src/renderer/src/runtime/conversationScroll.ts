import type { ConversationScrollSnapshot } from './ConversationChatRegistry'

export function captureConversationScroll(element: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): ConversationScrollSnapshot {
  return {
    scrollTop: element.scrollTop,
    followBottom: element.scrollHeight - element.scrollTop - element.clientHeight <= 32
  }
}

export function restoreConversationScroll(
  element: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    style?: { scrollBehavior: string }
  },
  snapshot: ConversationScrollSnapshot
): void {
  const previousScrollBehavior = element.style?.scrollBehavior
  if (element.style) element.style.scrollBehavior = 'auto'
  element.scrollTop = snapshot.followBottom
    ? Math.max(0, element.scrollHeight - element.clientHeight)
    : snapshot.scrollTop
  if (element.style && previousScrollBehavior !== undefined) {
    element.style.scrollBehavior = previousScrollBehavior
  }
}
