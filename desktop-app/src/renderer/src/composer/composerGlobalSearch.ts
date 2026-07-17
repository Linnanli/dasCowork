import type { Unstable_TriggerItem } from '@assistant-ui/react'

import type { ComposerContextReference } from '../../../shared/codexIpcApi'
import type { ComposerContextMenuSection } from '../components/assistant-ui/composer-add-context-popover'
import { createComposerFuzzyScorer, type ComposerFuzzyScorer } from './composerFuzzySearch'

type SearchSource = 'files' | 'tasks' | 'agents' | 'skills' | 'plugins' | 'apps'

type Candidate = {
  source: SearchSource
  item: Unstable_TriggerItem
  label: string
  searchTerms: string[]
  sourceIndex: number
  canonicalId: string
}

const sourceOrder: readonly SearchSource[] = [
  'agents',
  'skills',
  'plugins',
  'apps',
  'files',
  'tasks'
]

export function buildComposerGlobalSearchResult({
  sourceErrors,
  warnings = [],
  loading,
  query,
  sections,
  limit = 8
}: {
  sourceErrors: readonly string[]
  warnings?: readonly string[]
  loading: boolean
  query: string
  sections: readonly { id: string; items: readonly Unstable_TriggerItem[] }[]
  limit?: number
}): ComposerContextMenuSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const scorer = createComposerFuzzyScorer(query)

  const seen = new Set<string>()
  const candidates = sourceOrder.flatMap((source, sourceOrderIndex) => {
    const section = sections.find((candidate) => candidate.id === source)
    return (section?.items ?? []).flatMap((item, itemIndex) => {
      const candidate = candidateFromItem(source, item, sourceOrderIndex * 10_000 + itemIndex)
      if (!candidate || seen.has(candidate.canonicalId)) return []
      seen.add(candidate.canonicalId)
      if (!passesSourceSpecificFilter(candidate, normalizedQuery)) return []
      const score = candidateScore(candidate, scorer)
      return score === 0 ? [] : [{ candidate, score }]
    })
  })
  const items = candidates
    .sort((left, right) => {
      const priorityDelta =
        sourcePriority(left.candidate, normalizedQuery) -
        sourcePriority(right.candidate, normalizedQuery)
      if (priorityDelta !== 0) return priorityDelta
      const scoreDelta = right.score - left.score
      return scoreDelta !== 0
        ? scoreDelta
        : left.candidate.sourceIndex - right.candidate.sourceIndex
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate.item)
  const visibleSourceErrors = items.length === 0 && !loading ? sourceErrors : []
  const visibleMessages = [...new Set([...warnings, ...visibleSourceErrors])]

  return [
    {
      id: 'search-results',
      label: '搜索结果',
      items,
      preFiltered: true,
      showTitle: false,
      loading: items.length === 0 && loading,
      ...(visibleMessages.length > 0 ? { error: visibleMessages.join('；') } : {})
    }
  ]
}

function candidateFromItem(
  source: SearchSource,
  item: Unstable_TriggerItem,
  sourceIndex: number
): Candidate | undefined {
  const reference = referenceFromItem(item)
  if (!reference) return undefined
  return {
    source,
    item,
    label: item.label,
    searchTerms: searchTerms(reference),
    sourceIndex,
    canonicalId: reference.canonicalId
  }
}

function referenceFromItem(item: Unstable_TriggerItem): ComposerContextReference | undefined {
  const metadata = item.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const reference = (metadata as Record<string, unknown>).reference
  return reference && typeof reference === 'object'
    ? (reference as ComposerContextReference)
    : undefined
}

function searchTerms(reference: ComposerContextReference): string[] {
  switch (reference.kind) {
    case 'file':
    case 'folder':
      return unique([reference.path])
    case 'chat':
      return unique([
        reference.searchTitle,
        reference.gitBranch,
        reference.cwd ?? undefined,
        reference.snippet
      ])
    case 'liveAgent':
      return unique([`@${reference.label}`, reference.description, reference.status])
    case 'configuredAgent':
      return unique([
        reference.roleName,
        `@${reference.roleName}`,
        reference.description,
        ...(reference.nicknameCandidates ?? [])
      ])
    case 'skill':
      return unique([reference.name, reference.label, `@${reference.label}`])
    case 'plugin':
      return unique([
        reference.label,
        reference.mentionName,
        `@${reference.label}`,
        reference.mentionName ? `@${reference.mentionName}` : undefined
      ])
    case 'app':
      return unique([
        reference.label,
        reference.mentionName,
        reference.mentionName ? `@${reference.mentionName}` : undefined,
        ...(reference.pluginDisplayNames ?? [])
      ])
  }
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))
  ]
}

function candidateScore(candidate: Candidate, scorer: ComposerFuzzyScorer): number {
  return Math.max(scorer(candidate.label), ...candidate.searchTerms.map((term) => scorer(term)))
}

function passesSourceSpecificFilter(candidate: Candidate, query: string): boolean {
  if (candidate.source !== 'skills') return true
  return [candidate.label, ...candidate.searchTerms].some((value) =>
    value.toLocaleLowerCase().includes(query)
  )
}

function sourcePriority(candidate: Candidate, query: string): number {
  if (candidate.source === 'plugins' && hasPrefixMatch(candidate, query)) return 0
  return candidate.source === 'files' || candidate.source === 'tasks' ? 3 : 2
}

function hasPrefixMatch(candidate: Candidate, query: string): boolean {
  return [candidate.label, ...candidate.searchTerms].some((value) =>
    value.toLocaleLowerCase().startsWith(query)
  )
}
