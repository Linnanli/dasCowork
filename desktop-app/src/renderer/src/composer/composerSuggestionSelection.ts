import type { ComposerContextReference } from '../../../shared/composerContext'
import {
  closedComposerSuggestionSession,
  type ComposerSuggestionItem,
  type ComposerSuggestionRange,
  type ComposerSuggestionSession
} from './composerSuggestionTypes'

type OpenComposerSuggestionSession = Extract<ComposerSuggestionSession, { open: true }>

export type ComposerSuggestionSelectionDispatch = {
  session: OpenComposerSuggestionSession
  item: ComposerSuggestionItem
  closeSession(): void
  updateSession(session: ComposerSuggestionSession): void
  rangeMatches?: (
    range: ComposerSuggestionRange,
    expectedText: string
  ) => boolean | Promise<boolean>
  replaceRange(range: ComposerSuggestionRange, replacement: string): void | Promise<void>
  insertContext(
    reference: ComposerContextReference,
    range: ComposerSuggestionRange | null
  ): void | Promise<void>
  openContent(input: {
    contentId: string
    item: ComposerSuggestionItem
    placement: 'panel' | 'composer'
  }): void | Promise<void>
  onError?: (error: unknown) => void
}

export type ComposerSuggestionSelectionResult =
  | { status: 'handled' }
  | { status: 'failed'; error: unknown }

export async function dispatchComposerSuggestionSelection({
  closeSession,
  insertContext,
  item,
  onError,
  openContent,
  rangeMatches,
  replaceRange,
  session,
  updateSession
}: ComposerSuggestionSelectionDispatch): Promise<ComposerSuggestionSelectionResult> {
  if (item.disabled) return { status: 'handled' }

  const selection = item.selection
  try {
    if (selection.type === 'insert-context') {
      await assertSessionRangeMatches(session, rangeMatches)
      await insertContext(selection.reference, session.range)
      closeSession()
      return { status: 'handled' }
    }

    if (selection.type === 'action') {
      await assertSessionRangeMatches(session, rangeMatches)
      closeSession()
      if (session.range) await replaceRange(session.range, '')
      await selection.run()
      return { status: 'handled' }
    }

    if (selection.type === 'query-completion') {
      await assertSessionRangeMatches(session, rangeMatches)
      const queryRange = getComposerSuggestionQueryRange(session)
      if (queryRange) await replaceRange(queryRange, selection.value)
      updateSession({
        ...session,
        query: selection.value,
        range: session.range
          ? {
              start: session.range.start,
              end: session.range.start + 1 + selection.value.length
            }
          : null,
        highlightedId: null,
        view: { type: 'list' }
      })
      return { status: 'handled' }
    }

    if (selection.type === 'submenu') {
      updateSession({
        ...session,
        query: '',
        highlightedId: null,
        view: { type: 'submenu', id: selection.submenuId, parentId: item.id }
      })
      return { status: 'handled' }
    }

    if (selection.type === 'content') {
      await assertSessionRangeMatches(session, rangeMatches)
      if (session.range) await replaceRange(session.range, '')
      await openContent({
        contentId: selection.contentId,
        item,
        placement: selection.placement
      })
      updateSession({
        ...session,
        query: '',
        range: null,
        highlightedId: null,
        view: { type: 'content', id: selection.contentId, placement: selection.placement }
      })
      return { status: 'handled' }
    }

    return { status: 'handled' }
  } catch (error) {
    if (
      error instanceof StaleComposerSuggestionRangeError ||
      selection.type === 'action' ||
      selection.type === 'content'
    ) {
      updateSession(closedComposerSuggestionSession)
    }
    onError?.(error)
    return { status: 'failed', error }
  }
}

export class StaleComposerSuggestionRangeError extends Error {
  constructor() {
    super('Composer suggestion text changed before the selection was applied')
    this.name = 'StaleComposerSuggestionRangeError'
  }
}

async function assertSessionRangeMatches(
  session: OpenComposerSuggestionSession,
  rangeMatches: ComposerSuggestionSelectionDispatch['rangeMatches']
): Promise<void> {
  if (!session.range || !rangeMatches) return
  const expectedText = `${session.trigger}${session.query}`
  if (!(await rangeMatches(session.range, expectedText))) {
    throw new StaleComposerSuggestionRangeError()
  }
}

export function getComposerSuggestionQueryRange(
  session: OpenComposerSuggestionSession
): ComposerSuggestionRange | null {
  if (!session.range || session.trigger === '+') return null
  return {
    start: session.range.start + 1,
    end: session.range.end
  }
}

export function replaceComposerSuggestionTextRange(
  draft: string,
  range: ComposerSuggestionRange,
  replacement: string
): string {
  assertValidComposerSuggestionRange(draft, range)
  return `${draft.slice(0, range.start)}${replacement}${draft.slice(range.end)}`
}

export function assertValidComposerSuggestionRange(
  draft: string,
  range: ComposerSuggestionRange
): void {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > draft.length
  ) {
    throw new RangeError(`Invalid composer suggestion range ${range.start}:${range.end}`)
  }
}
