import { describe, expect, it, vi } from 'vitest'

import { LiveAgentRegistry } from './LiveAgentRegistry'

describe('LiveAgentRegistry', () => {
  it('retains completed agents and removes closed or not-found agents', async () => {
    const registry = new LiveAgentRegistry()
    registry.observe({
      kind: 'started',
      threadId: 'parent',
      agentThreadId: 'child',
      agentPath: 'agents/reviewer'
    })
    registry.observe({
      kind: 'completed',
      threadId: 'parent',
      agentThreadId: 'child',
      status: 'completed'
    })

    await expect(registry.list('parent')).resolves.toEqual([
      expect.objectContaining({
        kind: 'liveAgent',
        threadId: 'child',
        label: 'reviewer',
        status: 'completed',
        uri: 'agent://child'
      })
    ])

    registry.observe({
      kind: 'updated',
      threadId: 'parent',
      agentThreadId: 'child',
      status: 'notFound'
    })
    await expect(registry.list('parent')).resolves.toEqual([])
  })

  it('bootstraps once from the existing thread history', async () => {
    const readThreadWithFullTurns = vi.fn(async () => ({
      turns: [
        {
          items: [
            {
              type: 'subAgentActivity',
              kind: 'started',
              agentThreadId: 'child',
              agentPath: 'agents/explorer'
            },
            {
              type: 'collabAgentToolCall',
              tool: 'wait',
              status: 'completed',
              receiverThreadIds: ['child'],
              agentsStates: { child: { status: 'completed' } }
            }
          ]
        }
      ]
    }))
    const registry = new LiveAgentRegistry({ readThreadWithFullTurns })

    const first = await registry.list('parent')
    const second = await registry.list('parent')

    expect(first).toEqual([
      expect.objectContaining({ threadId: 'child', label: 'explorer', status: 'completed' })
    ])
    expect(second).toEqual(first)
    expect(readThreadWithFullTurns).toHaveBeenCalledTimes(1)
  })

  it('does not let older history overwrite a live lifecycle event', async () => {
    const registry = new LiveAgentRegistry({
      readThreadWithFullTurns: async () => ({
        turns: [
          {
            items: [
              {
                type: 'subAgentActivity',
                kind: 'started',
                agentThreadId: 'child',
                agentPath: 'agents/explorer'
              }
            ]
          }
        ]
      })
    })
    registry.observe({
      kind: 'completed',
      threadId: 'parent',
      agentThreadId: 'child',
      agentPath: 'agents/explorer',
      status: 'completed'
    })

    await expect(registry.list('parent')).resolves.toEqual([
      expect.objectContaining({ threadId: 'child', status: 'completed' })
    ])
  })
})
