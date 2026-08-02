// @vitest-environment jsdom

import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { $createDirectiveNodeWithFormatter, DirectiveNode } from '@assistant-ui/react-lexical'
import { describe, expect, it, vi } from 'vitest'

import { composerContextDirectiveFormatter } from './composerContextDirectiveFormatter'
import { plainTextRangeMatches, replacePlainTextRange } from './composerSuggestionLexicalText'

describe('composer suggestion lexical text', () => {
  it.each([
    {
      name: 'the beginning',
      text: 'review this',
      start: 0,
      end: 0,
      expectedSuffix: 'review this'
    },
    {
      name: 'the middle',
      text: 'review target now',
      start: 7,
      end: 13,
      expectedPrefix: 'review ',
      expectedSuffix: ' now'
    },
    {
      name: 'the end',
      text: 'review this',
      start: 11,
      end: 11,
      expectedPrefix: 'review this'
    }
  ])('replaces the exact plain-text range at $name with one directive', (testCase) => {
    const editor = createEditor({
      namespace: testCase.name,
      nodes: [DirectiveNode],
      onError: vi.fn()
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode(testCase.text)))
      },
      { discrete: true }
    )

    replacePlainTextRange(
      editor,
      testCase.start,
      testCase.end,
      { id: '/repo/src/App.tsx', type: 'file', label: 'App.tsx' },
      composerContextDirectiveFormatter
    )

    editor.getEditorState().read(() => {
      const text = $getRoot().getTextContent()
      expect(text.match(/:file\[/gu)).toHaveLength(1)
      expect(text).toContain('{name=%2Frepo%2Fsrc%2FApp.tsx}')
      expect(text.startsWith(testCase.expectedPrefix ?? '')).toBe(true)
      expect(text.endsWith(testCase.expectedSuffix ?? '')).toBe(true)
    })
  })

  it('removes a dismissed typed query without inserting hidden characters', () => {
    const editor = createEditor({
      namespace: 'dismiss-query',
      nodes: [DirectiveNode],
      onError: vi.fn()
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('before @query after')))
      },
      { discrete: true }
    )

    replacePlainTextRange(editor, 7, 13, undefined, composerContextDirectiveFormatter)

    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('before  after')
    })
  })

  it('matches the exact trigger text before replacing a stored range', () => {
    const editor = createEditor({ namespace: 'range-matches', onError: vi.fn() })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('before /review after')))
      },
      { discrete: true }
    )

    expect(plainTextRangeMatches(editor, 7, 14, '/review')).toBe(true)
    expect(plainTextRangeMatches(editor, 7, 14, '/new')).toBe(false)
    expect(plainTextRangeMatches(editor, 7, 13, '/review')).toBe(false)
  })

  it('deduplicates the same path within workspace mention mode', () => {
    const editor = createEditor({
      namespace: 'dedupe-path',
      nodes: [DirectiveNode],
      onError: vi.fn()
    })
    let directiveSize = 0
    editor.update(
      () => {
        const directive = $createDirectiveNodeWithFormatter(
          { id: '/repo/src', type: 'folder', label: 'src' },
          composerContextDirectiveFormatter
        )
        directiveSize = directive.getTextContentSize()
        $getRoot().append($createParagraphNode().append(directive, $createTextNode('@duplicate')))
      },
      { discrete: true }
    )

    replacePlainTextRange(
      editor,
      directiveSize,
      directiveSize + '@duplicate'.length,
      { id: '/repo/src', type: 'file', label: 'src' },
      composerContextDirectiveFormatter
    )

    editor.getEditorState().read(() => {
      const text = $getRoot().getTextContent()
      expect(text.match(/:folder\[/gu)).toHaveLength(1)
      expect(text).not.toContain('@duplicate')
      expect(text).not.toContain(':file[')
    })
  })
})
