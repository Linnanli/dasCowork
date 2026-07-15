/* eslint-disable react-refresh/only-export-components -- provider, hook and editor controller form one state boundary */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren
} from 'react'
import { type Unstable_DirectiveFormatter, type Unstable_TriggerItem } from '@assistant-ui/react'
import { $createDirectiveNodeWithFormatter, $isDirectiveNode } from '@assistant-ui/react-lexical'

export type ComposerContextSuggestionSource = 'typed-at' | 'plus'

export type ComposerContextSuggestionEntry = {
  id: string
  select(): void
}

export type ComposerContextSuggestionSnapshot =
  | {
      open: false
      highlightedIndex: 0
      query: ''
      source: null
    }
  | {
      open: true
      highlightedIndex: number
      query: string
      source: ComposerContextSuggestionSource
    }

type ActiveRange = {
  end: number
  paragraphKey: string
  source: ComposerContextSuggestionSource
  start: number
}

type DismissOptions = {
  removeQuery?: boolean
}

type EditorController = {
  dismiss(options?: DismissOptions): void
  insert(item: Unstable_TriggerItem): void
  togglePlus(): void
}

const closedSnapshot: ComposerContextSuggestionSnapshot = {
  open: false,
  highlightedIndex: 0,
  query: '',
  source: null
}

export class ComposerContextSuggestionStore {
  private editorController: EditorController | undefined
  private entries: readonly ComposerContextSuggestionEntry[] = []
  private readonly listeners = new Set<() => void>()
  private snapshot: ComposerContextSuggestionSnapshot = closedSnapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ComposerContextSuggestionSnapshot => this.snapshot

  registerEditorController(controller: EditorController): () => void {
    this.editorController = controller
    return () => {
      if (this.editorController === controller) this.editorController = undefined
    }
  }

  togglePlus(): void {
    this.editorController?.togglePlus()
  }

  dismiss(options?: DismissOptions): void {
    this.editorController?.dismiss(options)
  }

  selectItem(item: Unstable_TriggerItem): void {
    this.editorController?.insert(item)
  }

  selectHighlighted(): boolean {
    if (!this.snapshot.open) return false
    const entry = this.entries[this.snapshot.highlightedIndex]
    if (!entry) return false
    entry.select()
    return true
  }

  setNavigationEntries(entries: readonly ComposerContextSuggestionEntry[]): void {
    this.entries = entries
    if (!this.snapshot.open) return
    const nextIndex = clampIndex(this.snapshot.highlightedIndex, entries.length)
    if (nextIndex === this.snapshot.highlightedIndex) return
    this.update({ ...this.snapshot, highlightedIndex: nextIndex })
  }

  highlight(index: number): void {
    if (!this.snapshot.open) return
    const nextIndex = clampIndex(index, this.entries.length)
    if (nextIndex === this.snapshot.highlightedIndex) return
    this.update({ ...this.snapshot, highlightedIndex: nextIndex })
  }

  moveHighlight(direction: 1 | -1): boolean {
    if (!this.snapshot.open || this.entries.length === 0) return false
    const current = this.snapshot.highlightedIndex
    const next = (current + direction + this.entries.length) % this.entries.length
    this.update({ ...this.snapshot, highlightedIndex: next })
    return true
  }

  openFromEditor(source: ComposerContextSuggestionSource, query: string): void {
    if (this.snapshot.open && this.snapshot.source === source && this.snapshot.query === query) {
      return
    }
    this.update({ open: true, highlightedIndex: 0, query, source })
  }

  closeFromEditor(): void {
    if (!this.snapshot.open) return
    this.update(closedSnapshot)
  }

  private update(snapshot: ComposerContextSuggestionSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

const ComposerContextSuggestionContext = createContext<ComposerContextSuggestionStore | null>(null)

export function ComposerContextSuggestionProvider({
  children
}: PropsWithChildren): React.JSX.Element {
  const store = useMemo(() => new ComposerContextSuggestionStore(), [])
  return (
    <ComposerContextSuggestionContext.Provider value={store}>
      {children}
    </ComposerContextSuggestionContext.Provider>
  )
}

export function useComposerContextSuggestion(): {
  controller: ComposerContextSuggestionStore
  state: ComposerContextSuggestionSnapshot
} {
  const controller = useContext(ComposerContextSuggestionContext)
  if (!controller) {
    throw new Error('ComposerContextSuggestionProvider is missing')
  }
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  return { controller, state }
}

function useOptionalComposerContextSuggestionStore(): ComposerContextSuggestionStore | null {
  return useContext(ComposerContextSuggestionContext)
}

export function ComposerContextSuggestionPlugin({
  formatter
}: {
  formatter: Unstable_DirectiveFormatter
}): null {
  const store = useOptionalComposerContextSuggestionStore()
  const [editor] = useLexicalComposerContext()
  const activeRange = useRef<ActiveRange | null>(null)
  const dismissedRange = useRef<ActiveRange | null>(null)
  const isComposing = useRef(false)

  useEffect(() => {
    if (!store) return undefined

    const close = (options: DismissOptions = {}): void => {
      const active = activeRange.current
      if (active && options.removeQuery) {
        replacePlainTextRange(editor, active.start, active.end, undefined, formatter)
      } else if (active) {
        dismissedRange.current = { ...active }
      }
      activeRange.current = null
      store.closeFromEditor()
      editor.focus()
    }

    const insert = (item: Unstable_TriggerItem): void => {
      const active = activeRange.current
      if (!active) return
      replacePlainTextRange(editor, active.start, active.end, item, formatter)
      activeRange.current = null
      dismissedRange.current = null
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
          const range: ActiveRange = {
            source: 'plus',
            start: cursor.offset,
            end: cursor.offset,
            paragraphKey
          }
          activeRange.current = range
          dismissedRange.current = null
          store.openFromEditor('plus', '')
        })
      })
    }

    const syncSuggestion = (): void => {
      if (isComposing.current) return
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        activeRange.current = null
        store.closeFromEditor()
        return
      }

      const cursor = plainTextCursor(selection)
      const paragraphKey = selectionParagraphKey(selection)
      if (!cursor || !paragraphKey) {
        activeRange.current = null
        store.closeFromEditor()
        return
      }

      const current = activeRange.current
      if (current?.source === 'plus') {
        if (current.paragraphKey !== paragraphKey || cursor.offset < current.start) {
          activeRange.current = null
          store.closeFromEditor()
          return
        }
        const text = $getRoot().getTextContent().slice(current.start, cursor.offset)
        if (text.includes('\n')) {
          activeRange.current = null
          store.closeFromEditor()
          return
        }
        current.end = cursor.offset
        store.openFromEditor('plus', text)
        return
      }

      const match = findTypedAtMatch(selection)
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
      store.openFromEditor(
        'typed-at',
        $getRoot()
          .getTextContent()
          .slice(match.start + 1, match.end)
      )
    }

    const unregisterController = store.registerEditorController({
      dismiss: close,
      insert,
      togglePlus
    })

    return mergeRegister(
      unregisterController,
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
        (event) => handleNavigationEvent(event, store.moveHighlight(1)),
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => handleNavigationEvent(event, store.moveHighlight(-1)),
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
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!store.getSnapshot().open) return false
          event?.preventDefault()
          close()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      )
    )
  }, [editor, formatter, store])

  return null
}

function handleNavigationEvent(event: KeyboardEvent | null, handled: boolean): boolean {
  if (!handled) return false
  event?.preventDefault()
  return true
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(index, 0), itemCount - 1)
}

function sameRange(left: ActiveRange, right: ActiveRange): boolean {
  return (
    left.source === right.source &&
    left.start === right.start &&
    left.end === right.end &&
    left.paragraphKey === right.paragraphKey
  )
}

function findTypedAtMatch(selection: RangeSelection): ActiveRange | null {
  const anchor = selection.anchor
  if (anchor.type !== 'text') return null
  const node = anchor.getNode()
  if (!$isTextNode(node)) return null
  const text = node.getTextContent().slice(0, anchor.offset)
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index]
    if (character && /\s/u.test(character)) return null
    if (character !== '@') continue
    if (index > 0 && !/\s/u.test(text[index - 1] ?? '')) continue
    const cursor = plainTextCursor(selection)
    const paragraphKey = selectionParagraphKey(selection)
    if (!cursor || !paragraphKey) return null
    return {
      source: 'typed-at',
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
    if (child === anchorNode) {
      offset += anchor.offset
      return { offset }
    }
    offset += child.getTextContentSize()
  }
  return null
}

function selectionParagraphKey(selection: RangeSelection): string | null {
  const node = selection.anchor.getNode()
  const paragraph = $isElementNode(node) ? node : node.getParent()
  return paragraph?.getKey() ?? null
}

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
      if (!item) {
        selection.insertText('')
        return
      }
      if (hasMatchingContextDirective($getRoot(), item)) {
        selection.insertText('')
        return
      }
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
