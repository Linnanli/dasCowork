import type { Unstable_TriggerItem } from '@assistant-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  COMPOSER_CONTEXT_CATALOG_VERSION,
  type ComposerContextCatalogChangeEvent,
  type ComposerContextCatalogRequest,
  type ComposerContextReference,
  type ComposerContextSection,
  type ComposerContextSectionId
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'

export type ComposerContextCatalogSectionState = {
  id: ComposerContextSectionId
  items: readonly Unstable_TriggerItem[]
  error?: string
}

type UseComposerContextCatalogOptions = {
  cwd?: string
  enabled: boolean
  projectSelection?: ProjectSelection
  threadId?: string
}

type ComposerContextCatalogState = {
  sections: readonly ComposerContextCatalogSectionState[]
  loading: boolean
  query: string
  refresh(sectionId?: ComposerContextSectionId): void
  setQuery(query: string): void
}

type CatalogLoadState = {
  requestKey: string
  sections: readonly ComposerContextCatalogSectionState[]
}

const catalogSectionOrder: readonly ComposerContextSectionId[] = [
  'files',
  'chats',
  'agents',
  'skills',
  'plugins',
  'apps'
]

const emptyCatalogSections = catalogSectionOrder.map((id) => ({ id, items: [] }))

export function useComposerContextCatalog({
  cwd,
  enabled,
  projectSelection,
  threadId
}: UseComposerContextCatalogOptions): ComposerContextCatalogState {
  const [query, setQuery] = useState('')
  const [loadState, setLoadState] = useState<CatalogLoadState | null>(null)
  const [refreshRequest, setRefreshRequest] = useState<{
    revision: number
    sectionId?: ComposerContextSectionId
  }>({ revision: 0 })
  const [changeRevision, setChangeRevision] = useState(0)
  const consumedRefreshRevision = useRef(0)
  const requestSequence = useRef(0)
  const request = useMemo<ComposerContextCatalogRequest>(
    () => ({
      version: COMPOSER_CONTEXT_CATALOG_VERSION,
      query,
      limit: 40,
      ...(cwd ? { cwd } : {}),
      ...(threadId ? { threadId } : {}),
      ...(projectSelection ? { projectSelection } : {})
    }),
    [cwd, projectSelection, query, threadId]
  )
  const requestKey = JSON.stringify(request)

  useEffect(() => {
    if (!enabled) return
    return window.desktopApp.composerContext.onDidChange((event) => {
      if (composerContextChangeMatchesRequest(event, request)) {
        setChangeRevision((revision) => revision + 1)
      }
    })
  }, [enabled, request])

  useEffect(() => {
    const sequence = ++requestSequence.current
    if (!enabled) return

    const shouldRefresh = refreshRequest.revision > consumedRefreshRevision.current
    consumedRefreshRevision.current = refreshRequest.revision
    const load = shouldRefresh
      ? window.desktopApp.composerContext.refresh(request, {
          sectionIds: refreshRequest.sectionId
            ? [refreshRequest.sectionId]
            : [...catalogSectionOrder]
        })
      : window.desktopApp.composerContext.list(request)

    void load
      .then((result) => {
        if (requestSequence.current !== sequence) return
        setLoadState({
          requestKey,
          sections: catalogSectionOrder.map((id) =>
            mapCatalogSection(
              result.sections.find((section) => section.id === id) ?? missingSection(id)
            )
          )
        })
      })
      .catch((error) => {
        if (requestSequence.current !== sequence) return
        const message = error instanceof Error ? error.message : String(error)
        setLoadState({
          requestKey,
          sections: catalogSectionOrder.map((id) => ({ id, items: [], error: message }))
        })
      })
  }, [changeRevision, enabled, refreshRequest, request, requestKey])

  const refresh = useCallback((sectionId?: ComposerContextSectionId) => {
    setRefreshRequest((current) => ({ revision: current.revision + 1, sectionId }))
  }, [])
  const hasCurrentResult = enabled && loadState?.requestKey === requestKey

  return {
    sections: hasCurrentResult ? loadState.sections : emptyCatalogSections,
    loading: enabled && !hasCurrentResult,
    query,
    refresh,
    setQuery
  }
}

export function composerContextChangeMatchesRequest(
  event: ComposerContextCatalogChangeEvent,
  request: ComposerContextCatalogRequest
): boolean {
  const scope = event.scope
  if (!scope) return true
  const hostId =
    request.projectSelection?.projectKind === 'remote' ? request.projectSelection.hostId : 'local'
  if (scope.hostId && scope.hostId !== hostId) return false
  if (scope.cwd && scope.cwd !== request.cwd) return false
  if (scope.threadId && scope.threadId !== request.threadId) return false
  return true
}

export function composerContextReferenceToTriggerItem(
  reference: ComposerContextReference
): Unstable_TriggerItem {
  switch (reference.kind) {
    case 'file':
    case 'folder':
      return triggerItem(reference, reference.kind, reference.path, relativePath(reference))
    case 'chat':
      return triggerItem(reference, 'chat', reference.uri, reference.cwd ?? reference.description)
    case 'liveAgent':
      return triggerItem(
        reference,
        'agent',
        reference.uri,
        reference.description ?? agentStatusLabel(reference.status)
      )
    case 'configuredAgent':
      return triggerItem(reference, 'agentRole', reference.uri, reference.description)
    case 'skill':
      return triggerItem(reference, 'skill', reference.path, reference.description)
    case 'plugin':
      return triggerItem(reference, 'plugin', reference.uri, reference.description)
    case 'app':
      return triggerItem(reference, 'app', reference.uri, reference.description)
  }
}

function mapCatalogSection(section: ComposerContextSection): ComposerContextCatalogSectionState {
  return {
    id: section.id,
    items: section.items.map(composerContextReferenceToTriggerItem),
    ...(section.error ? { error: section.error } : {})
  }
}

function missingSection(id: ComposerContextSectionId): ComposerContextSection {
  return { id, status: 'error', items: [], error: `${id} catalog is unavailable` }
}

function triggerItem(
  reference: ComposerContextReference,
  type: string,
  id: string,
  description: string | undefined
): Unstable_TriggerItem {
  return {
    id,
    type,
    label: reference.label,
    ...(description ? { description } : {}),
    metadata: { canonicalId: reference.canonicalId, kind: reference.kind }
  }
}

function relativePath(
  reference: Extract<ComposerContextReference, { kind: 'file' | 'folder' }>
): string {
  if (!reference.root) return reference.path
  const prefix = reference.root.endsWith('/') ? reference.root : `${reference.root}/`
  return reference.path.startsWith(prefix) ? reference.path.slice(prefix.length) : reference.path
}

function agentStatusLabel(
  status: Extract<ComposerContextReference, { kind: 'liveAgent' }>['status']
): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'interrupted':
      return '已中断'
  }
}
