import { useMemo } from 'react'

import type {
  ComposerCommandContext,
  ComposerCommandDescriptor,
  ComposerSuggestionItem,
  ComposerSuggestionSection
} from './composerCommandTypes'
import { commandGroup, commandSearchFields, searchComposerCommands } from './composerCommandSearch'
import { useComposerCommandRegistrySnapshot } from './composerCommandRegistry'

export function useComposerCommandSections({
  context,
  query
}: {
  context: ComposerCommandContext
  query: string
}): ComposerSuggestionSection[] {
  const snapshot = useComposerCommandRegistrySnapshot()
  return useMemo(
    () =>
      buildComposerCommandSections({
        commands: snapshot.entries.map((entry) => entry.command),
        context,
        query
      }),
    [context, query, snapshot]
  )
}

export function buildComposerCommandSections({
  commands,
  context,
  query
}: {
  commands: readonly ComposerCommandDescriptor[]
  context: ComposerCommandContext
  query: string
}): ComposerSuggestionSection[] {
  const sortedCommands = searchComposerCommands({ commands, context, query })
  const normalizedQuery = query.trim()
  if (normalizedQuery) {
    return [
      {
        id: 'command-search-results',
        showTitle: false,
        items: sortedCommands.map(commandToSuggestionItem)
      }
    ]
  }

  const sections = new Map<string, ComposerSuggestionItem[]>()
  for (const command of sortedCommands) {
    const group = commandGroup(command)
    const sectionId = group || 'commands'
    sections.set(sectionId, [...(sections.get(sectionId) ?? []), commandToSuggestionItem(command)])
  }

  return [...sections.entries()].map(([id, items]) => ({
    id,
    label: id === 'commands' ? undefined : id,
    showTitle: id !== 'commands',
    items
  }))
}

function commandToSuggestionItem(command: ComposerCommandDescriptor): ComposerSuggestionItem {
  return {
    id: command.id,
    kind: 'command',
    label: command.title,
    description: command.description,
    searchTerms: commandSearchFields(command),
    selection: command.selection,
    submenus: command.submenus
  }
}
