type AssistantRenderUnitFixture = {
  name: string
  status?: { type: 'complete' | 'running' }
  parts: readonly Record<string, unknown>[]
  expectedUnits: readonly ExpectedRenderUnitSummary[]
}

type ExpectedRenderUnitSummary = {
  type: string
  kind?: string
  key?: string
  partIndices: readonly number[]
  action?: string
  renderMode?: string
  targetIds?: readonly string[]
  childCount?: number
  mcpSourceType?: string
  dynamicRepeatCount?: number
  dynamicHasRegistryMetadata?: boolean
  summaryOnly?: boolean
  summaryLabel?: string
  active?: boolean
  processItemCount?: number
}

export const assistantRenderUnitFixtures: readonly AssistantRenderUnitFixture[] = [
  {
    name: 'web search is grouped until text or unknown content interrupts it',
    status: { type: 'complete' },
    parts: [
      toolPart('web-1', 'webSearch', { query: 'codex app server' }),
      toolPart('web-2', 'webSearch', { query: 'assistant ui' }),
      { type: 'text', text: '找到一些线索。' },
      toolPart('web-3', 'webSearch', { query: 'render units' }),
      { type: 'file', mediaType: 'image/png', data: 'abc' }
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'web-search',
        partIndices: [0, 1],
        targetIds: ['web-1', 'web-2'],
        childCount: 2
      },
      { type: 'text', partIndices: [2] },
      {
        type: 'tool-group',
        kind: 'web-search',
        partIndices: [3],
        targetIds: ['web-3'],
        childCount: 1
      },
      { type: 'unknown', partIndices: [4] }
    ]
  },
  {
    name: 'adjacent multi-agent tools stay in one group when the action changes',
    status: { type: 'complete' },
    parts: [
      toolPart('agent-1', 'collabAgentToolCall', { action: 'review' }),
      toolPart('agent-2', 'collabAgentToolCall', { action: 'review' }),
      toolPart('agent-3', 'collabAgentToolCall', { action: 'implement' })
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'multi-agent',
        partIndices: [0, 1, 2],
        targetIds: ['agent-1', 'agent-2', 'agent-3'],
        childCount: 3
      }
    ]
  },
  {
    name: 'dynamic tool groups retain registry fallback metadata and repeat count',
    status: { type: 'complete' },
    parts: [
      toolPart('dyn-1', 'dynamicToolCall', {
        completedSummaryKey: 'search:docs',
        registryMetadata: {
          summaryOnlyInConversationGroup: true,
          continuesLiveActivityBetweenCalls: true,
          completedSummaryKey: 'search:docs'
        }
      }),
      toolPart('dyn-2', 'dynamicToolCall', {
        completedSummaryKey: 'search:docs',
        registryMetadata: {
          summaryOnlyInConversationGroup: true,
          continuesLiveActivityBetweenCalls: true,
          completedSummaryKey: 'search:docs'
        }
      })
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'dynamic',
        partIndices: [0, 1],
        dynamicRepeatCount: 2,
        dynamicHasRegistryMetadata: true,
        summaryOnly: true,
        targetIds: ['dyn-1', 'dyn-2'],
        childCount: 2
      }
    ]
  },
  {
    name: 'standalone dynamic tools still get the dedicated dynamic renderer',
    status: { type: 'complete' },
    parts: [
      toolPart('dyn-standalone', 'dynamicToolCall', {
        registryMetadata: { standaloneInConversation: true }
      })
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'dynamic',
        partIndices: [0],
        dynamicRepeatCount: 1,
        dynamicHasRegistryMetadata: true,
        targetIds: ['dyn-standalone'],
        childCount: 1
      }
    ]
  },
  {
    name: 'adjacent MCP tools stay in one group across app and server sources',
    status: { type: 'complete' },
    parts: [
      toolPart('mcp-1', 'mcpToolCall', {
        server: 'github',
        tool: 'read',
        appContext: { connectorId: 'github-app', displayName: 'GitHub' }
      }),
      toolPart('mcp-2', 'mcpToolCall', {
        server: 'github',
        tool: 'write',
        appContext: { connectorId: 'github-app', displayName: 'GitHub' }
      }),
      toolPart('mcp-3', 'mcpToolCall', { server: 'computer-use', tool: 'click' }),
      toolPart('mcp-4', 'mcpToolCall', { server: 'node_repl', tool: 'js' }),
      toolPart('mcp-5', 'mcpToolCall', { server: 'browser', tool: 'open' })
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'mcp',
        partIndices: [0, 1, 2, 3, 4],
        targetIds: ['mcp-1', 'mcp-2', 'mcp-3', 'mcp-4', 'mcp-5'],
        childCount: 5
      }
    ]
  },
  {
    name: 'collapsed activity summarizes files folders loaded tools and automatic approval',
    status: { type: 'complete' },
    parts: [
      toolPart('mkdir-1', 'commandExecution', {
        commandActions: [{ type: 'mkdir', command: 'mkdir src/new', path: '/repo/src/new' }]
      }),
      toolPart('file-1', 'fileChange', {
        changes: [{ path: '/repo/src/new/index.ts', kind: { type: 'add' }, diff: '' }]
      }),
      toolPart('load-1', 'loadedTool'),
      toolPart('approval-1', 'automaticApprovalReview', { outcome: 'denied' })
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'composite',
        partIndices: [0, 1, 2],
        targetIds: ['mkdir-1', 'file-1', 'load-1'],
        childCount: 3,
        summaryLabel: '已创建 1 个文件夹，已创建 1 个文件，已加载 1 个工具定义'
      },
      {
        type: 'entry',
        partIndices: [3],
        targetIds: ['approval-1']
      }
    ]
  },
  {
    name: 'entry render matrix hides internal reasoning and keeps generated images explicit',
    status: { type: 'complete' },
    parts: [
      { type: 'reasoning', text: '内部推理完成', status: { type: 'complete' } },
      { type: 'item', result: { item: { id: 'image-1', type: 'generated-image' } } }
    ],
    expectedUnits: [
      { type: 'entry', partIndices: [1], renderMode: 'custom', targetIds: ['image-1'] }
    ]
  },
  {
    name: 'exploration entries keep internal target ids and stable exploration keys',
    status: { type: 'complete' },
    parts: [
      {
        type: 'item',
        result: {
          item: {
            type: 'exploration',
            items: [{ id: 'exec-item-1', type: 'exec', callId: 'exec-1' }]
          }
        }
      }
    ],
    expectedUnits: [
      {
        type: 'tool-group',
        kind: 'exploration',
        key: 'tool-group:exec-1',
        partIndices: [0],
        targetIds: ['exec-item-1', 'exec-1'],
        childCount: 1
      }
    ]
  }
]

function toolPart(
  id: string,
  itemType: string,
  itemOverrides: Record<string, unknown> = {},
  partOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const item = {
    id,
    type: itemType,
    status: 'completed',
    ...itemOverrides
  }

  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: toolNameForItem(itemType, item),
    status: { type: 'complete' },
    result: { item },
    ...partOverrides
  }
}

function toolNameForItem(itemType: string, item: Record<string, unknown>): string {
  if (itemType === 'commandExecution') return 'codex_command_execution'
  if (itemType === 'fileChange') return 'codex_file_change'
  if (itemType === 'webSearch') return 'codex_web_search'
  if (itemType === 'mcpToolCall') return `mcp:${item.server ?? 'server'}/${item.tool ?? 'tool'}`
  if (itemType === 'collabAgentToolCall') return 'codex_collab_agent'
  if (itemType === 'loadedTool') return 'codex_loaded_tool'
  if (itemType === 'automaticApprovalReview') return 'codex_automatic_approval_review'
  return itemType
}
