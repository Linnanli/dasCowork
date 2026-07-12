export type CodeCommentPriority = 'P0' | 'P1' | 'P2' | 'P3'

export type CodeComment = {
  title: string
  body: string
  file: string
  priority?: CodeCommentPriority
  confidence?: number
  startLine: number
  endLine: number
}

export type ParsedCodeCommentDirectives = {
  visibleText: string
  comments: CodeComment[]
}

const DIRECTIVE_PREFIX = '::code-comment{'
const TITLE_PRIORITY_PATTERN = /^\[P([0-3])\]/iu
const ANY_TITLE_PRIORITY_PATTERN = /^\[P\d\]/iu

/**
 * Extract complete, standalone code-comment directives from assistant Markdown.
 * Invalid directives are deliberately left visible so model output is never lost.
 */
export function parseCodeCommentDirectives(text: string): ParsedCodeCommentDirectives {
  const comments: CodeComment[] = []
  const seen = new Set<string>()
  let visibleText = ''

  for (const line of linesWithEndings(text)) {
    const comment = parseDirectiveLine(line.content)
    if (!comment) {
      visibleText += line.content + line.ending
      continue
    }

    const key = commentKey(comment)
    if (!seen.has(key)) {
      seen.add(key)
      comments.push(comment)
    }
  }

  return { visibleText, comments }
}

function parseDirectiveLine(line: string): CodeComment | undefined {
  if (!line.startsWith(DIRECTIVE_PREFIX)) return undefined

  const closingBrace = findClosingBrace(line, DIRECTIVE_PREFIX.length)
  if (closingBrace === undefined || line.slice(closingBrace + 1).trim().length > 0) {
    return undefined
  }

  const attributes = parseAttributes(line.slice(DIRECTIVE_PREFIX.length, closingBrace))
  if (!attributes) return undefined

  const rawTitle = attributes.get('title')?.trim()
  const body = attributes.get('body')?.trim()
  const file = attributes.get('file')?.trim()
  if (!rawTitle || !body || !file) return undefined

  const attributePriority = parsePriority(attributes.get('priority'))
  const titlePriority = parseTitlePriority(rawTitle)
  const priority = titlePriority ?? attributePriority
  const title =
    attributePriority && !ANY_TITLE_PRIORITY_PATTERN.test(rawTitle)
      ? `[${attributePriority}] ${rawTitle}`
      : rawTitle
  const startLine = parseLineNumber(attributes.get('start')) ?? 1
  const requestedEndLine = parseLineNumber(attributes.get('end')) ?? startLine

  return {
    title,
    body,
    file,
    ...(priority ? { priority } : {}),
    ...optionalConfidence(attributes.get('confidence')),
    startLine,
    endLine: Math.max(startLine, requestedEndLine)
  }
}

function findClosingBrace(line: string, start: number): number | undefined {
  let quoted = false
  let escaped = false

  for (let index = start; index < line.length; index += 1) {
    const character = line[index]
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === '}') {
      return index
    }
  }

  return undefined
}

function parseAttributes(input: string): Map<string, string> | undefined {
  const attributes = new Map<string, string>()
  let index = 0

  while (index < input.length) {
    index = skipWhitespace(input, index)
    if (index >= input.length) break

    const nameStart = index
    while (index < input.length && /[A-Za-z0-9_-]/u.test(input[index] ?? '')) index += 1
    if (index === nameStart) return undefined
    const name = input.slice(nameStart, index)

    index = skipWhitespace(input, index)
    if (input[index] !== '=') return undefined
    index = skipWhitespace(input, index + 1)
    if (index >= input.length) return undefined

    const parsedValue =
      input[index] === '"' ? parseQuotedValue(input, index + 1) : parseUnquotedValue(input, index)
    if (!parsedValue) return undefined

    attributes.set(name, parsedValue.value)
    index = parsedValue.nextIndex
  }

  return attributes
}

function parseQuotedValue(
  input: string,
  start: number
): { value: string; nextIndex: number } | undefined {
  let value = ''

  for (let index = start; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') return { value, nextIndex: index + 1 }

    if (character === '\\' && index + 1 < input.length) {
      const next = input[index + 1]
      if (next === '"' || next === '\\') {
        value += next
        index += 1
        continue
      }
    }

    value += character
  }

  return undefined
}

function parseUnquotedValue(
  input: string,
  start: number
): { value: string; nextIndex: number } | undefined {
  let index = start
  while (index < input.length && !/\s/u.test(input[index] ?? '')) index += 1
  if (index === start) return undefined
  return { value: input.slice(start, index), nextIndex: index }
}

function skipWhitespace(input: string, start: number): number {
  let index = start
  while (index < input.length && /\s/u.test(input[index] ?? '')) index += 1
  return index
}

function parsePriority(value: string | undefined): CodeCommentPriority | undefined {
  const match = value?.trim().match(/^[Pp]?([0-3])$/u)
  return match ? (`P${match[1]}` as CodeCommentPriority) : undefined
}

function parseTitlePriority(title: string): CodeCommentPriority | undefined {
  const match = title.match(TITLE_PRIORITY_PATTERN)
  return match ? (`P${match[1]}` as CodeCommentPriority) : undefined
}

function parseLineNumber(value: string | undefined): number | undefined {
  if (!value || !/^[+-]?\d+$/u.test(value.trim())) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return undefined
  return Math.max(1, parsed)
}

function optionalConfidence(value: string | undefined): Pick<CodeComment, 'confidence'> | object {
  if (!value || value.trim().length === 0) return {}
  const confidence = Number(value)
  return Number.isFinite(confidence) ? { confidence } : {}
}

function commentKey(comment: CodeComment): string {
  return JSON.stringify([
    comment.file,
    comment.startLine,
    comment.endLine,
    comment.title,
    comment.body
  ])
}

function linesWithEndings(text: string): Array<{ content: string; ending: string }> {
  const lines: Array<{ content: string; ending: string }> = []
  let lineStart = 0

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character !== '\n' && character !== '\r') continue

    const ending = character === '\r' && text[index + 1] === '\n' ? '\r\n' : character
    lines.push({ content: text.slice(lineStart, index), ending })
    if (ending === '\r\n') index += 1
    lineStart = index + 1
  }

  if (lineStart < text.length || text.length === 0) {
    lines.push({ content: text.slice(lineStart), ending: '' })
  }

  return lines
}
