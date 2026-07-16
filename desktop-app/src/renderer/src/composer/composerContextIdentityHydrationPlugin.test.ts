// @vitest-environment jsdom

import {
  createEditor,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection
} from 'lexical'
import { $createDirectiveNode, $isDirectiveNode, DirectiveNode } from '@assistant-ui/react-lexical'
import { describe, expect, it } from 'vitest'

import { composerContextDirectiveFormatter } from './composerContextDirectiveFormatter'
import { normalizeComposerContextDirectiveNode } from './composerContextIdentityHydrationPlugin'

describe('normalizeComposerContextDirectiveNode', () => {
  it('normalizes an old app node by URI without disturbing text, node identity, or selection', () => {
    const editor = createEditor({ namespace: 'identity-hydration-test', nodes: [DirectiveNode] })
    let directiveKey = ''
    let trailingTextKey = ''

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        const before = $createTextNode('before ')
        const directive = $createDirectiveNode(
          { id: 'app://app_123', type: 'app', label: 'Old Slack Label' },
          ':app[Old%20Slack%20Label]{name=app%3A%2F%2Fapp_123}'
        )
        const after = $createTextNode(' after')
        directiveKey = directive.getKey()
        trailingTextKey = after.getKey()
        paragraph.append(before, directive, after)
        $getRoot().append(paragraph)
        after.select(2, 2)
      },
      { discrete: true }
    )

    editor.update(
      () => {
        const directive = $getRoot().getFirstDescendant()?.getNextSibling()
        expect($isDirectiveNode(directive)).toBe(true)
        if (!$isDirectiveNode(directive)) return
        normalizeComposerContextDirectiveNode(
          directive,
          new Map([
            [
              'app://app_123',
              {
                type: 'app' as const,
                uri: 'app://app_123',
                displayLabel: 'Slack Workspace',
                mentionName: 'slack'
              }
            ]
          ]),
          composerContextDirectiveFormatter
        )
      },
      { discrete: true }
    )

    editor.getEditorState().read(() => {
      const directive = $getRoot().getFirstDescendant()?.getNextSibling()
      expect($isDirectiveNode(directive)).toBe(true)
      if (!$isDirectiveNode(directive)) return
      expect(directive.getKey()).toBe(directiveKey)
      expect(directive.getDirectiveItem().label).toBe('slack')
      expect(directive.getDirectiveText()).toBe(':app[slack]{name=app%3A%2F%2Fapp_123}')
      expect($getRoot().getTextContent()).toBe('before :app[slack]{name=app%3A%2F%2Fapp_123} after')
      const selection = $getSelection()
      expect(selection?.getNodes()[0]?.getKey()).toBe(trailingTextKey)
    })
  })
})
