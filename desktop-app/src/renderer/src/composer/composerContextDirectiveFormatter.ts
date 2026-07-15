import {
  type Unstable_DirectiveFormatter,
  type Unstable_DirectiveSegment,
  type Unstable_TriggerItem,
  unstable_defaultDirectiveFormatter
} from '@assistant-ui/react'

export type ComposerContextReferenceType =
  | 'file'
  | 'folder'
  | 'chat'
  | 'agent'
  | 'agentRole'
  | 'skill'
  | 'app'
  | 'plugin'

export type ComposerContextReference = {
  type: ComposerContextReferenceType
  path: string
  label: string
}

const directivePattern = /:([\w-]{1,64})\[([^\]\n]{1,1024})\](?:\{name=([^}\n]{1,1024})\})?/gu

/**
 * Keep the standard assistant-ui directive syntax for tools and commands while
 * escaping local labels and paths. Local references must never be parsed from
 * damaged or relative directives: they remain ordinary composer text instead.
 */
export const composerContextDirectiveFormatter: Unstable_DirectiveFormatter = {
  serialize(item: Unstable_TriggerItem): string {
    if (!isComposerContextReferenceType(item.type)) {
      return unstable_defaultDirectiveFormatter.serialize(item)
    }

    return `:${item.type}[${encodeURIComponent(item.label)}]{name=${encodeURIComponent(item.id)}}`
  },

  parse(text: string): readonly Unstable_DirectiveSegment[] {
    const segments: Unstable_DirectiveSegment[] = []
    let lastIndex = 0

    for (const match of text.matchAll(directivePattern)) {
      const offset = match.index ?? 0
      appendDefaultSegments(segments, text.slice(lastIndex, offset))

      const raw = match[0]
      const type = match[1]
      const reference =
        type && isComposerContextReferenceType(type)
          ? decodeComposerContextReference({
              type,
              encodedLabel: match[2] ?? '',
              encodedPath: match[3] ?? ''
            })
          : undefined

      if (reference) {
        appendSegment(segments, {
          kind: 'mention',
          type: reference.type,
          label: reference.label,
          id: reference.path
        })
      } else if (isComposerContextReferenceType(type ?? '')) {
        appendSegment(segments, { kind: 'text', text: raw })
      } else {
        appendDefaultSegments(segments, raw)
      }

      lastIndex = offset + raw.length
    }

    appendDefaultSegments(segments, text.slice(lastIndex))
    return segments.length > 0 ? segments : [{ kind: 'text', text }]
  }
}

export function serializeComposerContextReference(reference: ComposerContextReference): string {
  return composerContextDirectiveFormatter.serialize({
    id: reference.path,
    type: reference.type,
    label: reference.label
  })
}

export function parseComposerContextReferences(text: string): readonly ComposerContextReference[] {
  return composerContextDirectiveFormatter.parse(text).flatMap((segment) => {
    if (segment.kind !== 'mention' || !isComposerContextReferenceType(segment.type)) return []
    if (!isValidReferencePath(segment.type, segment.id)) return []
    return [{ type: segment.type, path: segment.id, label: segment.label }]
  })
}

/** Append a path chip without disturbing the user's existing draft. */
export function appendComposerContextReference(
  draft: string,
  reference: ComposerContextReference
): string {
  if (!isValidReferencePath(reference.type, reference.path) || reference.label.length === 0) {
    return draft
  }
  if (
    parseComposerContextReferences(draft).some(
      (item) => item.type === reference.type && item.path === reference.path
    )
  ) {
    return draft
  }

  const directive = serializeComposerContextReference(reference)
  if (draft.length === 0 || /\s$/u.test(draft)) return `${draft}${directive}`
  return `${draft} ${directive}`
}

export function dedupeComposerContextReferences(draft: string): string {
  const seenReferences = new Set<string>()
  const segments = composerContextDirectiveFormatter.parse(draft)

  return segments
    .map((segment) => {
      if (segment.kind !== 'mention' || !isComposerContextReferenceType(segment.type)) {
        return segment.kind === 'text'
          ? segment.text
          : unstable_defaultDirectiveFormatter.serialize(segment)
      }
      const canonicalId =
        segment.type === 'file' || segment.type === 'folder'
          ? `path:${segment.id}`
          : `${segment.type}:${segment.id}`
      if (!isValidReferencePath(segment.type, segment.id) || seenReferences.has(canonicalId)) {
        return ''
      }
      seenReferences.add(canonicalId)
      return serializeComposerContextReference({
        type: segment.type,
        path: segment.id,
        label: segment.label
      })
    })
    .join('')
}

export function isComposerContextReferenceType(
  value: string
): value is ComposerContextReferenceType {
  return (
    value === 'file' ||
    value === 'folder' ||
    value === 'chat' ||
    value === 'agent' ||
    value === 'agentRole' ||
    value === 'skill' ||
    value === 'app' ||
    value === 'plugin'
  )
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value)
}

function decodeComposerContextReference({
  type,
  encodedLabel,
  encodedPath
}: {
  type: ComposerContextReferenceType
  encodedLabel: string
  encodedPath: string
}): ComposerContextReference | undefined {
  const label = decodeUriComponentSafely(encodedLabel)
  const path = decodeUriComponentSafely(encodedPath)
  if (!label || !path || !isValidReferencePath(type, path)) return undefined
  return { type, label, path }
}

function isValidReferencePath(type: ComposerContextReferenceType, path: string): boolean {
  switch (type) {
    case 'file':
    case 'folder':
    case 'skill':
      return isAbsolutePath(path)
    case 'chat':
      return hasSchemeIdentifier(path, 'thread://')
    case 'agent':
      return hasSchemeIdentifier(path, 'agent://')
    case 'agentRole':
      return hasSchemeIdentifier(path, 'subagent://')
    case 'app':
      return hasSchemeIdentifier(path, 'app://')
    case 'plugin':
      return hasSchemeIdentifier(path, 'plugin://')
  }
}

function hasSchemeIdentifier(path: string, scheme: string): boolean {
  return path.startsWith(scheme) && path.length > scheme.length
}

function decodeUriComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function appendDefaultSegments(segments: Unstable_DirectiveSegment[], text: string): void {
  if (text.length === 0) return
  for (const segment of unstable_defaultDirectiveFormatter.parse(text)) {
    appendSegment(segments, segment)
  }
}

function appendSegment(
  segments: Unstable_DirectiveSegment[],
  next: Unstable_DirectiveSegment
): void {
  const previous = segments.at(-1)
  if (previous?.kind === 'text' && next.kind === 'text') {
    segments[segments.length - 1] = { kind: 'text', text: `${previous.text}${next.text}` }
    return
  }
  segments.push(next)
}
