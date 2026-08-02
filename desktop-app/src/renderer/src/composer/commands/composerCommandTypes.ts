import type {
  ComposerSuggestionSelection as SuggestionSelection,
  ComposerSuggestionSubmenu
} from '../composerSuggestionTypes'

export type {
  ComposerSuggestionItem,
  ComposerSuggestionSection,
  ComposerSuggestionSelection,
  ComposerSuggestionSubmenu
} from '../composerSuggestionTypes'

export type ComposerCommandTrigger = '/'

export type ComposerCommandContext = {
  draftText: string
  hasAttachments: boolean
  isRunning: boolean
  isEditing: boolean
  activeContentId: string | null
  hasProject: boolean
  hasGitReviewTarget: boolean
}

export type ComposerCommandDescriptor = {
  id: string
  title: string
  description?: string
  group?: string
  searchAliases?: string[]
  triggers: ComposerCommandTrigger[]
  requiresEmptyComposer?: boolean
  enabled?: boolean
  selection: SuggestionSelection
  submenus?: readonly ComposerSuggestionSubmenu[]
}

export type ComposerCommandToken = string

export type ComposerCommandRegistration = {
  token: ComposerCommandToken
  update: (command: ComposerCommandDescriptor) => boolean
  unregister: () => boolean
}
