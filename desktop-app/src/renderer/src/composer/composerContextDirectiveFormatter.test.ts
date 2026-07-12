import { describe, expect, it } from 'vitest'

import {
  appendComposerContextReference,
  composerContextDirectiveFormatter,
  dedupeComposerContextReferences,
  parseComposerContextReferences,
  serializeComposerContextReference
} from './composerContextDirectiveFormatter'

describe('composerContextDirectiveFormatter', () => {
  it('round-trips local paths with spaces, Chinese, and directive punctuation', () => {
    const reference = {
      type: 'file' as const,
      label: '设计 ] } "稿".png',
      path: '/Users/me/资料/设计 ] } "稿".png'
    }
    const directive = serializeComposerContextReference(reference)

    expect(directive).toBe(
      ':file[%E8%AE%BE%E8%AE%A1%20%5D%20%7D%20%22%E7%A8%BF%22.png]{name=%2FUsers%2Fme%2F%E8%B5%84%E6%96%99%2F%E8%AE%BE%E8%AE%A1%20%5D%20%7D%20%22%E7%A8%BF%22.png}'
    )
    expect(parseComposerContextReferences(directive)).toEqual([reference])
  })

  it('round-trips colons, quotes, parentheses, and braces without changing the display label', () => {
    const reference = {
      type: 'folder' as const,
      label: '方案: "v2" (已审) {}',
      path: '/repo/方案: "v2" (已审) {}'
    }

    expect(parseComposerContextReferences(serializeComposerContextReference(reference))).toEqual([
      reference
    ])
  })

  it('keeps invalid and relative file directives as text', () => {
    const input = ':file[relative]{name=src%2Findex.ts} :file[missing-name]'

    expect(composerContextDirectiveFormatter.parse(input)).toEqual([{ kind: 'text', text: input }])
  })

  it('accepts existing unencoded directives and falls back to raw malformed encoding', () => {
    expect(parseComposerContextReferences(':folder[broken%ZZ]{name=/repo}')).toEqual([
      { type: 'folder', label: 'broken%ZZ', path: '/repo' }
    ])
    expect(parseComposerContextReferences(':file[old name]{name=/repo/file.ts}')).toEqual([
      { type: 'file', label: 'old name', path: '/repo/file.ts' }
    ])
  })

  it('delegates command and tool directives to assistant-ui unchanged', () => {
    const input = ':tool[Search]{name=web_search} :command[Review]{name=review-risks}'

    expect(composerContextDirectiveFormatter.parse(input)).toEqual([
      { kind: 'mention', type: 'tool', label: 'Search', id: 'web_search' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', type: 'command', label: 'Review', id: 'review-risks' }
    ])
    expect(
      composerContextDirectiveFormatter.serialize({
        id: 'web_search',
        type: 'tool',
        label: 'Search'
      })
    ).toBe(':tool[Search]{name=web_search}')
  })

  it('appends exactly once by absolute path and preserves the draft text', () => {
    const reference = { type: 'folder' as const, label: 'app', path: '/repo/app' }
    const once = appendComposerContextReference('检查一下', reference)

    expect(once).toBe('检查一下 :folder[app]{name=%2Frepo%2Fapp}')
    expect(appendComposerContextReference(once, { ...reference, label: 'renamed' })).toBe(once)
  })

  it('deduplicates only local context directives without changing tool directives', () => {
    const input =
      ':tool[Search]{name=web_search} :file[a]{name=%2Frepo%2Fa} :folder[a again]{name=%2Frepo%2Fa}'

    expect(dedupeComposerContextReferences(input)).toBe(
      ':tool[Search]{name=web_search} :file[a]{name=%2Frepo%2Fa} '
    )
  })
})
