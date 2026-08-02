/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from 'react'

import type {
  ComposerCommandContext,
  ComposerCommandDescriptor,
  ComposerCommandRegistration,
  ComposerCommandToken,
  ComposerSuggestionSelection
} from './composerCommandTypes'

type CommandEntry = {
  command: ComposerCommandDescriptor
  token: ComposerCommandToken
  order: number
}

export type ComposerCommandRegistrySnapshot = {
  version: number
  entries: readonly CommandEntry[]
}

export type ComposerCommandRegistry = {
  register: (command: ComposerCommandDescriptor) => ComposerCommandRegistration
  getSnapshot: () => ComposerCommandRegistrySnapshot
  subscribe: (listener: () => void) => () => void
  getAvailableCommands: (context: ComposerCommandContext) => ComposerCommandDescriptor[]
  getAvailableCommandSelection: (
    id: string,
    context: ComposerCommandContext
  ) => ComposerSuggestionSelection | undefined
}

let nextRegistryId = 0

export function createComposerCommandRegistry(): ComposerCommandRegistry {
  let nextOrder = 0
  let version = 0
  let snapshot: ComposerCommandRegistrySnapshot = { version, entries: [] }
  const entries = new Map<string, CommandEntry>()
  const listeners = new Set<() => void>()
  const rebuildSnapshot = (): void => {
    snapshot = {
      version,
      entries: [...entries.values()].sort((left, right) => left.order - right.order)
    }
  }
  const notify = (): void => {
    version += 1
    rebuildSnapshot()
    for (const listener of listeners) listener()
  }

  const register = (command: ComposerCommandDescriptor): ComposerCommandRegistration => {
    const token = `composer-command-${nextRegistryId++}`
    entries.set(command.id, { command, token, order: nextOrder++ })
    notify()

    return {
      token,
      update: (nextCommand) => {
        const current = entries.get(command.id)
        if (!current || current.token !== token) return false
        if (nextCommand.id !== command.id) return false
        entries.set(command.id, { command: nextCommand, token, order: current.order })
        notify()
        return true
      },
      unregister: () => {
        const current = entries.get(command.id)
        if (!current || current.token !== token) return false
        entries.delete(command.id)
        notify()
        return true
      }
    }
  }

  const getSnapshot = (): ComposerCommandRegistrySnapshot => snapshot

  const getAvailableCommands = (context: ComposerCommandContext): ComposerCommandDescriptor[] =>
    getSnapshot()
      .entries.map((entry) => entry.command)
      .filter((command) => commandIsAvailable(command, context))

  return {
    register,
    getSnapshot,
    subscribe: (listener): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getAvailableCommands,
    getAvailableCommandSelection: (id, context) =>
      getAvailableCommands(context).find((command) => command.id === id)?.selection
  }
}

export function commandIsAvailable(
  command: ComposerCommandDescriptor,
  context: ComposerCommandContext
): boolean {
  if (command.enabled === false) return false
  if (!command.triggers.includes('/')) return false
  return !command.requiresEmptyComposer || composerIsEmpty(context)
}

function composerIsEmpty(context: ComposerCommandContext): boolean {
  return context.draftText.trim().length === 0 && !context.hasAttachments
}

const ComposerCommandRegistryContext = createContext<ComposerCommandRegistry | null>(null)

export function ComposerCommandRegistryProvider({
  children,
  registry
}: {
  children: ReactNode
  registry?: ComposerCommandRegistry
}): ReactNode {
  const fallbackRegistry = useMemo(() => createComposerCommandRegistry(), [])
  return (
    <ComposerCommandRegistryContext.Provider value={registry ?? fallbackRegistry}>
      {children}
    </ComposerCommandRegistryContext.Provider>
  )
}

export function useComposerCommandRegistry(): ComposerCommandRegistry {
  const registry = useContext(ComposerCommandRegistryContext)
  if (!registry) {
    throw new Error(
      'useComposerCommandRegistry must be used within ComposerCommandRegistryProvider'
    )
  }
  return registry
}

export function useComposerCommandRegistrySnapshot(): ComposerCommandRegistrySnapshot {
  const registry = useComposerCommandRegistry()
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
}

export function useRegisterComposerCommand(command: ComposerCommandDescriptor): void {
  const registry = useComposerCommandRegistry()
  const registrationRef = useRef<ComposerCommandRegistration | null>(null)

  useEffect(() => {
    registrationRef.current = registry.register(command)

    return () => {
      registrationRef.current?.unregister()
      registrationRef.current = null
    }
    // Command prop changes update through the owner token below without adding duplicate entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry])

  useEffect(() => {
    registrationRef.current?.update(command)
  }, [command])
}
