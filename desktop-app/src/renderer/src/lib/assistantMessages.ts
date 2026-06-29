export const pendingAssistantMessageText = '正在思考'

type AssistantMessageContentPart = {
  readonly type: string
  readonly text?: string
}

export function hasVisibleAssistantTextContent(
  content: readonly AssistantMessageContentPart[]
): boolean {
  return content.some(
    (part) =>
      part.type === 'text' &&
      typeof part.text === 'string' &&
      part.text.trim().length > 0 &&
      part.text !== pendingAssistantMessageText
  )
}
