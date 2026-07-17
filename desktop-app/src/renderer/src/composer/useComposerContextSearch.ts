import type { Unstable_TriggerItem } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  COMPOSER_CONTEXT_SEARCH_VERSION,
  type ComposerContextSearchSectionEvent
} from '../../../shared/codexIpcApi'
import type { ProjectSelection } from '../../../shared/projects/projectTypes'
import { composerContextReferenceToTriggerItem } from './useComposerContextCatalog'

type DynamicSectionState = {
  id: 'files' | 'tasks'
  items: readonly Unstable_TriggerItem[]
  error?: string
  loading: boolean
  complete: boolean
}

type ActiveSearchState = {
  scopeKey: string
  sessionId?: string
  sections: readonly DynamicSectionState[]
}

export type ComposerContextSearchState = {
  sections: readonly DynamicSectionState[]
  loading: boolean
}

export function useComposerContextSearch({
  cwd,
  enabled,
  excludedThreadIds,
  projectSelection,
  query,
  threadId
}: {
  cwd?: string
  enabled: boolean
  excludedThreadIds: readonly string[]
  projectSelection?: ProjectSelection
  query: string
  threadId?: string
}): ComposerContextSearchState {
  const [activeSearch, setActiveSearch] = useState<ActiveSearchState>()
  const sessionSequence = useRef(0)
  const currentQuery = useRef(query.trim())
  useEffect(() => {
    currentQuery.current = query.trim()
  }, [query])
  const excludedKey = JSON.stringify([...new Set(excludedThreadIds)].sort())
  const normalizedExcludedIds = useMemo(() => JSON.parse(excludedKey) as string[], [excludedKey])
  const scopeKey = JSON.stringify({ cwd, projectSelection, threadId })

  useEffect(() => {
    const sequence = ++sessionSequence.current
    if (!enabled) return undefined
    if (
      typeof window.desktopApp.composerContext.onSearchUpdate !== 'function' ||
      typeof window.desktopApp.composerContext.startSearch !== 'function'
    ) {
      return undefined
    }

    const scope = JSON.parse(scopeKey) as {
      cwd?: string
      projectSelection?: ProjectSelection
      threadId?: string
    }
    let activeSessionId: string | undefined
    const removeListener = window.desktopApp.composerContext.onSearchUpdate((event) => {
      if (
        sessionSequence.current !== sequence ||
        event.sessionId !== activeSessionId ||
        event.query !== currentQuery.current
      ) {
        return
      }
      setActiveSearch((current) =>
        current?.sessionId === event.sessionId
          ? { ...current, sections: updateSection(current.sections, event) }
          : current
      )
    })
    void window.desktopApp.composerContext
      .startSearch({
        version: COMPOSER_CONTEXT_SEARCH_VERSION,
        ...(scope.cwd ? { cwd: scope.cwd } : {}),
        ...(scope.threadId ? { threadId: scope.threadId } : {}),
        ...(scope.projectSelection ? { projectSelection: scope.projectSelection } : {})
      })
      .then((result) => {
        if (sessionSequence.current !== sequence) {
          void window.desktopApp.composerContext.stopSearch({
            version: COMPOSER_CONTEXT_SEARCH_VERSION,
            sessionId: result.sessionId
          })
          return
        }
        activeSessionId = result.sessionId
        setActiveSearch({
          scopeKey,
          sessionId: result.sessionId,
          sections: [
            section('files', !result.filesAvailable),
            section('tasks', !result.tasksAvailable)
          ]
        })
      })
      .catch((error) => {
        if (sessionSequence.current !== sequence) return
        const message = error instanceof Error ? error.message : String(error)
        setActiveSearch({
          scopeKey,
          sections: [
            { ...section('files', true), error: message },
            { ...section('tasks', true), error: message }
          ]
        })
      })

    return () => {
      removeListener()
      if (activeSessionId) {
        void window.desktopApp.composerContext.stopSearch({
          version: COMPOSER_CONTEXT_SEARCH_VERSION,
          sessionId: activeSessionId
        })
      }
    }
  }, [enabled, scopeKey])

  const sessionId = activeSearch?.scopeKey === scopeKey ? activeSearch.sessionId : undefined
  useEffect(() => {
    if (!enabled || !sessionId) return undefined
    const timeout = window.setTimeout(() => {
      void window.desktopApp.composerContext.updateSearch({
        version: COMPOSER_CONTEXT_SEARCH_VERSION,
        sessionId,
        query,
        excludedThreadIds: normalizedExcludedIds
      })
    }, 100)
    return () => window.clearTimeout(timeout)
  }, [enabled, excludedKey, normalizedExcludedIds, query, sessionId])

  const sections =
    enabled && activeSearch?.scopeKey === scopeKey ? activeSearch.sections : emptySections
  return {
    sections,
    loading: sections.some((dynamicSection) => dynamicSection.loading)
  }
}

const emptySections: readonly DynamicSectionState[] = [section('files'), section('tasks')]

function section(id: 'files' | 'tasks', unavailable = false): DynamicSectionState {
  return {
    id,
    items: [],
    loading: false,
    complete: unavailable
  }
}

function updateSection(
  sections: readonly DynamicSectionState[],
  event: ComposerContextSearchSectionEvent
): readonly DynamicSectionState[] {
  return sections.map((current) =>
    current.id === event.sectionId
      ? {
          id: current.id,
          items: event.items.map(composerContextReferenceToTriggerItem),
          loading: event.status === 'loading' || !event.complete,
          complete: event.complete,
          ...(event.error ? { error: event.error } : {})
        }
      : current
  )
}
