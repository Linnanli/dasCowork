import type { Unstable_TriggerItem } from '@assistant-ui/react'
import {
  BotIcon,
  FileIcon,
  FolderIcon,
  MessageSquareIcon,
  PackageIcon,
  PuzzleIcon,
  SparklesIcon,
  WrenchIcon
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { ComposerContextMenuSection } from '@/components/assistant-ui/composer-add-context-popover'

import type { ComposerContextReference } from '../../../shared/composerContext'
import type { ComposerSuggestionItem, ComposerSuggestionSection } from './composerSuggestionTypes'

const contextIcons: Record<string, ReactNode> = {
  folder: <FolderIcon className="size-4" />,
  chat: <MessageSquareIcon className="size-4" />,
  agent: <BotIcon className="size-4" />,
  agentRole: <BotIcon className="size-4" />,
  skill: <SparklesIcon className="size-4" />,
  plugin: <PuzzleIcon className="size-4" />,
  app: <PackageIcon className="size-4" />,
  tool: <WrenchIcon className="size-4" />
}

/** Adapts existing context catalog/search output into the shared list model. */
export function toContextSuggestionSections(
  sections: readonly ComposerContextMenuSection[],
  onInsertTriggerItem: (item: Unstable_TriggerItem) => void
): ComposerSuggestionSection[] {
  return sections.map((section) => ({
    id: `context:${section.id}`,
    label: section.label,
    loading: section.loading,
    error: section.error ?? undefined,
    onRetry: section.onRetry,
    placeholder: section.placeholder,
    preFiltered: section.preFiltered,
    showTitle: section.showTitle,
    items: section.items.flatMap((item) => {
      const reference = referenceFromTriggerItem(item)
      return reference
        ? [toContextSuggestionItem(section.id, item, reference)]
        : [toModelToolSuggestionItem(section.id, item, onInsertTriggerItem)]
    })
  }))
}

function toModelToolSuggestionItem(
  sectionId: string,
  item: Unstable_TriggerItem,
  onInsertTriggerItem: (item: Unstable_TriggerItem) => void
): ComposerSuggestionItem {
  return {
    id: `context:${sectionId}:${item.type}:${item.id}`,
    kind: 'context',
    label: item.label,
    description: item.description,
    icon: contextIcons[item.type] ?? <FileIcon className="size-4" />,
    searchTerms: [item.id, item.label, item.description].filter(
      (value): value is string => typeof value === 'string'
    ),
    selection: { type: 'action', run: () => onInsertTriggerItem(item) }
  }
}

function toContextSuggestionItem(
  sectionId: string,
  item: Unstable_TriggerItem,
  reference: ComposerContextReference
): ComposerSuggestionItem {
  return {
    id: `context:${sectionId}:${reference.canonicalId}`,
    kind: 'context',
    label: item.label,
    description: item.description,
    icon: contextIcons[item.type] ?? <FileIcon className="size-4" />,
    searchTerms: [item.id, item.label, item.description].filter(
      (value): value is string => typeof value === 'string'
    ),
    selection: { type: 'insert-context', reference }
  }
}

function referenceFromTriggerItem(
  item: Unstable_TriggerItem
): ComposerContextReference | undefined {
  const metadata = item.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const reference = (metadata as Record<string, unknown>).reference
  return reference && typeof reference === 'object'
    ? (reference as ComposerContextReference)
    : undefined
}
