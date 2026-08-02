import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type RangeSelection
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useEffect, useRef } from 'react'
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react'

import { composerContextReferenceToTriggerItem } from './useComposerContextCatalog'
import {
  insertDirectiveAtSelection,
  plainTextRangeMatches,
  replacePlainTextRange,
  replacePlainTextRangeWithText
} from './composerSuggestionLexicalText'
import { useComposerSuggestion } from './composerSuggestionController'
import type { ComposerSuggestionSource, ComposerSuggestionTrigger } from './composerSuggestionTypes'

type ActiveRange = {
  end: number
  paragraphKey: string
  source: ComposerSuggestionSource
  start: number
}

/**
 * The only Lexical plugin that owns Composer suggestion trigger detection and
 * keyboard navigation. It intentionally does not depend on assistant-ui's
 * unstable slash-command adapter.
 */
export function ComposerSuggestionLexicalPlugin({
  formatter
}: {
  formatter: Unstable_DirectiveFormatter
}): null {
  const { controller: store } = useComposerSuggestion()
  const [editor] = useLexicalComposerContext()
  const activeRange = useRef<ActiveRange | null>(null)
  const dismissedRange = useRef<ActiveRange | null>(null)
  const isComposing = useRef(false)

  useEffect(() => {
    const close = (): void => {
      const active = activeRange.current
      if (active) dismissedRange.current = { ...active }
      activeRange.current = null
      store.closeFromEditor()
      editor.focus()
    }

    const togglePlus = (): void => {
      if (store.getSnapshot().open) {
        close()
        return
      }
      editor.focus(() => {
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
          const cursor = plainTextCursor(selection)
          const paragraphKey = selectionParagraphKey(selection)
          if (!cursor || !paragraphKey) return
          activeRange.current = {
            source: 'plus',
            start: cursor.offset,
            end: cursor.offset,
            paragraphKey
          }
          dismissedRange.current = null
          store.openFromEditor({ trigger: '+', source: 'plus', query: '', range: null })
        })
      })
    }

    const syncSuggestion = (): void => {
      if (isComposing.current) return
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        activeRange.current = null
        dismissedRange.current = null
        store.closeFromEditor()
        return
      }

      const cursor = plainTextCursor(selection)
      const paragraphKey = selectionParagraphKey(selection)
      if (!cursor || !paragraphKey) {
        activeRange.current = null
        dismissedRange.current = null
        store.closeFromEditor()
        return
      }

      const active = activeRange.current
      if (active?.source === 'plus') {
        if (active.paragraphKey !== paragraphKey || cursor.offset < active.start) {
          activeRange.current = null
          store.closeFromEditor()
          return
        }
        const query = $getRoot().getTextContent().slice(active.start, cursor.offset)
        if (query.includes('\n')) {
          activeRange.current = null
          store.closeFromEditor()
          return
        }
        active.end = cursor.offset
        store.openFromEditor({ trigger: '+', source: 'plus', query, range: null })
        return
      }

      const match = findTypedTriggerMatch(selection)
      if (!match) {
        activeRange.current = null
        dismissedRange.current = null
        store.closeFromEditor()
        return
      }
      const dismissed = dismissedRange.current
      if (dismissed && sameRange(dismissed, match)) {
        activeRange.current = null
        store.closeFromEditor()
        return
      }
      dismissedRange.current = null
      activeRange.current = match
      const text = $getRoot().getTextContent()
      store.openFromEditor({
        trigger: triggerForSource(match.source),
        source: match.source,
        query: text.slice(match.start + 1, match.end),
        range: { start: match.start, end: match.end }
      })
    }

    return mergeRegister(
      store.registerEditorController({
        dismiss: close,
        togglePlus,
        replaceRange: (range, replacement) =>
          replacePlainTextRangeWithText(editor, range.start, range.end, replacement),
        insertContext: (reference, range) => {
          const target = range ?? activeRange.current
          if (!target) return
          replacePlainTextRange(
            editor,
            target.start,
            target.end,
            composerContextReferenceToTriggerItem(reference),
            formatter
          )
          activeRange.current = null
          dismissedRange.current = null
          editor.focus()
        },
        insertTriggerItem: (item) => {
          insertDirectiveAtSelection(editor, item, formatter)
          editor.focus()
        },
        rangeMatches: (range, expectedText) =>
          plainTextRangeMatches(editor, range.start, range.end, expectedText)
      }),
      editor.registerUpdateListener(({ editorState }) => editorState.read(syncSuggestion)),
      editor.registerCommand(
        COMPOSITION_START_COMMAND,
        () => {
          isComposing.current = true
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        COMPOSITION_END_COMMAND,
        () => {
          isComposing.current = false
          queueMicrotask(() => editor.getEditorState().read(syncSuggestion))
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => consume(event, store.moveHighlight(1)),
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => consume(event, store.moveHighlight(-1)),
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.isComposing || !store.selectHighlighted()) return false
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (!event || event.isComposing || !store.selectHighlighted()) return false
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const session = store.getSnapshot()
          if (!session.open) return false
          if (session.view.type === 'submenu') store.handleEscape()
          else close()
          event?.preventDefault()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => consume(event, store.handleEmptySubmenuBackspace()),
        COMMAND_PRIORITY_CRITICAL
      )
    )
  }, [editor, formatter, store])

  return null
}

function consume(event: KeyboardEvent | null, handled: boolean): boolean {
  if (!handled) return false
  event?.preventDefault()
  return true
}

function triggerForSource(source: ComposerSuggestionSource): ComposerSuggestionTrigger {
  return source === 'typed-at' ? '@' : source === 'typed-slash' ? '/' : '+'
}

function sameRange(left: ActiveRange, right: ActiveRange): boolean {
  return (
    left.source === right.source &&
    left.start === right.start &&
    left.end === right.end &&
    left.paragraphKey === right.paragraphKey
  )
}

function findTypedTriggerMatch(selection: RangeSelection): ActiveRange | null {
  const anchor = selection.anchor
  if (anchor.type !== 'text') return null
  const node = anchor.getNode()
  if (!$isTextNode(node)) return null
  const text = node.getTextContent().slice(0, anchor.offset)
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index]
    if (character && /\s/u.test(character)) return null
    if (character !== '@' && character !== '/') continue
    if (index > 0 && !/\s/u.test(text[index - 1] ?? '')) continue
    const cursor = plainTextCursor(selection)
    const paragraphKey = selectionParagraphKey(selection)
    if (!cursor || !paragraphKey) return null
    return {
      source: character === '@' ? 'typed-at' : 'typed-slash',
      start: cursor.offset - (anchor.offset - index),
      end: cursor.offset,
      paragraphKey
    }
  }
  return null
}

function plainTextCursor(selection: RangeSelection): { offset: number } | null {
  const anchor = selection.anchor
  const anchorNode = anchor.getNode()
  const paragraph = $isElementNode(anchorNode) ? anchorNode : anchorNode.getParent()
  if (!paragraph || !$isElementNode(paragraph)) return null

  let offset = 0
  const root = $getRoot()
  for (const rootChild of root.getChildren()) {
    if (rootChild === paragraph) break
    offset += rootChild.getTextContentSize() + 1
  }
  if (anchor.type === 'element') {
    for (let index = 0; index < anchor.offset; index += 1) {
      offset += paragraph.getChildAtIndex(index)?.getTextContentSize() ?? 0
    }
    return { offset }
  }
  for (const child of paragraph.getChildren()) {
    if (child === anchorNode) return { offset: offset + anchor.offset }
    offset += child.getTextContentSize()
  }
  return null
}

function selectionParagraphKey(selection: RangeSelection): string | null {
  const node = selection.anchor.getNode()
  const paragraph = $isElementNode(node) ? node : node.getParent()
  return paragraph?.getKey() ?? null
}
