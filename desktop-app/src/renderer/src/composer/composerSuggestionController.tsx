/* eslint-disable react-refresh/only-export-components -- provider, hook and store form one state boundary */

import type { Unstable_TriggerItem } from '@assistant-ui/react'
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren
} from 'react'

import {
  closedComposerSuggestionSession,
  type ComposerSuggestionItem,
  type ComposerSuggestionSection,
  type ComposerSuggestionSession,
  type ComposerSuggestionSource,
  type ComposerSuggestionTrigger
} from './composerSuggestionTypes'

type EditorController = {
  dismiss(): void
  insertContext(
    reference: import('../../../shared/composerContext').ComposerContextReference,
    range: Extract<ComposerSuggestionSession, { open: true }>['range']
  ): void
  insertTriggerItem(item: Unstable_TriggerItem): void
  rangeMatches(
    range: import('./composerSuggestionTypes').ComposerSuggestionRange,
    expectedText: string
  ): boolean
  replaceRange(
    range: import('./composerSuggestionTypes').ComposerSuggestionRange,
    replacement: string
  ): void
  togglePlus(): void
}

type SelectionHandler = (
  item: ComposerSuggestionItem,
  session: Extract<ComposerSuggestionSession, { open: true }>
) => void

type OpenComposerSuggestionInput = {
  trigger: ComposerSuggestionTrigger
  source: ComposerSuggestionSource
  query: string
  range: Extract<ComposerSuggestionSession, { open: true }>['range']
}

export class ComposerSuggestionStore {
  private editorController: EditorController | undefined
  private sections: readonly ComposerSuggestionSection[] = []
  private readonly listeners = new Set<() => void>()
  private selectionHandler: SelectionHandler | undefined
  private session: ComposerSuggestionSession = closedComposerSuggestionSession

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ComposerSuggestionSession => this.session

  getSections = (): readonly ComposerSuggestionSection[] => this.sections

  registerEditorController(controller: EditorController): () => void {
    this.editorController = controller
    return () => {
      if (this.editorController === controller) this.editorController = undefined
    }
  }

  registerSelectionHandler(handler: SelectionHandler): () => void {
    this.selectionHandler = handler
    return () => {
      if (this.selectionHandler === handler) this.selectionHandler = undefined
    }
  }

  togglePlus(): void {
    this.editorController?.togglePlus()
  }

  dismiss(): void {
    this.editorController?.dismiss()
  }

  replaceRange(
    range: import('./composerSuggestionTypes').ComposerSuggestionRange,
    replacement: string
  ): void {
    this.editorController?.replaceRange(range, replacement)
  }

  insertContext(
    reference: import('../../../shared/composerContext').ComposerContextReference,
    range: Extract<ComposerSuggestionSession, { open: true }>['range']
  ): void {
    this.editorController?.insertContext(reference, range)
  }

  insertTriggerItem(item: Unstable_TriggerItem): void {
    this.editorController?.insertTriggerItem(item)
  }

  rangeMatches(
    range: import('./composerSuggestionTypes').ComposerSuggestionRange,
    expectedText: string
  ): boolean {
    return this.editorController?.rangeMatches(range, expectedText) ?? false
  }

  setSections(sections: readonly ComposerSuggestionSection[]): void {
    this.sections = sections
    if (!this.session.open) return

    const nextHighlightedId = normalizeHighlightedId(
      this.session.highlightedId,
      flattenEnabledItems(sections)
    )
    if (nextHighlightedId === this.session.highlightedId) return
    this.update({ ...this.session, highlightedId: nextHighlightedId })
  }

  openFromEditor(input: OpenComposerSuggestionInput): void {
    if (
      this.session.open &&
      this.session.trigger === input.trigger &&
      this.session.source === input.source &&
      this.session.query === input.query &&
      sameSuggestionRange(this.session.range, input.range) &&
      this.session.view.type === 'list'
    ) {
      return
    }
    const highlightedId = this.session.open
      ? normalizeHighlightedId(this.session.highlightedId, flattenEnabledItems(this.sections))
      : (firstEnabledItem(this.sections)?.id ?? null)
    this.update({
      open: true,
      trigger: input.trigger,
      source: input.source,
      query: input.query,
      range: input.range,
      highlightedId,
      view: { type: 'list' }
    })
  }

  closeFromEditor(): void {
    this.close()
  }

  close(): void {
    if (!this.session.open) return
    this.update(closedComposerSuggestionSession)
  }

  updateSession(session: ComposerSuggestionSession): void {
    this.update(session)
  }

  highlight(id: string): void {
    if (!this.session.open || this.session.highlightedId === id) return
    if (!findItemById(this.sections, id) || findItemById(this.sections, id)?.disabled) return
    this.update({ ...this.session, highlightedId: id })
  }

  moveHighlight(direction: 1 | -1): boolean {
    const session = this.session
    if (!session.open) return false
    const items = flattenEnabledItems(this.sections)
    if (items.length === 0) return false

    const currentIndex = items.findIndex((item) => item.id === session.highlightedId)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (baseIndex + direction + items.length) % items.length
    this.update({ ...session, highlightedId: items[nextIndex]?.id ?? null })
    return true
  }

  getHighlightedItem(): ComposerSuggestionItem | null {
    if (!this.session.open) return null
    if (!this.session.highlightedId) return firstEnabledItem(this.sections) ?? null
    return (
      findItemById(this.sections, this.session.highlightedId) ??
      firstEnabledItem(this.sections) ??
      null
    )
  }

  selectHighlighted(select?: SelectionHandler): boolean {
    if (!this.session.open) return false
    const item = this.getHighlightedItem()
    const handler = select ?? this.selectionHandler
    if (!item || item.disabled || !handler) return false
    handler(item, this.session)
    return true
  }

  selectItem(item: ComposerSuggestionItem): boolean {
    if (!this.session.open || item.disabled || !this.selectionHandler) return false
    this.selectionHandler(item, this.session)
    return true
  }

  handleEscape(): boolean {
    if (!this.session.open) return false
    if (this.session.view.type === 'submenu') {
      this.update({
        ...this.session,
        query: '',
        highlightedId: null,
        view: { type: 'list' }
      })
      return true
    }
    this.close()
    return true
  }

  handleEmptySubmenuBackspace(): boolean {
    if (!this.session.open || this.session.view.type !== 'submenu' || this.session.query !== '') {
      return false
    }
    this.update({
      ...this.session,
      highlightedId: null,
      view: { type: 'list' }
    })
    return true
  }

  private update(session: ComposerSuggestionSession): void {
    this.session = session
    for (const listener of this.listeners) listener()
  }
}

const ComposerSuggestionContext = createContext<ComposerSuggestionStore | null>(null)

export function ComposerSuggestionProvider({ children }: PropsWithChildren): React.JSX.Element {
  const store = useMemo(() => new ComposerSuggestionStore(), [])
  return (
    <ComposerSuggestionContext.Provider value={store}>
      {children}
    </ComposerSuggestionContext.Provider>
  )
}

export function useComposerSuggestion(): {
  controller: ComposerSuggestionStore
  state: ComposerSuggestionSession
} {
  const controller = useContext(ComposerSuggestionContext)
  if (!controller) {
    throw new Error('ComposerSuggestionProvider is missing')
  }
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  return { controller, state }
}

function flattenEnabledItems(
  sections: readonly ComposerSuggestionSection[]
): readonly ComposerSuggestionItem[] {
  return sections.flatMap((section) => section.items).filter((item) => !item.disabled)
}

function firstEnabledItem(
  sections: readonly ComposerSuggestionSection[]
): ComposerSuggestionItem | undefined {
  return flattenEnabledItems(sections)[0]
}

function normalizeHighlightedId(
  highlightedId: string | null,
  items: readonly ComposerSuggestionItem[]
): string | null {
  if (highlightedId && items.some((item) => item.id === highlightedId)) return highlightedId
  return items[0]?.id ?? null
}

function findItemById(
  sections: readonly ComposerSuggestionSection[],
  id: string
): ComposerSuggestionItem | undefined {
  return sections.flatMap((section) => section.items).find((item) => item.id === id)
}

function sameSuggestionRange(
  left: Extract<ComposerSuggestionSession, { open: true }>['range'],
  right: Extract<ComposerSuggestionSession, { open: true }>['range']
): boolean {
  return left?.start === right?.start && left?.end === right?.end
}
