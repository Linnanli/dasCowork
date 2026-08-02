import type { ReactNode } from 'react'

import type { ComposerContextReference } from '../../../shared/composerContext'

export type ComposerSuggestionTrigger = '@' | '/' | '+'

export type ComposerSuggestionSource = 'typed-at' | 'typed-slash' | 'plus'

export type ComposerSuggestionRange = {
  start: number
  end: number
}

export type ComposerSuggestionView =
  | { type: 'list' }
  | { type: 'submenu'; id: string; parentId: string }
  | { type: 'content'; id: string; placement: 'panel' | 'composer' }

export type ComposerSuggestionSession =
  | { open: false }
  | {
      open: true
      trigger: ComposerSuggestionTrigger
      source: ComposerSuggestionSource
      query: string
      range: ComposerSuggestionRange | null
      highlightedId: string | null
      view: ComposerSuggestionView
    }

export type ComposerSuggestionSelection =
  | { type: 'insert-context'; reference: ComposerContextReference }
  | { type: 'action'; run: () => void | Promise<void> }
  | { type: 'query-completion'; value: string }
  | { type: 'submenu'; submenuId: string }
  | {
      type: 'content'
      contentId: string
      placement: 'panel' | 'composer'
    }

export type ComposerSuggestionItem = {
  id: string
  kind: 'context' | 'command' | 'completion' | 'submenu'
  label: string
  description?: string
  icon?: ReactNode
  searchTerms?: string[]
  disabled?: boolean
  selection: ComposerSuggestionSelection
  submenus?: readonly ComposerSuggestionSubmenu[]
}

export type ComposerSuggestionSection = {
  id: string
  label?: string
  items: readonly ComposerSuggestionItem[]
  loading?: boolean
  error?: string
  onRetry?: () => void
  placeholder?: string
  showTitle?: boolean
  preFiltered?: boolean
}

/** Child result sets owned by the item that opens them. */
export type ComposerSuggestionSubmenu = {
  id: string
  sections: readonly ComposerSuggestionSection[]
}

export const closedComposerSuggestionSession: ComposerSuggestionSession = { open: false }
