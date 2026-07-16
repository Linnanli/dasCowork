/* eslint-disable react-refresh/only-export-components -- identity context and helpers share one boundary */

import type { Unstable_TriggerItem } from '@assistant-ui/react'
import { createContext, useContext, type PropsWithChildren, type ReactNode } from 'react'

import type { ComposerContextCatalogSectionState } from './useComposerContextCatalog'

export type ComposerContextIdentity = {
  type: 'app' | 'plugin'
  uri: string
  displayLabel: string
  mentionName?: string
}

export type ComposerContextIdentityIndex = ReadonlyMap<string, ComposerContextIdentity>

export const emptyComposerContextIdentityIndex: ComposerContextIdentityIndex = new Map()
const ComposerContextIdentityContext = createContext<ComposerContextIdentityIndex>(
  emptyComposerContextIdentityIndex
)

export function ComposerContextIdentityProvider({
  children,
  index
}: PropsWithChildren<{ index: ComposerContextIdentityIndex }>): ReactNode {
  return (
    <ComposerContextIdentityContext.Provider value={index}>
      {children}
    </ComposerContextIdentityContext.Provider>
  )
}

export function useComposerContextIdentityIndex(): ComposerContextIdentityIndex {
  return useContext(ComposerContextIdentityContext)
}

export function buildComposerContextIdentityIndex(
  sections: readonly ComposerContextCatalogSectionState[]
): ComposerContextIdentityIndex {
  const index = new Map<string, ComposerContextIdentity>()
  for (const section of sections) {
    for (const item of section.items) {
      const identity = composerContextIdentityFromTriggerItem(item)
      if (identity) index.set(identity.uri, identity)
    }
  }
  return index
}

export function composerContextIdentityFromTriggerItem(
  item: Unstable_TriggerItem
): ComposerContextIdentity | undefined {
  if (item.type !== 'app' && item.type !== 'plugin') return undefined
  const scheme = item.type === 'app' ? 'app://' : 'plugin://'
  if (!item.id.startsWith(scheme) || item.id.length === scheme.length) return undefined
  const mentionName = stringMetadata(item, 'mentionName')
  return {
    type: item.type,
    uri: item.id,
    displayLabel: item.label,
    ...(mentionName ? { mentionName } : {})
  }
}

function stringMetadata(item: Unstable_TriggerItem, key: string): string | undefined {
  const metadata = item.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
