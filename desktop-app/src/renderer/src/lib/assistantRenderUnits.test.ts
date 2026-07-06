import { describe, expect, it } from 'vitest'
import { CodexEventMapper } from '@janole/ai-sdk-provider-codex-asp'
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult
} from '@ai-sdk/provider'
import { readUIMessageStream, streamText, type UIMessage } from 'ai'

import { buildAssistantRenderUnits } from './assistantRenderUnits'
import { assistantRenderUnitFixtures } from './__fixtures__/assistantRenderUnitFixtures'

describe('buildAssistantRenderUnits', () => {
  it.each(assistantRenderUnitFixtures)('$name', (fixture) => {
    const model = buildAssistantRenderUnits({
      status: fixture.status,
      content: fixture.parts
    })

    expect(
      model.units.map((unit) => ({
        type: unit.type,
        key: unit.key,
        partIndices: unit.partIndices,
        action: 'action' in unit ? unit.action : undefined,
        renderMode: unit.type === 'entry' ? unit.renderMode : undefined,
        targetIds: unit.target.itemIds,
        mcpSourceType:
          unit.type === 'pending-mcp-tool-calls' ? unit.mcpSource?.sourceType : undefined,
        dynamicRepeatCount:
          unit.type === 'dynamic-tool-call-group' ? unit.dynamicMetadata?.repeatCount : undefined,
        dynamicHasRegistryMetadata:
          unit.type === 'dynamic-tool-call-group'
            ? unit.dynamicMetadata?.hasRegistryMetadata
            : undefined,
        summaryLabel: unit.summary?.label
      }))
    ).toMatchObject(fixture.expectedUnits)
  })

  it('maps reasoning-only running messages to message-level thinking', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [{ type: 'reasoning', text: 'checking context' }]
    })

    expect(model.isThinkingOnly).toBe(true)
    expect(model.units).toMatchObject([
      { type: 'message-thinking', key: 'message-thinking', showThinkingFallback: true }
    ])
  })

  it('prevents older tools from owning thinking when text follows them', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [toolPart('cmd-1', 'commandExecution'), { type: 'text', text: '结果如下' }]
    })

    expect(model.units.map((unit) => unit.type)).toEqual(['entry', 'text'])
    expect(model.units[0]).toMatchObject({ showThinkingFallback: false })
  })

  it('keeps active latest tool groups on their active summary instead of generic thinking', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        toolPart('cmd-1', 'commandExecution', { status: { type: 'running' } }),
        toolPart('file-1', 'fileChange', { status: { type: 'running' } })
      ]
    })

    expect(model.units).toHaveLength(1)
    expect(model.units[0]).toMatchObject({
      type: 'collapsed-tool-activity',
      active: true,
      showThinkingFallback: false
    })
  })

  it('assigns thinking to the completed latest collapsed tool activity while the turn runs', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [toolPart('cmd-1', 'commandExecution'), toolPart('file-1', 'fileChange')]
    })

    expect(model.units).toHaveLength(1)
    expect(model.units[0]).toMatchObject({
      type: 'collapsed-tool-activity',
      active: false,
      showThinkingFallback: true
    })
  })

  it('groups consecutive web searches', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [toolPart('web-1', 'webSearch'), toolPart('web-2', 'webSearch')]
    })

    expect(model.units).toMatchObject([{ type: 'web-search-group', partIndices: [0, 1] }])
  })

  it('groups historical dynamic-tool webSearch parts like live tool-call parts', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        historicalDynamicToolPart('web-1', 'codex_web_search', {
          id: 'web-1',
          type: 'webSearch',
          query: 'codex app server'
        }),
        historicalDynamicToolPart('web-2', 'codex_web_search', {
          id: 'web-2',
          type: 'webSearch',
          query: 'assistant ui'
        })
      ]
    })

    expect(model.units).toMatchObject([{ type: 'web-search-group', partIndices: [0, 1] }])
  })

  it('groups historical dynamic-tool MCP parts by app context source metadata', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        historicalDynamicToolPart('mcp-1', 'mcp:github/read', {
          id: 'mcp-1',
          type: 'mcpToolCall',
          server: 'github',
          tool: 'read',
          appContext: {
            connectorId: 'github-app',
            appName: 'GitHub',
            resourceUri: 'app://github'
          }
        }),
        historicalDynamicToolPart('mcp-2', 'mcp:github/write', {
          id: 'mcp-2',
          type: 'mcpToolCall',
          server: 'github',
          tool: 'write',
          appContext: {
            connectorId: 'github-app',
            appName: 'GitHub',
            resourceUri: 'app://github'
          }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'pending-mcp-tool-calls',
        partIndices: [0, 1],
        mcpSource: {
          sourceType: 'app',
          groupKey: 'app:github-app',
          label: 'GitHub',
          resourceUri: 'app://github'
        }
      }
    ])
  })

  it('uses preliminary dynamic-tool output item for live MCP source before final result arrives', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        {
          type: 'dynamic-tool',
          toolCallId: 'mcp-live',
          toolName: 'mcp:github/read',
          state: 'output-available',
          preliminary: true,
          providerExecuted: true,
          input: { path: 'README.md' },
          output: {
            item: {
              id: 'mcp-live',
              type: 'mcpToolCall',
              server: 'github',
              tool: 'read',
              status: 'inProgress',
              arguments: {},
              appContext: {
                connectorId: 'github-app',
                appName: 'GitHub',
                resourceUri: 'app://github'
              },
              pluginId: 'github-plugin',
              result: null,
              error: null,
              durationMs: null
            }
          }
        }
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'pending-mcp-tool-calls',
        active: true,
        mcpSource: {
          sourceType: 'app',
          groupKey: 'app:github-app',
          label: 'GitHub',
          pluginId: 'github-plugin'
        }
      }
    ])
  })

  it('groups consecutive dynamic tool calls', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [toolPart('dyn-1', 'dynamicToolCall'), toolPart('dyn-2', 'dynamicToolCall')]
    })

    expect(model.units).toMatchObject([{ type: 'dynamic-tool-call-group', partIndices: [0, 1] }])
  })

  it('keeps dynamic tool fallback metadata explicit when registry metadata is absent', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        historicalDynamicToolPart('dyn-1', 'lookup', {
          id: 'dyn-1',
          type: 'dynamicToolCall',
          tool: 'lookup',
          arguments: { id: 'A' }
        }),
        historicalDynamicToolPart('dyn-2', 'lookup', {
          id: 'dyn-2',
          type: 'dynamicToolCall',
          tool: 'lookup',
          arguments: { id: 'B' }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'dynamic-tool-call-group',
        dynamicMetadata: {
          hasRegistryMetadata: false,
          repeatCount: 2
        }
      }
    ])
  })

  it('groups consecutive MCP tool calls by server', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('mcp-1', 'mcpToolCall', { server: 'github', tool: 'read' }),
        toolPart('mcp-2', 'mcpToolCall', { server: 'github', tool: 'write' })
      ]
    })

    expect(model.units).toMatchObject([{ type: 'pending-mcp-tool-calls', partIndices: [0, 1] }])
  })

  it('groups consecutive collab agent calls as multi-agent groups', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('agent-1', 'collabAgentToolCall'),
        toolPart('agent-2', 'collabAgentToolCall')
      ]
    })

    expect(model.units).toMatchObject([{ type: 'multi-agent-group', partIndices: [0, 1] }])
  })

  it('keeps stable keys and target ids for grouped internal items', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('agent-1', 'collabAgentToolCall', { action: 'review' }),
        toolPart('agent-2', 'collabAgentToolCall', { action: 'review' })
      ]
    })

    expect(model.units[0]).toMatchObject({
      key: 'multi-agent-group:review:0',
      target: {
        id: 'render-unit-multi-agent-group-review-0',
        itemIds: ['agent-1', 'agent-2']
      }
    })
  })

  it('lets unknown renderable content prevent message-level thinking', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [{ type: 'file', mediaType: 'image/png', data: 'abc' }]
    })

    expect(model.isThinkingOnly).toBe(false)
    expect(model.units).toMatchObject([{ type: 'unknown', showThinkingFallback: false }])
  })

  it('keeps provider mapper MCP lifecycle as one Render-Unit with completed source metadata', async () => {
    const mapper = new CodexEventMapper()
    const startedItem = {
      type: 'mcpToolCall',
      id: 'mcp-chain',
      server: 'github',
      tool: 'read',
      status: 'inProgress',
      arguments: { path: 'README.md' },
      appContext: {
        connectorId: 'github-app',
        appName: 'GitHub',
        resourceUri: 'app://github'
      },
      pluginId: 'github-plugin',
      result: null,
      error: null,
      durationMs: null
    }
    const completedItem = {
      ...startedItem,
      status: 'completed',
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
      durationMs: 30
    }
    const streamParts = [
      { method: 'turn/started', params: { threadId: 'thr', turn: { id: 'turn' } } },
      { method: 'item/started', params: { threadId: 'thr', turnId: 'turn', item: startedItem } },
      {
        method: 'item/mcpToolCall/progress',
        params: { threadId: 'thr', turnId: 'turn', itemId: 'mcp-chain', message: 'Reading...' }
      },
      { method: 'item/completed', params: { threadId: 'thr', turnId: 'turn', item: completedItem } }
    ].flatMap((event) => mapper.map(event))
    streamParts.push(
      ...mapper.map({
        method: 'turn/completed',
        params: {
          threadId: 'thr',
          turn: { id: 'turn', items: [], status: 'completed', error: null }
        }
      })
    )

    const aiSdkParts = await messagePartsFromProviderStreamParts(streamParts)
    const model = buildAssistantRenderUnits({ status: { type: 'complete' }, content: aiSdkParts })

    expect(aiSdkParts).toMatchObject([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'mcp-chain',
        state: 'output-available',
        output: { item: completedItem }
      }
    ])
    expect(model.units).toMatchObject([
      {
        type: 'pending-mcp-tool-calls',
        partIndices: [1],
        mcpSource: {
          sourceType: 'app',
          groupKey: 'app:github-app',
          label: 'GitHub'
        },
        summary: {
          label: '已调用 1 个 MCP 工具',
          sourceSummary: 'GitHub'
        }
      }
    ])
  })

  it('maps provider sleep events through real AI SDK UI parts into fallback entries', async () => {
    const mapper = new CodexEventMapper()
    const item = { type: 'sleep', id: 'sleep-chain', durationMs: 1000 }
    const streamParts = [
      { method: 'turn/started', params: { threadId: 'thr', turn: { id: 'turn' } } },
      { method: 'item/started', params: { threadId: 'thr', turnId: 'turn', item } },
      { method: 'item/completed', params: { threadId: 'thr', turnId: 'turn', item } },
      {
        method: 'turn/completed',
        params: { threadId: 'thr', turn: { id: 'turn', items: [], status: 'completed', error: null } }
      }
    ].flatMap((event) => mapper.map(event))

    const aiSdkParts = await messagePartsFromProviderStreamParts(streamParts)
    const model = buildAssistantRenderUnits({ status: { type: 'complete' }, content: aiSdkParts })

    expect(aiSdkParts).toMatchObject([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'sleep-chain',
        state: 'output-available',
        output: { item }
      }
    ])
    expect(model.units).toMatchObject([
      {
        type: 'entry',
        itemType: 'sleep',
        renderMode: 'fallback',
        summary: { label: '已等待 1 次' }
      }
    ])
  })

  it('keeps preliminary dynamic-tool sleep output active while the turn is running', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        {
          type: 'dynamic-tool',
          toolCallId: 'sleep-running',
          toolName: 'codex_sleep',
          state: 'output-available',
          preliminary: true,
          output: { item: { type: 'sleep', id: 'sleep-running', durationMs: 1000 } },
          providerExecuted: true
        }
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'entry',
        active: true,
        showThinkingFallback: false,
        summary: { label: '正在等待 1 次' }
      }
    ])
  })
})

function toolPart(
  id: string,
  itemType: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const item = {
    id,
    type: itemType,
    status: 'completed',
    ...overrides
  }

  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: toolNameForItemType(itemType, overrides),
    status: overrides.status ?? { type: 'complete' },
    result: { item }
  }
}

function toolNameForItemType(itemType: string, item: Record<string, unknown>): string {
  if (itemType === 'commandExecution') return 'codex_command_execution'
  if (itemType === 'fileChange') return 'codex_file_change'
  if (itemType === 'webSearch') return 'codex_web_search'
  if (itemType === 'mcpToolCall') return `mcp:${item.server ?? 'server'}/${item.tool ?? 'tool'}`
  if (itemType === 'collabAgentToolCall') return 'codex_collab_agent'
  return itemType
}

function historicalDynamicToolPart(
  id: string,
  toolName: string,
  item: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: 'dynamic-tool',
    toolCallId: id,
    toolName,
    state: 'output-available',
    input: {},
    output: { item },
    providerExecuted: true
  }
}

async function messagePartsFromProviderStreamParts(
  parts: readonly LanguageModelV3StreamPart[]
): Promise<Record<string, unknown>[]> {
  const result = streamText({
    model: new MockUiStreamModel(parts),
    prompt: 'render unit test'
  })

  let lastMessage: UIMessage | undefined
  for await (const message of readUIMessageStream({
    stream: result.toUIMessageStream({
      sendReasoning: true
    }),
    onError(error) {
      throw error
    }
  })) {
    lastMessage = message
  }

  return (lastMessage?.parts ?? []) as Record<string, unknown>[]
}

class MockUiStreamModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3'
  readonly provider = 'test'
  readonly modelId = 'render-unit-test'
  readonly supportedUrls = {}

  constructor(private readonly parts: readonly LanguageModelV3StreamPart[]) {}

  async doGenerate(): Promise<LanguageModelV3GenerateResult> {
    throw new Error('MockUiStreamModel only supports streaming')
  }

  async doStream(): Promise<LanguageModelV3StreamResult> {
    return { stream: streamFromParts(this.parts) }
  }
}

function streamFromParts(
  parts: readonly LanguageModelV3StreamPart[]
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }
      controller.close()
    }
  })
}
