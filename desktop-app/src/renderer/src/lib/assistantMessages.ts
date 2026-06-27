export const pendingAssistantMessageText = '正在思考'

type PendingMessageContentPart = {
  readonly type: string
  readonly text?: string
}

export function isPendingAssistantMessageContent(
  content: readonly PendingMessageContentPart[]
): boolean {
  return (
    content.length === 1 &&
    content[0]?.type === 'text' &&
    content[0].text === pendingAssistantMessageText
  )
}
