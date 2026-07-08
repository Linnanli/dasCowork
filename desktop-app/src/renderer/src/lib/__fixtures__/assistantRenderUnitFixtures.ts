type AssistantRenderUnitFixture = {
  name: string
  status?: { type: 'complete' | 'running' }
  parts: readonly Record<string, unknown>[]
  expectedUnits: readonly ExpectedRenderUnitSummary[]
}

type ExpectedRenderUnitSummary = {
  type: string
  key?: string
  partIndices: readonly number[]
  action?: string
  renderMode?: string
  targetIds?: readonly string[]
  mcpSourceType?: string
  dynamicRepeatCount?: number
  dynamicHasRegistryMetadata?: boolean
  summaryLabel?: string
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
      { type: 'web-search-group', partIndices: [0, 1], targetIds: ['web-1', 'web-2'] },
      { type: 'text', partIndices: [2] },
      { type: 'web-search-group', partIndices: [3], targetIds: ['web-3'] },
      { type: 'unknown', partIndices: [4] }
    ]
  },
  {
    name: 'multi-agent groups split when the action changes',
    status: { type: 'complete' },
    parts: [
      toolPart('agent-1', 'collabAgentToolCall', { action: 'review' }),
      toolPart('agent-2', 'collabAgentToolCall', { action: 'review' }),
      toolPart('agent-3', 'collabAgentToolCall', { action: 'implement' })
    ],
    expectedUnits: [
      {
        type: 'multi-agent-group',
        partIndices: [0, 1],
        action: 'review',
        targetIds: ['agent-1', 'agent-2']
      },
      {
        type: 'multi-agent-group',
        partIndices: [2],
        action: 'implement',
        targetIds: ['agent-3']
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
        type: 'dynamic-tool-call-group',
        partIndices: [0, 1],
        dynamicRepeatCount: 2,
        dynamicHasRegistryMetadata: true,
        targetIds: ['dyn-1', 'dyn-2']
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
        type: 'dynamic-tool-call-group',
        partIndices: [0],
        dynamicRepeatCount: 1,
        dynamicHasRegistryMetadata: true,
        targetIds: ['dyn-standalone']
      }
    ]
  },
  {
    name: 'MCP groups by app or server and keeps special tool experiences distinct',
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
        type: 'pending-mcp-tool-calls',
        partIndices: [0, 1],
        mcpSourceType: 'app',
        targetIds: ['mcp-1', 'mcp-2']
      },
      { type: 'entry', partIndices: [2], targetIds: ['mcp-3'] },
      {
        type: 'pending-mcp-tool-calls',
        partIndices: [3],
        mcpSourceType: 'node-repl',
        targetIds: ['mcp-4']
      },
      {
        type: 'pending-mcp-tool-calls',
        partIndices: [4],
        mcpSourceType: 'browser',
        targetIds: ['mcp-5']
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
        type: 'collapsed-tool-activity',
        partIndices: [0, 1, 2, 3],
        targetIds: ['mkdir-1', 'file-1', 'load-1', 'approval-1'],
        summaryLabel: '已创建 1 个文件夹，已创建 1 个文件，已加载 1 个工具定义，已拒绝 1 次自动审批'
      }
    ]
  },
  {
    name: 'entry render matrix keeps text entries and generated images explicit',
    status: { type: 'complete' },
    parts: [
      { type: 'reasoning', text: '内部推理完成', status: { type: 'complete' } },
      { type: 'item', result: { item: { id: 'image-1', type: 'generated-image' } } }
    ],
    expectedUnits: [
      { type: 'entry', partIndices: [0], renderMode: 'text', targetIds: ['reasoning:0'] },
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
        type: 'entry',
        key: 'exploration:exec-1',
        partIndices: [0],
        renderMode: 'custom',
        targetIds: ['exec-item-1', 'exec-1']
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
