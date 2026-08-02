import { describe, expect, it } from 'vitest'

import { createComposerCommandRegistry } from './composerCommandRegistry'
import type { ComposerCommandContext, ComposerCommandDescriptor } from './composerCommandTypes'

const emptyContext: ComposerCommandContext = {
  draftText: '',
  hasAttachments: false,
  isRunning: false,
  isEditing: false,
  activeContentId: null,
  hasProject: true,
  hasGitReviewTarget: true
}

function command(
  overrides: Partial<ComposerCommandDescriptor> & Pick<ComposerCommandDescriptor, 'id' | 'title'>
): ComposerCommandDescriptor {
  return {
    triggers: ['/'],
    selection: { type: 'action', run: () => undefined },
    ...overrides
  }
}

describe('createComposerCommandRegistry', () => {
  it('updates through the owner token and unregisters only the current owner', () => {
    const registry = createComposerCommandRegistry()
    const first = registry.register(command({ id: 'review', title: 'Code review' }))

    expect(first.token).toMatch(/^composer-command-/)
    expect(first.update(command({ id: 'review', title: 'Review current changes' }))).toBe(true)
    expect(registry.getAvailableCommands(emptyContext).map((entry) => entry.title)).toEqual([
      'Review current changes'
    ])

    const replacement = registry.register(command({ id: 'review', title: 'Replacement review' }))

    expect(first.update(command({ id: 'review', title: 'Stale update' }))).toBe(false)
    expect(first.unregister()).toBe(false)
    expect(registry.getAvailableCommands(emptyContext).map((entry) => entry.title)).toEqual([
      'Replacement review'
    ])

    expect(replacement.unregister()).toBe(true)
    expect(registry.getAvailableCommands(emptyContext)).toEqual([])
  })

  it('does not restore an older same-id command after the replacement unregisters', () => {
    const registry = createComposerCommandRegistry()
    registry.register(command({ id: 'mcp', title: 'MCP original' }))
    const replacement = registry.register(command({ id: 'mcp', title: 'MCP replacement' }))

    replacement.unregister()

    expect(registry.getAvailableCommands(emptyContext)).toEqual([])
  })

  it('filters disabled commands and commands that require an empty composer', () => {
    const registry = createComposerCommandRegistry()
    registry.register(command({ id: 'new-chat', title: 'New chat', requiresEmptyComposer: true }))
    registry.register(command({ id: 'mcp', title: 'MCP' }))
    registry.register(command({ id: 'hidden', title: 'Hidden', enabled: false }))

    expect(
      registry
        .getAvailableCommands({ ...emptyContext, draftText: 'draft' })
        .map((entry) => entry.id)
    ).toEqual(['mcp'])
    expect(
      registry
        .getAvailableCommands({ ...emptyContext, hasAttachments: true })
        .map((entry) => entry.id)
    ).toEqual(['mcp'])
    expect(registry.getAvailableCommands(emptyContext).map((entry) => entry.id)).toEqual([
      'new-chat',
      'mcp'
    ])
  })

  it('does not resolve selection for a command that is no longer available', () => {
    const registry = createComposerCommandRegistry()
    const registration = registry.register(
      command({
        id: 'review',
        title: 'Code review',
        selection: { type: 'content', contentId: 'review', placement: 'composer' }
      })
    )

    expect(registry.getAvailableCommandSelection('review', emptyContext)).toEqual({
      type: 'content',
      contentId: 'review',
      placement: 'composer'
    })

    registration.update(command({ id: 'review', title: 'Code review', enabled: false }))

    expect(registry.getAvailableCommandSelection('review', emptyContext)).toBeUndefined()
  })
})
