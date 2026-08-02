import { describe, expect, it } from 'vitest'

import type { ComposerCommandContext, ComposerCommandDescriptor } from './composerCommandTypes'
import { buildComposerCommandSections } from './useComposerCommandSections'

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

describe('buildComposerCommandSections', () => {
  it('groups empty-query commands into sections and maps selection without changing it', () => {
    const reviewSelection = {
      type: 'content' as const,
      contentId: 'review',
      placement: 'composer' as const
    }
    const sections = buildComposerCommandSections({
      context,
      query: '',
      commands: [
        command({ id: 'mcp', title: 'MCP', group: 'Tools' }),
        command({ id: 'review', title: 'Code review', group: 'Review', selection: reviewSelection })
      ]
    })

    expect(sections.map((section) => [section.id, section.label, section.showTitle])).toEqual([
      ['Review', 'Review', true],
      ['Tools', 'Tools', true]
    ])
    expect(sections[0]?.items[0]).toMatchObject({
      id: 'review',
      kind: 'command',
      label: 'Code review',
      selection: reviewSelection
    })
  })

  it('uses a hidden-title search-results section for non-empty queries', () => {
    const sections = buildComposerCommandSections({
      context,
      query: 'server',
      commands: [
        command({ id: 'mcp', title: 'MCP', searchAliases: ['servers'] }),
        command({ id: 'review', title: 'Code review' })
      ]
    })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.id).toBe('command-search-results')
    expect(sections[0]?.showTitle).toBe(false)
    expect(sections[0]?.items.map((item) => item.id)).toEqual(['mcp'])
  })

  it('refreshes output when command context changes', () => {
    const commands = [
      command({ id: 'new-chat', title: 'New chat', requiresEmptyComposer: true }),
      command({ id: 'mcp', title: 'MCP' })
    ]

    expect(
      buildComposerCommandSections({ context, query: '', commands }).flatMap((section) =>
        section.items.map((item) => item.id)
      )
    ).toEqual(['mcp', 'new-chat'])
    expect(
      buildComposerCommandSections({
        context: { ...context, draftText: 'draft' },
        query: '',
        commands
      }).flatMap((section) => section.items.map((item) => item.id))
    ).toEqual(['mcp'])
  })
})
