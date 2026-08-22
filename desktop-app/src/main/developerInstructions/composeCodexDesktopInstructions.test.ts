import { describe, expect, it } from 'vitest'

import {
  composeCodexDesktopInstructions,
  type CodexDesktopInstructionCapabilities
} from './composeCodexDesktopInstructions'

function appContextCount(value: string | undefined): number {
  return value?.match(/<app-context>/gu)?.length ?? 0
}

describe('composeCodexDesktopInstructions', () => {
  it('adds the desktop and inline-comment sections after existing instructions in a stable order', () => {
    const result = composeCodexDesktopInstructions({ system: 'Keep existing instructions.' })

    expect(result).toEqual({
      instructions: expect.stringContaining('Keep existing instructions.\n\n<app-context>'),
      includedSectionIds: ['desktop_context', 'inline_code_comments']
    })
    expect(result.instructions).toMatch(
      /# DasCowork desktop context[\s\S]*### Inline Code Comments/u
    )
    expect(result.instructions).not.toContain('load_workspace_dependencies')
    expect(result.instructions).not.toContain('automation_update')
    expect(result.instructions).not.toContain(':::writing')
    expect(result.instructions).not.toContain('::git-')
    expect(result.instructions).not.toContain('<heartbeat>')
  })

  it('does not duplicate an app-context during retries or active-turn recovery', () => {
    const first = composeCodexDesktopInstructions({ system: 'Keep existing instructions.' })
    const second = composeCodexDesktopInstructions({ system: first.instructions })

    expect(second).toEqual(first)
    expect(appContextCount(second.instructions)).toBe(1)
  })

  it('preserves an existing foreign app-context and merges missing desktop sections into it', () => {
    const result = composeCodexDesktopInstructions({
      system: [
        'Keep the base instructions.',
        '<app-context>\n### Existing host context\n- Preserve this section.\n</app-context>',
        'Keep the trailing instructions.'
      ].join('\n\n')
    })

    expect(appContextCount(result.instructions)).toBe(1)
    expect(result.instructions).toContain('### Existing host context')
    expect(result.instructions).toContain('- Preserve this section.')
    expect(result.instructions).toContain('# DasCowork desktop context')
    expect(result.instructions).toContain('### Inline Code Comments')
    expect(result.instructions).toContain('Keep the base instructions.')
    expect(result.instructions).toContain('Keep the trailing instructions.')
    expect(result.includedSectionIds).toEqual(['desktop_context', 'inline_code_comments'])
  })

  it('merges newly eligible sections into an existing desktop app-context', () => {
    const first = composeCodexDesktopInstructions({})
    const second = composeCodexDesktopInstructions({
      system: first.instructions,
      projectAssignment: {
        projectKind: 'projectless',
        cwd: '/tmp/dascowork/work',
        workspaceRoot: '/tmp/dascowork',
        outputDirectory: '/tmp/dascowork/out'
      }
    })

    expect(appContextCount(second.instructions)).toBe(1)
    expect(second.includedSectionIds).toEqual([
      'desktop_context',
      'inline_code_comments',
      'projectless'
    ])
    expect(second.instructions).toContain('### Projectless Chat')
  })

  it('consolidates repeated app-context blocks without losing their contents', () => {
    const result = composeCodexDesktopInstructions({
      system: [
        '<app-context>\n### First host context\n</app-context>',
        '<app-context>\n### Second host context\n</app-context>'
      ].join('\n\n')
    })

    expect(appContextCount(result.instructions)).toBe(1)
    expect(result.instructions).toContain('### First host context')
    expect(result.instructions).toContain('### Second host context')
    expect(result.instructions).toContain('# DasCowork desktop context')
    expect(result.instructions).toContain('### Inline Code Comments')
  })

  it('does not add an empty separator when no existing system instructions are present', () => {
    const result = composeCodexDesktopInstructions({ system: '   ' })

    expect(result.instructions).toMatch(/^<app-context>\n# DasCowork desktop context/u)
    expect(result.instructions).not.toMatch(/^\n/u)
  })

  it('adds projectless paths only from a complete absolute main-process assignment', () => {
    const result = composeCodexDesktopInstructions({
      projectAssignment: {
        projectKind: 'projectless',
        cwd: '/tmp/dascowork/work',
        workspaceRoot: '/tmp/dascowork',
        outputDirectory: '/tmp/dascowork/out'
      }
    })

    expect(result.includedSectionIds).toEqual([
      'desktop_context',
      'inline_code_comments',
      'projectless'
    ])
    expect(result.instructions).toContain('Workspace root: /tmp/dascowork.')
    expect(result.instructions).toContain('Working directory: /tmp/dascowork/work.')
    expect(result.instructions).toContain('deliverables directory: /tmp/dascowork/out.')

    const incomplete = composeCodexDesktopInstructions({
      projectAssignment: {
        projectKind: 'projectless',
        cwd: '/tmp/dascowork/work',
        workspaceRoot: '/tmp/dascowork',
        outputDirectory: 'out'
      }
    })
    expect(incomplete.includedSectionIds).not.toContain('projectless')
    expect(incomplete.instructions).not.toContain('### Projectless Chat')
  })

  it('enables each deferred section only when its prerequisite capability is confirmed', () => {
    const capabilities: CodexDesktopInstructionCapabilities = {
      workspaceDependencies: true,
      threadCoordination: true,
      nonTechnicalUi: true,
      heartbeat: true,
      git: true,
      writingBlocks: true
    }
    const result = composeCodexDesktopInstructions({
      capabilities,
      availableToolNames: ['automation_update', 'set_thread_archived']
    })

    expect(result.includedSectionIds).toEqual([
      'desktop_context',
      'workspace_dependencies',
      'automations',
      'thread_coordination',
      'non_technical_ui',
      'inline_code_comments',
      'heartbeat',
      'git',
      'writing_blocks'
    ])
    expect(result.instructions).toContain('load_workspace_dependencies')
    expect(result.instructions).toContain('automation_update')
    expect(result.instructions).toContain('::created-thread')
    expect(result.instructions).toContain('non-technical interface')
    expect(result.instructions).toContain('<heartbeat>')
    expect(result.instructions).toContain('::git-*')
    expect(result.instructions).toContain(':::writing')
    expect(result.instructions).not.toContain('### Projectless Chat')
  })

  it.each([
    {
      availableToolNames: ['automation_update'],
      included: 'automation_update',
      excluded: 'set_thread_archived'
    },
    {
      availableToolNames: ['set_thread_archived'],
      included: 'set_thread_archived',
      excluded: 'automation_update'
    }
  ])(
    'includes only the automation sentence whose tool is available: $included',
    ({ availableToolNames, included, excluded }) => {
      const result = composeCodexDesktopInstructions({ availableToolNames })

      expect(result.includedSectionIds).toContain('automations')
      expect(result.instructions).toContain('### Automations')
      expect(result.instructions).toContain(included)
      expect(result.instructions).not.toContain(excluded)
    }
  )

  it('merges newly available automation tool instructions into the existing section', () => {
    const first = composeCodexDesktopInstructions({
      availableToolNames: ['automation_update']
    })
    const second = composeCodexDesktopInstructions({
      system: first.instructions,
      availableToolNames: ['automation_update', 'set_thread_archived']
    })
    const third = composeCodexDesktopInstructions({
      system: second.instructions,
      availableToolNames: ['automation_update', 'set_thread_archived']
    })

    expect(second.instructions?.match(/### Automations/gu)).toHaveLength(1)
    expect(second.instructions?.match(/automation_update/gu)).toHaveLength(1)
    expect(second.instructions?.match(/set_thread_archived/gu)).toHaveLength(1)
    expect(third).toEqual(second)
  })

  it('omits the automations section when neither automation tool is available', () => {
    const result = composeCodexDesktopInstructions({})

    expect(result.includedSectionIds).not.toContain('automations')
    expect(result.instructions).not.toContain('### Automations')
    expect(result.instructions).not.toContain('automation_update')
    expect(result.instructions).not.toContain('set_thread_archived')
  })
})
