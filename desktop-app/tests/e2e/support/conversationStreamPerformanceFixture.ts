import { createHash } from 'node:crypto'

import { responseCompleted, responseCreated, type ResponsesStreamStep } from './mockBackend'

export const CONVERSATION_STREAM_DELTA_COUNT = 600
export const CONVERSATION_STREAM_DELTA_INTERVAL_MS = 50
export const CONVERSATION_STREAM_DURATION_MS =
  CONVERSATION_STREAM_DELTA_COUNT * CONVERSATION_STREAM_DELTA_INTERVAL_MS
export const CONVERSATION_STREAM_HISTORY_MESSAGE_COUNT = 0

export type ConversationStreamPerformanceFixture = {
  sha256: string
  response: ResponsesStreamStep
  deltas: readonly string[]
  finalText: string
  durationMs: number
  deltaCount: number
  deltaIntervalMs: number
  deltaBytes: number
  finalTextBytes: number
  historyMessageCount: number
}

export function createConversationStreamPerformanceFixture(): ConversationStreamPerformanceFixture {
  const deltas = Array.from({ length: CONVERSATION_STREAM_DELTA_COUNT }, (_, index) =>
    markdownDelta(index)
  )
  const finalText = deltas.join('')
  const responseId = 'conversation-stream-performance-response'
  const messageId = 'conversation-stream-performance-message'

  return {
    sha256: sha256(finalText),
    response: {
      events: [
        responseCreated(responseId),
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'message',
            role: 'assistant',
            id: messageId,
            content: [{ type: 'output_text', text: '' }]
          }
        },
        ...deltas.map((delta) => ({ type: 'response.output_text.delta', delta })),
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: messageId,
            content: [{ type: 'output_text', text: finalText }]
          }
        },
        responseCompleted(responseId)
      ],
      beforeEvent: (_event, index) => {
        if (index < 2 || index >= CONVERSATION_STREAM_DELTA_COUNT + 2) return undefined
        return new Promise<void>((resolve) =>
          setTimeout(resolve, CONVERSATION_STREAM_DELTA_INTERVAL_MS)
        )
      }
    },
    deltas,
    finalText,
    durationMs: CONVERSATION_STREAM_DURATION_MS,
    deltaCount: CONVERSATION_STREAM_DELTA_COUNT,
    deltaIntervalMs: CONVERSATION_STREAM_DELTA_INTERVAL_MS,
    deltaBytes: byteLength(deltas.join('')),
    finalTextBytes: byteLength(finalText),
    historyMessageCount: CONVERSATION_STREAM_HISTORY_MESSAGE_COUNT
  }
}

function markdownDelta(index: number): string {
  const section = index % 12
  if (section === 0)
    return `\n\n## Streaming section ${String(index / 12 + 1).padStart(2, '0')}\n\n`
  if (section === 1) return `The renderer receives deterministic delta ${index + 1}. `
  if (section === 2)
    return 'It contains **bold text**, `inline code`, and a stable checksum target. '
  if (section === 3) return '\n\n| key | value |\n| --- | --- |\n'
  if (section === 4) return `| delta | ${index + 1} |\n`
  if (section === 5) return '| language | TypeScript |\n\n'
  if (section === 6) return '```ts\n'
  if (section === 7) return `const streamedValue${index} = ${index};\n`
  if (section === 8) return '```\n\n'
  if (section === 9) return '- 中文内容用于覆盖 CJK Markdown 渲染路径。\n'
  if (section === 10) return '- Mermaid fence markers stay textual in the stream.\n'
  return `The sample keeps updating without changing fixture entropy. Terminal delta ${index + 1}.\n`
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
