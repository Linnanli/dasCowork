import type { Unstable_DirectiveFormatter, Unstable_TriggerItem } from '@assistant-ui/react'
import { $createDirectiveNodeWithFormatter, $isDirectiveNode } from '@assistant-ui/react-lexical'
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection
} from 'lexical'

/** Inserts a directive chip while replacing precisely the active plain-text range. */
export function replacePlainTextRange(
  editor: LexicalEditor,
  start: number,
  end: number,
  item: Unstable_TriggerItem | undefined,
  formatter: Unstable_DirectiveFormatter
): void {
  editor.update(
    () => {
      const selection = createPlainTextRange(start, end)
      if (!selection) return
      $setSelection(selection)
      if (!item || hasMatchingContextDirective($getRoot(), item)) {
        selection.insertText('')
        return
      }
      selection.insertNodes([$createDirectiveNodeWithFormatter(item, formatter)])
    },
    { discrete: true, tag: 'history-merge' }
  )
}

/** Replaces a plain-text range without creating a directive chip. */
export function replacePlainTextRangeWithText(
  editor: LexicalEditor,
  start: number,
  end: number,
  replacement: string
): void {
  editor.update(
    () => {
      const selection = createPlainTextRange(start, end)
      if (!selection) return
      $setSelection(selection)
      selection.insertText(replacement)
    },
    { discrete: true, tag: 'history-merge' }
  )
}

/** Confirms an offset range still points at the trigger text that opened a suggestion session. */
export function plainTextRangeMatches(
  editor: LexicalEditor,
  start: number,
  end: number,
  expectedText: string
): boolean {
  let matches = false
  editor.getEditorState().read(() => {
    matches = $getRoot().getTextContent().slice(start, end) === expectedText
  })
  return matches
}

/** Inserts a non-catalog directive, such as a model-provided tool, at the cursor. */
export function insertDirectiveAtSelection(
  editor: LexicalEditor,
  item: Unstable_TriggerItem,
  formatter: Unstable_DirectiveFormatter
): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      selection.insertNodes([$createDirectiveNodeWithFormatter(item, formatter)])
    },
    { discrete: true, tag: 'history-merge' }
  )
}

function hasMatchingContextDirective(node: LexicalNode, item: Unstable_TriggerItem): boolean {
  const identity = contextDirectiveIdentity(item.type, item.id)
  if (!identity) return false
  if ($isDirectiveNode(node)) {
    const existing = node.getDirectiveItem()
    return contextDirectiveIdentity(existing.type, existing.id) === identity
  }
  if (!$isElementNode(node)) return false
  return node.getChildren().some((child) => hasMatchingContextDirective(child, item))
}

function contextDirectiveIdentity(type: string, id: string): string | undefined {
  if (type === 'file' || type === 'folder') return `path:${id}`
  if (
    type === 'chat' ||
    type === 'agent' ||
    type === 'agentRole' ||
    type === 'skill' ||
    type === 'app' ||
    type === 'plugin'
  ) {
    return `${type}:${id}`
  }
  return undefined
}

function createPlainTextRange(start: number, end: number): RangeSelection | null {
  const anchor = findPointAtOffset(start)
  const focus = findPointAtOffset(end)
  if (!anchor || !focus) return null
  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  return selection
}

type LexicalPoint = {
  key: string
  offset: number
  type: 'element' | 'text'
}

function findPointAtOffset(targetOffset: number): LexicalPoint | null {
  const root = $getRoot()
  let offset = 0
  const paragraphs = root.getChildren()

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex]
    if (!$isElementNode(paragraph)) continue
    const point = findPointInElement(paragraph, targetOffset - offset)
    if (point) return point
    offset += paragraph.getTextContentSize()
    if (paragraphIndex < paragraphs.length - 1) {
      if (targetOffset === offset) {
        return { key: paragraph.getKey(), offset: paragraph.getChildrenSize(), type: 'element' }
      }
      offset += 1
    }
  }

  const last = paragraphs.at(-1)
  if ($isElementNode(last) && targetOffset === offset) {
    return { key: last.getKey(), offset: last.getChildrenSize(), type: 'element' }
  }
  return null
}

function findPointInElement(element: ElementNode, relativeOffset: number): LexicalPoint | null {
  if (relativeOffset < 0 || relativeOffset > element.getTextContentSize()) return null
  let offset = 0
  const children = element.getChildren()
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const size = child?.getTextContentSize() ?? 0
    if (child && $isTextNode(child) && relativeOffset <= offset + size) {
      return { key: child.getKey(), offset: relativeOffset - offset, type: 'text' }
    }
    if (relativeOffset === offset) {
      return { key: element.getKey(), offset: index, type: 'element' }
    }
    offset += size
  }
  return { key: element.getKey(), offset: children.length, type: 'element' }
}
