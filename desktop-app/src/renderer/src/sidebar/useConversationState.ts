import { useCallback, useEffect, useState } from 'react'

import type {
  SidebarConversationActionPayload,
  SidebarConversationListState,
  SidebarConversationRenamePayload,
  SidebarPreferences
} from '../../../shared/codexIpcApi'

const initialConversationState: SidebarConversationListState = {
  conversations: [],
  archivedConversationIds: [],
  loaded: false
}

const defaultPreferences: SidebarPreferences = {
  organizeMode: 'project',
  sortKey: 'updated_at',
  collapsedSectionIds: [],
  collapsedGroupIds: []
}

export type ConversationStateController = {
  state: SidebarConversationListState
  preferences: SidebarPreferences
  refresh: () => Promise<void>
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
  archiveConversation: (input: SidebarConversationActionPayload) => Promise<void>
  unarchiveConversation: (input: SidebarConversationActionPayload) => Promise<void>
  renameConversation: (input: SidebarConversationRenamePayload) => Promise<void>
  interruptConversation: (input: SidebarConversationActionPayload) => Promise<void>
  setPreferences: (input: Partial<SidebarPreferences>) => Promise<void>
}

export function useConversationState({
  openConversation: openConversationInRuntime
}: {
  openConversation: (input: SidebarConversationActionPayload) => Promise<void>
}): ConversationStateController {
  const [state, setState] = useState<SidebarConversationListState>(initialConversationState)
  const [preferences, setPreferencesState] = useState<SidebarPreferences>(defaultPreferences)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.desktopApp.conversations.getConversationList(),
      window.desktopApp.conversations.getPreferences()
    ]).then(([nextState, nextPreferences]) => {
      if (cancelled) return
      setState(nextState)
      setPreferencesState(nextPreferences)
    })
    const removeListener = window.desktopApp.conversations.onConversationListChange((nextState) => {
      setState(nextState)
    })
    return () => {
      cancelled = true
      removeListener()
    }
  }, [])

  const refresh = useCallback(async () => {
    setState(await window.desktopApp.conversations.refreshConversationList())
  }, [])

  const openConversation = useCallback(
    async (input: SidebarConversationActionPayload) => {
      await openConversationInRuntime(input)
    },
    [openConversationInRuntime]
  )

  const archiveConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    setState(await window.desktopApp.conversations.archiveConversation(input))
  }, [])

  const unarchiveConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    setState(await window.desktopApp.conversations.unarchiveConversation(input))
  }, [])

  const renameConversation = useCallback(async (input: SidebarConversationRenamePayload) => {
    setState(await window.desktopApp.conversations.renameConversation(input))
  }, [])

  const interruptConversation = useCallback(async (input: SidebarConversationActionPayload) => {
    await window.desktopApp.conversations.interruptConversation(input)
  }, [])

  const setPreferences = useCallback(async (input: Partial<SidebarPreferences>) => {
    setPreferencesState(await window.desktopApp.conversations.setPreferences(input))
  }, [])

  return {
    state,
    preferences,
    refresh,
    openConversation,
    archiveConversation,
    unarchiveConversation,
    renameConversation,
    interruptConversation,
    setPreferences
  }
}
