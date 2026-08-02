import { describe, expect, it } from 'vitest'

import { searchComposerCommands } from './composerCommandSearch'
import type { ComposerCommandContext, ComposerCommandDescriptor } from './composerCommandTypes'

const context: ComposerCommandContext = {
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

describe('searchComposerCommands', () => {
  it('matches title, description, and aliases', () => {
    const commands = [
      command({ id: 'new-chat', title: 'New chat' }),
      command({ id: 'review', title: 'Code review', description: 'Inspect local git changes' }),
      command({ id: 'mcp', title: 'MCP', searchAliases: ['tool servers'] })
    ]

    expect(
      searchComposerCommands({ commands, context, query: 'new' }).map((entry) => entry.id)
    ).toEqual(['new-chat'])
    expect(
      searchComposerCommands({ commands, context, query: 'git' }).map((entry) => entry.id)
    ).toEqual(['review'])
    expect(
      searchComposerCommands({ commands, context, query: 'tool' }).map((entry) => entry.id)
    ).toEqual(['mcp'])
  })

  it('sorts by group, title, and stable input order after filtering', () => {
    const commands = [
      command({ id: 'second-beta', title: 'Beta', group: 'Review' }),
      command({ id: 'alpha', title: 'Alpha', group: 'Tools' }),
      command({ id: 'first-beta', title: 'Beta', group: 'Review' }),
      command({ id: 'disabled', title: 'Aardvark', group: 'Review', enabled: false })
    ]

    expect(
      searchComposerCommands({ commands, context, query: '' }).map((entry) => entry.id)
    ).toEqual(['second-beta', 'first-beta', 'alpha'])
  })

  it('keeps the first-seen group order, then ranks matches by score within each group', () => {
    const commands = [
      command({ id: 'review-long', title: 'Open existing review', group: 'Review' }),
      command({ id: 'review-exact', title: 'Open', group: 'Review' }),
      command({ id: 'tools-exact', title: 'Open', group: 'Tools' })
    ]

    expect(
      searchComposerCommands({ commands, context, query: 'open' }).map((entry) => entry.id)
    ).toEqual(['review-exact', 'review-long', 'tools-exact'])
  })
})
