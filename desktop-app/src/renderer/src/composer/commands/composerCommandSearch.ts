import { createComposerFuzzyScorer } from '../composerFuzzySearch'
import type { ComposerCommandContext, ComposerCommandDescriptor } from './composerCommandTypes'
import { commandIsAvailable } from './composerCommandRegistry'

type CommandSearchCandidate = {
  command: ComposerCommandDescriptor
  score: number
  order: number
}

export function searchComposerCommands({
  commands,
  context,
  query
}: {
  commands: readonly ComposerCommandDescriptor[]
  context: ComposerCommandContext
  query: string
}): ComposerCommandDescriptor[] {
  const available = commands.filter((command) => commandIsAvailable(command, context))
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return sortCommands(available)

  const groupOrder = firstGroupIndexes(available)
  return scoredCommands(available, normalizedQuery)
    .sort((left, right) => {
      const groupDelta =
        groupOrder.get(commandGroup(left.command))! - groupOrder.get(commandGroup(right.command))!
      if (groupDelta !== 0) return groupDelta

      const scoreDelta = right.score - left.score
      if (scoreDelta !== 0) return scoreDelta

      const titleDelta = left.command.title.localeCompare(right.command.title)
      if (titleDelta !== 0) return titleDelta
      return left.order - right.order
    })
    .map((candidate) => candidate.command)
}

function scoredCommands(
  commands: readonly ComposerCommandDescriptor[],
  query: string
): CommandSearchCandidate[] {
  const scorer = createComposerFuzzyScorer(query)
  return commands.flatMap((command, order) => {
    const score = Math.max(...commandSearchFields(command).map((field) => scorer(field)))
    return score === 0 ? [] : [{ command, score, order }]
  })
}

export function commandSearchFields(command: ComposerCommandDescriptor): string[] {
  return unique([command.title, command.description, ...(command.searchAliases ?? [])])
}

export function commandGroup(command: ComposerCommandDescriptor): string {
  return command.group?.trim() || ''
}

function sortCommands(commands: readonly ComposerCommandDescriptor[]): ComposerCommandDescriptor[] {
  return commands.toSorted((left, right) => {
    const groupDelta = commandGroup(left).localeCompare(commandGroup(right))
    if (groupDelta !== 0) return groupDelta

    return left.title.localeCompare(right.title)
  })
}

function firstGroupIndexes(commands: readonly ComposerCommandDescriptor[]): Map<string, number> {
  const groupOrder = new Map<string, number>()
  for (const command of commands) {
    const group = commandGroup(command)
    if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size)
  }
  return groupOrder
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))
  ]
}
