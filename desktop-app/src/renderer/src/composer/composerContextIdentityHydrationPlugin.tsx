/* eslint-disable react-refresh/only-export-components -- the normalization helper is tested with the plugin */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { Unstable_DirectiveFormatter, Unstable_TriggerItem } from '@assistant-ui/react'
import { DirectiveNode } from '@assistant-ui/react-lexical'
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical'

import {
  type ComposerContextIdentityIndex,
  useComposerContextIdentityIndex
} from './composerContextIdentity'

export function ComposerContextIdentityHydrationPlugin({
  formatter
}: {
  formatter: Unstable_DirectiveFormatter
}): null {
  const [editor] = useLexicalComposerContext()
  const index = useComposerContextIdentityIndex()

  useEffect(() => {
    const unregister = editor.registerNodeTransform(DirectiveNode, (node) => {
      normalizeComposerContextDirectiveNode(node, index, formatter)
    })
    editor.update(() => {
      visitDirectiveNodes($getRoot(), (node) =>
        normalizeComposerContextDirectiveNode(node, index, formatter)
      )
    })
    return unregister
  }, [editor, formatter, index])

  return null
}

function visitDirectiveNodes(node: LexicalNode, visit: (node: DirectiveNode) => void): void {
  if (node instanceof DirectiveNode) {
    visit(node)
    return
  }
  if (!$isElementNode(node)) return
  for (const child of node.getChildren()) visitDirectiveNodes(child, visit)
}

export function normalizeComposerContextDirectiveNode(
  node: DirectiveNode,
  index: ComposerContextIdentityIndex,
  formatter: Unstable_DirectiveFormatter
): void {
  const item = node.getDirectiveItem()
  if (item.type !== 'app' && item.type !== 'plugin') return
  const identity = index.get(item.id)
  if (!identity || identity.type !== item.type || !identity.mentionName) return

  const metadata = withMentionName(item.metadata, identity.mentionName)
  const normalizedItem: Unstable_TriggerItem = {
    ...item,
    label: identity.mentionName,
    metadata
  }
  const directiveText = formatter.serialize(normalizedItem)
  if (
    item.label === identity.mentionName &&
    node.getDirectiveText() === directiveText &&
    metadataMentionName(item.metadata) === identity.mentionName
  ) {
    return
  }

  const writable = node.getWritable()
  writable.__label = identity.mentionName
  writable.__metadata = metadata
  writable.__directiveText = directiveText
}

function withMentionName(
  metadata: Unstable_TriggerItem['metadata'],
  mentionName: string
): NonNullable<Unstable_TriggerItem['metadata']> {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  return { ...record, mentionName }
}

function metadataMentionName(metadata: Unstable_TriggerItem['metadata']): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const value = (metadata as Record<string, unknown>).mentionName
  return typeof value === 'string' ? value : undefined
}
