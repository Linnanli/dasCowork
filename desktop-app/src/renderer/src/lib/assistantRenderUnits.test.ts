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
        kind: unit.type === 'tool-group' ? unit.kind : undefined,
        key: unit.key,
        partIndices: unit.partIndices,
        action: 'action' in unit ? unit.action : undefined,
        renderMode: unit.type === 'entry' ? unit.renderMode : undefined,
        targetIds: unit.target.itemIds,
        childCount: unit.type === 'tool-group' ? unit.children.length : undefined,
        mcpSourceType: unit.type === 'tool-group' ? unit.mcpSource?.sourceType : undefined,
        dynamicRepeatCount:
          unit.type === 'tool-group' ? unit.dynamicMetadata?.repeatCount : undefined,
        dynamicHasRegistryMetadata:
          unit.type === 'tool-group' ? unit.dynamicMetadata?.hasRegistryMetadata : undefined,
        summaryOnly: unit.type === 'tool-group' ? unit.summaryOnly : undefined,
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

    expect(model.units.map((unit) => unit.type)).toEqual(['tool-group', 'text'])
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
      type: 'tool-group',
      kind: 'composite',
      active: true,
      showThinkingFallback: false
    })
  })

  it('adds message-level thinking after completed tool activity while the turn runs', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [toolPart('cmd-1', 'commandExecution'), toolPart('file-1', 'fileChange')]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'composite',
        active: false,
        showThinkingFallback: false
      },
      {
        type: 'message-thinking',
        key: 'message-thinking',
        active: true,
        showThinkingFallback: true
      }
    ])
  })

  it('keeps adjacent completed and active tools in the same activity group', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        toolPart('cmd-complete', 'commandExecution'),
        toolPart('file-active', 'fileChange', { status: { type: 'running' } })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'composite',
        partIndices: [0, 1],
        status: 'running',
        active: true,
        showThinkingFallback: false
      }
    ])
    expect(model.units).toHaveLength(1)
  })

  it('keeps the same group key when a second adjacent tool joins a running turn', () => {
    const afterFirstTool = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [toolPart('cmd-complete', 'commandExecution')]
    })
    const whileSecondToolRuns = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        toolPart('cmd-complete', 'commandExecution'),
        toolPart('file-active', 'fileChange', { status: { type: 'running' } })
      ]
    })

    expect(afterFirstTool.units[0]).toMatchObject({
      type: 'tool-group',
      key: 'tool-group:cmd-complete'
    })
    expect(whileSecondToolRuns.units).toHaveLength(1)
    expect(whileSecondToolRuns.units[0]).toMatchObject({
      type: 'tool-group',
      key: 'tool-group:cmd-complete',
      kind: 'composite',
      partIndices: [0, 1]
    })
  })

  it('hides completed low-value internals in steps prose detail level', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      detailLevel: 'stepsProse',
      content: [
        toolPart('sleep-complete', 'sleep'),
        toolPart('loaded-tool-complete', 'loadedTool'),
        toolPart('file-visible', 'fileChange')
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'file-change'
      }
    ])
    expect(model.units).toHaveLength(1)
  })

  it('keeps active low-value internals visible in steps prose detail level', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      detailLevel: 'stepsProse',
      content: [toolPart('sleep-running', 'sleep', { status: { type: 'running' } })]
    })

    expect(model.units).toMatchObject([
      {
        type: 'entry',
        itemType: 'sleep',
        active: true
      }
    ])
  })

  it('groups consecutive web searches', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [toolPart('web-1', 'webSearch'), toolPart('web-2', 'webSearch')]
    })

    expect(model.units).toMatchObject([
      { type: 'tool-group', kind: 'web-search', partIndices: [0, 1] }
    ])
  })

  it('keeps mixed web search and command activity in a composite tool group', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [toolPart('web-1', 'webSearch'), toolPart('cmd-1', 'commandExecution')]
    })

    expect(model.units).toMatchObject([
      { type: 'tool-group', kind: 'composite', partIndices: [0, 1] }
    ])
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

    expect(model.units).toMatchObject([
      { type: 'tool-group', kind: 'web-search', partIndices: [0, 1] }
    ])
  })

  it('normalizes read list and search command activity into an exploration entry', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('read-1', 'commandExecution', {
          commandActions: [{ type: 'read', path: '/repo/src/a.ts', command: 'sed -n 1,80p' }]
        }),
        toolPart('list-1', 'commandExecution', {
          commandActions: [{ type: 'listFiles', path: '/repo/src', command: 'ls src' }]
        }),
        toolPart('search-1', 'commandExecution', {
          commandActions: [{ type: 'search', query: 'needle', command: 'rg needle' }]
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'exploration',
        partIndices: [0, 1, 2]
      }
    ])
    expect(model.units[0]?.target.itemIds).toEqual(
      expect.arrayContaining(['read-1', 'list-1', 'search-1'])
    )
    expect(model.units[0]?.type === 'tool-group' ? model.units[0].children : []).toHaveLength(3)
  })

  it('recognizes reference exec parsed command exploration actions', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('exec-read', 'exec', {
          parsedCmd: { type: 'read', path: '/repo/README.md' }
        }),
        toolPart('exec-search', 'exec', {
          parsedCmd: { type: 'search', query: 'renderUnit' }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'exploration',
        partIndices: [0, 1]
      }
    ])
    expect(model.units[0]?.target.itemIds).toEqual(
      expect.arrayContaining(['exec-read', 'exec-search'])
    )
  })

  it('groups live web search tool input before a result item is available', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        {
          type: 'dynamic-tool',
          toolCallId: 'web-live',
          toolName: 'codex_web_search',
          state: 'input-available',
          input: { query: 'live render unit query', action: { type: 'search' } },
          providerExecuted: true
        }
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'web-search',
        active: true,
        partIndices: [0],
        target: { itemIds: ['web-live'] },
        summary: {
          activeSummary: '正在搜索网页：live render unit query',
          details: ['网页搜索：live render unit query']
        }
      }
    ])
  })

  it('does not claim final web search support from completed input-only tool parts', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        {
          type: 'dynamic-tool',
          toolCallId: 'web-input-only',
          toolName: 'codex_web_search',
          state: 'output-available',
          input: { query: 'input only query', action: { type: 'search' } },
          providerExecuted: true
        }
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'dynamic'
      }
    ])
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
        type: 'tool-group',
        kind: 'mcp',
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
        type: 'tool-group',
        kind: 'mcp',
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

    expect(model.units).toMatchObject([
      { type: 'tool-group', kind: 'dynamic', partIndices: [0, 1] }
    ])
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
        type: 'tool-group',
        kind: 'dynamic',
        dynamicMetadata: {
          hasRegistryMetadata: false,
          repeatCount: 2,
          displayLabels: [
            {
              completedLabel: 'Lookup',
              count: 2,
              hasRegistryMetadata: false
            }
          ]
        }
      }
    ])
  })

  it('normalizes successful automation_update dynamic tools into compact entries', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        historicalDynamicToolPart('automation-1', 'automation_update', {
          id: 'automation-1',
          type: 'dynamicToolCall',
          tool: 'automation_update',
          status: 'completed',
          success: true,
          arguments: {
            name: 'daily digest',
            action: 'updated',
            summary: 'daily digest updated'
          }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'entry',
        itemType: 'automationUpdate',
        renderMode: 'custom',
        item: {
          type: 'automationUpdate',
          name: 'daily digest',
          action: 'updated',
          summary: 'daily digest updated'
        }
      }
    ])
  })

  it('keeps failed automation_update calls in dynamic tool fallback instead of compact success UI', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        historicalDynamicToolPart('automation-1', 'automation_update', {
          id: 'automation-1',
          type: 'dynamicToolCall',
          tool: 'automation_update',
          status: 'completed',
          success: false,
          error: 'permission denied',
          arguments: { name: 'daily digest' }
        })
      ]
    })

    expect(model.units).toMatchObject([{ type: 'tool-group', kind: 'dynamic' }])
  })

  it('marks summary-only dynamic groups as non-expandable render units', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('dyn-1', 'dynamicToolCall', {
          registryMetadata: {
            summaryOnlyInConversationGroup: true,
            completedSummaryKey: 'docs'
          }
        }),
        toolPart('dyn-2', 'dynamicToolCall', {
          registryMetadata: {
            summaryOnlyInConversationGroup: true,
            completedSummaryKey: 'docs'
          }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'dynamic',
        summaryOnly: true
      }
    ])
  })

  it('keeps completed dynamic groups live between calls while the message runs', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'running' },
      content: [
        toolPart('dyn-1', 'dynamicToolCall', {
          registryMetadata: {
            completedSummaryKey: 'docs',
            continuesLiveActivityBetweenCalls: true
          }
        })
      ]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'dynamic',
        active: true,
        showThinkingFallback: false
      }
    ])
    expect(model.units).toHaveLength(1)
  })

  it('groups consecutive MCP tool calls by server', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('mcp-1', 'mcpToolCall', { server: 'github', tool: 'read' }),
        toolPart('mcp-2', 'mcpToolCall', { server: 'github', tool: 'write' })
      ]
    })

    expect(model.units).toMatchObject([{ type: 'tool-group', kind: 'mcp', partIndices: [0, 1] }])
  })

  it('renders a single regular MCP server call through the MCP group renderer', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [toolPart('mcp-1', 'mcpToolCall', { server: 'github', tool: 'read' })]
    })

    expect(model.units).toMatchObject([
      {
        type: 'tool-group',
        kind: 'mcp',
        partIndices: [0],
        mcpSource: {
          sourceType: 'server',
          label: 'github'
        }
      }
    ])
  })

  it('groups consecutive collab agent calls as multi-agent groups', () => {
    const model = buildAssistantRenderUnits({
      status: { type: 'complete' },
      content: [
        toolPart('agent-1', 'collabAgentToolCall'),
        toolPart('agent-2', 'collabAgentToolCall')
      ]
    })

    expect(model.units).toMatchObject([
      { type: 'tool-group', kind: 'multi-agent', partIndices: [0, 1] }
    ])
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
      key: 'tool-group:agent-1',
      target: {
        id: 'render-unit-tool-group-agent-1',
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
        type: 'tool-group',
        kind: 'mcp',
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

  it('maps provider sleep events through real AI SDK UI parts into custom entries', async () => {
    const mapper = new CodexEventMapper()
    const item = { type: 'sleep', id: 'sleep-chain', durationMs: 1000 }
    const streamParts = [
      { method: 'turn/started', params: { threadId: 'thr', turn: { id: 'turn' } } },
      { method: 'item/started', params: { threadId: 'thr', turnId: 'turn', item } },
      { method: 'item/completed', params: { threadId: 'thr', turnId: 'turn', item } },
      {
        method: 'turn/completed',
        params: {
          threadId: 'thr',
          turn: { id: 'turn', items: [], status: 'completed', error: null }
        }
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
        renderMode: 'custom',
        summary: { label: '已等待 1 次' }
      }
    ])
  })

  it('maps provider plan updates into live todoList custom entries', async () => {
    const mapper = new CodexEventMapper()
    const streamParts = [
      { method: 'turn/started', params: { threadId: 'thr', turn: { id: 'turn-plan' } } },
      {
        method: 'turn/plan/updated',
        params: {
          threadId: 'thr',
          turnId: 'turn-plan',
          explanation: 'Working',
          plan: [
            { step: 'Read files', status: 'completed' },
            { step: 'Patch renderer', status: 'inProgress' }
          ]
        }
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'thr',
          turn: { id: 'turn-plan', items: [], status: 'completed', error: null }
        }
      }
    ].flatMap((event) => mapper.map(event))

    const aiSdkParts = await messagePartsFromProviderStreamParts(streamParts)
    const model = buildAssistantRenderUnits({ status: { type: 'running' }, content: aiSdkParts })

    expect(aiSdkParts).toMatchObject([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'plan:turn-plan:1',
        toolName: 'codex_todo_list',
        state: 'output-available',
        output: {
          item: {
            type: 'todoList',
            items: [
              { label: 'Read files', status: 'completed' },
              { label: 'Patch renderer', status: 'inProgress' }
            ]
          }
        }
      }
    ])
    expect(model.units).toMatchObject([
      {
        type: 'entry',
        itemType: 'todoList',
        renderMode: 'custom',
        active: true
      }
    ])
  })

  it('maps provider turn diff updates into capped turnDiff custom entries', async () => {
    const mapper = new CodexEventMapper()
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n'
    const streamParts = [
      { method: 'turn/started', params: { threadId: 'thr', turn: { id: 'turn-diff' } } },
      {
        method: 'turn/diff/updated',
        params: { threadId: 'thr', turnId: 'turn-diff', diff }
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'thr',
          turn: { id: 'turn-diff', items: [], status: 'completed', error: null }
        }
      }
    ].flatMap((event) => mapper.map(event))

    const aiSdkParts = await messagePartsFromProviderStreamParts(streamParts)
    const model = buildAssistantRenderUnits({ status: { type: 'running' }, content: aiSdkParts })

    expect(aiSdkParts).toMatchObject([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'turn-diff:turn-diff:1',
        toolName: 'codex_turn_diff',
        state: 'output-available',
        output: { item: { type: 'turnDiff', diff } }
      }
    ])
    expect(model.units).toMatchObject([
      {
        type: 'entry',
        itemType: 'turnDiff',
        renderMode: 'custom',
        active: true
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
