import { pendingAssistantMessageText } from './assistantMessages'
import {
  extractToolInput,
  extractThreadItem,
  isActiveStatus,
  isToolPartActive,
  summarizeToolGroup,
  type ToolGroupSummary
} from './toolGroupSummary'
import { ENTRY_ITEM_RENDER_MODES, type EntryRenderMode } from './renderUnitCapabilityMatrix'

type AssistantMessagePart = Record<string, unknown>

export type AssistantRenderDetailLevel = 'default' | 'stepsProse'

type AssistantMessageLike = {
  status?: { type?: string }
  content: readonly AssistantMessagePart[]
  parts?: readonly AssistantMessagePart[]
  detailLevel?: AssistantRenderDetailLevel
}

export type AssistantRenderTarget = {
  id: string
  itemIds: readonly string[]
}

export type McpSourceMetadata = {
  groupKey: string
  sourceType: 'app' | 'server' | 'browser' | 'computer-use' | 'node-repl'
  label: string
  server?: string
  appKey?: string
  resourceUri?: string
  pluginId?: string
  toolName?: string
  callIds: readonly string[]
  hasAppMetadata: boolean
}

export type DynamicToolMetadata = {
  summaryOnlyInConversationGroup: boolean
  standaloneInConversation: boolean
  continuesLiveActivityBetweenCalls: boolean
  completedSummaryKey?: string
  repeatCount: number
  hasRegistryMetadata: boolean
}

export type AssistantRenderUnitBase = {
  key: string
  partIndices: readonly number[]
  target: AssistantRenderTarget
  itemType?: string
  active?: boolean
  summary?: ToolGroupSummary
  showThinkingFallback?: boolean
}

export type AssistantRenderUnit =
  | (AssistantRenderUnitBase & { type: 'message-thinking'; partIndices: readonly [] })
  | (AssistantRenderUnitBase & { type: 'text'; partIndex: number; text: string })
  | (AssistantRenderUnitBase & {
      type: 'entry'
      partIndex: number
      part: AssistantMessagePart
      item?: Record<string, unknown>
      itemType?: string
      mcpSource?: McpSourceMetadata
      renderMode: EntryRenderMode
    })
  | (AssistantRenderUnitBase & { type: 'unknown'; partIndex: number; part: AssistantMessagePart })
  | (AssistantRenderUnitBase & {
      type: 'collapsed-tool-activity'
      parts: readonly AssistantMessagePart[]
    })
  | (AssistantRenderUnitBase & {
      type: 'pending-mcp-tool-calls'
      parts: readonly AssistantMessagePart[]
      mcpSource?: McpSourceMetadata
    })
  | (AssistantRenderUnitBase & {
      type: 'dynamic-tool-call-group'
      parts: readonly AssistantMessagePart[]
      dynamicMetadata?: DynamicToolMetadata
    })
  | (AssistantRenderUnitBase & { type: 'web-search-group'; parts: readonly AssistantMessagePart[] })
  | (AssistantRenderUnitBase & {
      type: 'multi-agent-group'
      parts: readonly AssistantMessagePart[]
      action?: string
    })

export type AssistantRenderModel = {
  units: readonly AssistantRenderUnit[]
  isThinkingOnly: boolean
}

type NormalizedPart =
  | { kind: 'text'; partIndex: number; part: AssistantMessagePart; text: string }
  | {
      kind: 'entry'
      partIndex: number
      part: AssistantMessagePart
      item: Record<string, unknown>
      itemType: string
    }
  | {
      kind: 'tool'
      partIndex: number
      part: AssistantMessagePart
      item?: Record<string, unknown>
      itemType?: string
      toolName?: string
      callId?: string
      action?: string
      mcpSource?: McpSourceMetadata
      dynamicMetadata?: DynamicToolMetadata
    }
  | { kind: 'unknown'; partIndex: number; part: AssistantMessagePart }

type GroupableUnit =
  | { type: 'text'; partIndex: number; partIndices: readonly number[]; text: string }
  | {
      type: 'entry'
      partIndex: number
      partIndices: readonly number[]
      part: AssistantMessagePart
      item?: Record<string, unknown>
      itemType?: string
      toolName?: string
      callId?: string
      action?: string
      mcpSource?: McpSourceMetadata
      dynamicMetadata?: DynamicToolMetadata
    }
  | {
      type: 'unknown'
      partIndex: number
      partIndices: readonly number[]
      part: AssistantMessagePart
    }
  | {
      type: 'web-search-group'
      partIndices: readonly number[]
      parts: readonly AssistantMessagePart[]
    }
  | {
      type: 'multi-agent-group'
      partIndices: readonly number[]
      parts: readonly AssistantMessagePart[]
      action?: string
    }
  | {
      type: 'collapsed-tool-activity'
      partIndices: readonly number[]
      parts: readonly AssistantMessagePart[]
    }
  | {
      type: 'dynamic-tool-call-group'
      partIndices: readonly number[]
      parts: readonly AssistantMessagePart[]
      dynamicMetadata?: DynamicToolMetadata
    }
  | {
      type: 'pending-mcp-tool-calls'
      partIndices: readonly number[]
      parts: readonly AssistantMessagePart[]
      mcpSource?: McpSourceMetadata
    }

type ToolGroupableUnit = GroupableUnit & {
  parts?: readonly AssistantMessagePart[]
}

type EntryGroupableUnit = Extract<GroupableUnit, { type: 'entry' }>

type ExplorationActionKind = 'read' | 'list' | 'search'

type ExplorationAction = {
  type: ExplorationActionKind
  label?: string
  path?: string
  query?: string
  command?: string
}

const ACTIVITY_ITEM_TYPES = new Set([
  'commandExecution',
  'exec',
  'fileChange',
  'patch',
  'subAgentActivity',
  'subagent-activity',
  'imageView',
  'contextCompaction',
  'context-compaction',
  'hookPrompt',
  'hook-prompt',
  'enteredReviewMode',
  'exitedReviewMode',
  'automaticApprovalReview',
  'automatic-approval-review',
  'sleep',
  'loadedTool',
  'loaded-tool',
  'worktree-init'
])

const STEPS_PROSE_HIDDEN_ACTIVITY_TYPES = new Set([
  'contextCompaction',
  'context-compaction',
  'hookPrompt',
  'hook-prompt',
  'loadedTool',
  'loaded-tool',
  'sleep'
])

const WEB_SEARCH_ITEM_TYPES = new Set(['webSearch', 'web-search'])
const DYNAMIC_ITEM_TYPES = new Set(['dynamicToolCall', 'dynamic-tool-call'])
const MCP_ITEM_TYPES = new Set(['mcpToolCall', 'mcp-tool-call'])
const MULTI_AGENT_ITEM_TYPES = new Set([
  'collabAgentToolCall',
  'collabToolCall',
  'multi-agent-action'
])

export function buildAssistantRenderUnits(message: AssistantMessageLike): AssistantRenderModel {
  const parts = message.parts ?? message.content
  const isRunning = message.status?.type === 'running'
  const detailLevel = message.detailLevel ?? 'default'
  const normalized = normalizeParts(parts, isRunning)
  const preGrouped = groupWebSearchAndMultiAgent(normalized)
  const explorationGrouped = groupExplorationActivity(preGrouped)
  const activityCollapsed = collapseToolActivity(explorationGrouped, { detailLevel })
  const dynamicGrouped = groupDynamicToolCalls(activityCollapsed)
  const mcpGrouped = groupPendingMcpToolCalls(dynamicGrouped)
  const units = assignThinkingOwnership(
    mcpGrouped.map((unit, index) => toRenderUnit(unit, index)),
    isRunning
  )

  if (units.length === 0 && isRunning) {
    return {
      isThinkingOnly: true,
      units: [
        {
          type: 'message-thinking',
          key: 'message-thinking',
          partIndices: [],
          target: { id: 'message-thinking', itemIds: [] },
          active: true,
          showThinkingFallback: true
        }
      ]
    }
  }

  return { isThinkingOnly: units.length === 1 && units[0]?.type === 'message-thinking', units }
}

function normalizeParts(
  parts: readonly AssistantMessagePart[],
  isMessageRunning: boolean
): NormalizedPart[] {
  return parts.flatMap((part, partIndex): NormalizedPart[] => {
    const type = typeof part.type === 'string' ? part.type : undefined

    if (type === 'text') {
      const text = typeof part.text === 'string' ? part.text : ''
      return isVisibleAssistantText(text) ? [{ kind: 'text', partIndex, part, text }] : []
    }

    if (type === 'reasoning') {
      const text = typeof part.text === 'string' ? part.text : ''
      const isCompleteReasoning = !isMessageRunning || isCompleteStatus(part.status)
      if (!isVisibleAssistantText(text) || !isCompleteReasoning) return []
      return [
        {
          kind: 'entry',
          partIndex,
          part,
          item: {
            id: stringValue(part.id) ?? `reasoning:${partIndex}`,
            type: 'reasoning',
            text
          },
          itemType: 'reasoning'
        }
      ]
    }

    if (type === 'indicator' || type === 'step-start') return []

    if (isToolLikePartType(type)) {
      const toolName = stringValue(part.toolName)
      const item =
        extractThreadItem(part) ?? inferredItemForToolPart(part, toolName, isMessageRunning)
      const itemType = canonicalItemType(typeof item?.type === 'string' ? item.type : undefined)
      return [
        {
          kind: 'tool',
          partIndex,
          part,
          item,
          itemType,
          toolName,
          callId: partCallId(part, item),
          action: multiAgentAction(item),
          mcpSource:
            itemType && MCP_ITEM_TYPES.has(itemType) ? mcpSourceForPart(part, item) : undefined,
          dynamicMetadata:
            itemType && DYNAMIC_ITEM_TYPES.has(itemType)
              ? dynamicMetadataForPart(part, item)
              : undefined
        }
      ]
    }

    const item = extractThreadItem(part)
    const itemType = canonicalItemType(typeof item?.type === 'string' ? item.type : undefined)
    if (item && itemType) {
      return [{ kind: 'entry', partIndex, part, item, itemType }]
    }

    return [{ kind: 'unknown', partIndex, part }]
  })
}

function groupWebSearchAndMultiAgent(parts: readonly NormalizedPart[]): GroupableUnit[] {
  const units: GroupableUnit[] = []
  let webSearchParts: NormalizedPart[] = []

  const flushWebSearch = (): void => {
    if (webSearchParts.length === 0) return
    units.push({
      type: 'web-search-group',
      partIndices: webSearchParts.map((part) => part.partIndex),
      parts: webSearchParts.map((part) => part.part)
    })
    webSearchParts = []
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]

    if (part.kind === 'tool' && WEB_SEARCH_ITEM_TYPES.has(part.itemType ?? '')) {
      webSearchParts.push(part)
      continue
    }

    flushWebSearch()

    if (part.kind === 'tool' && MULTI_AGENT_ITEM_TYPES.has(part.itemType ?? '')) {
      const group = [part]
      const action = part.action
      let nextIndex = index + 1

      while (nextIndex < parts.length) {
        const next = parts[nextIndex]
        if (next?.kind !== 'tool' || !MULTI_AGENT_ITEM_TYPES.has(next.itemType ?? '')) break
        if (next.action !== action) break
        group.push(next)
        nextIndex += 1
      }

      units.push({
        type: 'multi-agent-group',
        partIndices: group.map((part) => part.partIndex),
        parts: group.map((part) => part.part),
        action
      })
      index = nextIndex - 1
      continue
    }

    units.push(normalizedToUnit(part))
  }

  flushWebSearch()
  return units
}

function collapseToolActivity(
  units: readonly GroupableUnit[],
  options: { detailLevel: AssistantRenderDetailLevel }
): GroupableUnit[] {
  const visibleUnits =
    options.detailLevel === 'stepsProse'
      ? units.filter((unit) => !isLowValueStepsProseActivityUnit(unit))
      : units
  const result: GroupableUnit[] = []

  for (let index = 0; index < visibleUnits.length; index += 1) {
    const group = collectConsecutive(visibleUnits, index, isCollapsibleActivityUnit)

    if (group.length === 0) {
      result.push(visibleUnits[index]!)
      continue
    }

    for (const activityGroup of splitActivityRuns(group)) {
      pushCollapsedActivityGroup(result, activityGroup)
    }
    index += group.length - 1
  }

  return result
}

function pushCollapsedActivityGroup(
  result: GroupableUnit[],
  group: readonly GroupableUnit[]
): void {
  if (group.length > 1) {
    result.push({
      type: 'collapsed-tool-activity',
      partIndices: group.flatMap((unit) => [...unit.partIndices]),
      parts: group.flatMap(partsForUnit)
    } as GroupableUnit)
    return
  }

  const first = group[0]
  if (first) result.push(first)
}

function splitActivityRuns(group: readonly GroupableUnit[]): GroupableUnit[][] {
  const runs: GroupableUnit[][] = []
  let current: GroupableUnit[] = []
  let currentActive: boolean | undefined

  for (const unit of group) {
    const active = isGroupableUnitActive(unit)
    if (current.length > 0 && active !== currentActive) {
      runs.push(current)
      current = []
    }
    current.push(unit)
    currentActive = active
  }

  if (current.length > 0) runs.push(current)
  return runs
}

function groupExplorationActivity(units: readonly GroupableUnit[]): GroupableUnit[] {
  const result: GroupableUnit[] = []

  for (let index = 0; index < units.length; index += 1) {
    const first = units[index]
    if (!first || !isExplorationActivityUnit(first)) {
      first && result.push(first)
      continue
    }

    const group = [first]
    let nextIndex = index + 1

    while (nextIndex < units.length) {
      const next = units[nextIndex]
      if (!next || !isExplorationActivityUnit(next)) break
      group.push(next)
      nextIndex += 1
    }

    result.push(explorationUnitFromGroup(group))
    index = nextIndex - 1
  }

  return result
}

function groupDynamicToolCalls(units: readonly GroupableUnit[]): GroupableUnit[] {
  const result: GroupableUnit[] = []

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]
    if (!unit || !isDynamicToolUnit(unit)) {
      unit && result.push(unit)
      continue
    }

    const group: GroupableUnit[] = []
    let nextIndex = index + 1
    group.push(unit)

    while (nextIndex < units.length) {
      const next = units[nextIndex]
      if (!next || !isDynamicToolUnit(next)) break
      if (dynamicMetadataForUnit(next)?.standaloneInConversation === true) break
      group.push(next)
      nextIndex += 1
    }

    const metadata = mergeDynamicMetadata(group)
    if (group.length > 1 || metadata.standaloneInConversation) {
      result.push({
        type: 'dynamic-tool-call-group',
        partIndices: group.flatMap((unit) => [...unit.partIndices]),
        parts: group.flatMap(partsForUnit),
        dynamicMetadata: metadata
      } as GroupableUnit)
    } else {
      result.push(unit)
    }

    index = nextIndex - 1
  }

  return result
}

function groupPendingMcpToolCalls(units: readonly GroupableUnit[]): GroupableUnit[] {
  const result: GroupableUnit[] = []

  for (let index = 0; index < units.length; index += 1) {
    const first = units[index]
    if (!first || !isMcpToolUnit(first)) {
      first && result.push(first)
      continue
    }

    const group = [first]
    const firstKey = mcpGroupKey(first)
    let nextIndex = index + 1

    while (nextIndex < units.length) {
      const next = units[nextIndex]
      if (!next || !isMcpToolUnit(next) || mcpGroupKey(next) !== firstKey) break
      group.push(next)
      nextIndex += 1
    }

    if (group.length > 1 || shouldRenderSingleMcpGroup(first)) {
      result.push({
        type: 'pending-mcp-tool-calls',
        partIndices: group.flatMap((unit) => [...unit.partIndices]),
        parts: group.flatMap(partsForUnit),
        mcpSource: mergeMcpSource(group)
      } as GroupableUnit)
    } else {
      result.push(first)
    }

    index = nextIndex - 1
  }

  return result
}

function assignThinkingOwnership(
  units: readonly AssistantRenderUnit[],
  isRunning: boolean
): AssistantRenderUnit[] {
  if (!isRunning) return units.map((unit) => ({ ...unit, showThinkingFallback: false }))

  const latestIndex = findLatestThinkingEligibleUnitIndex(units)
  return units.map((unit, index) => {
    if (index !== latestIndex) return { ...unit, showThinkingFallback: false }
    if (unit.active) return { ...unit, showThinkingFallback: false }
    return { ...unit, showThinkingFallback: true }
  })
}

function findLatestThinkingEligibleUnitIndex(units: readonly AssistantRenderUnit[]): number {
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]
    if (!unit || unit.type === 'text' || unit.type === 'unknown') return -1
    if (isToolLikeUnit(unit)) return index
  }

  return -1
}

function toRenderUnit(unit: GroupableUnit, index: number): AssistantRenderUnit {
  switch (unit.type) {
    case 'text':
      return {
        type: 'text',
        key: `text:${unit.partIndex}`,
        partIndex: unit.partIndex,
        partIndices: unit.partIndices,
        target: targetForUnit(`text:${unit.partIndex}`, unit),
        text: unit.text,
        showThinkingFallback: false
      }
    case 'unknown':
      return {
        type: 'unknown',
        key: `unknown:${unit.partIndex}`,
        partIndex: unit.partIndex,
        partIndices: unit.partIndices,
        target: targetForUnit(`unknown:${unit.partIndex}`, unit),
        part: unit.part,
        showThinkingFallback: false
      }
    case 'entry': {
      const summary = summarizeToolGroup([unit.part])
      const key = itemKey(unit.item, unit.partIndex, unit.callId)
      return {
        type: 'entry',
        key,
        partIndex: unit.partIndex,
        partIndices: unit.partIndices,
        target: targetForUnit(key, unit),
        part: unit.part,
        item: unit.item,
        itemType: unit.itemType,
        mcpSource: unit.mcpSource,
        renderMode: entryRenderModeFor(unit.itemType),
        summary,
        active: summary.active || isItemActive(unit.item) || isToolPartActive(unit.part),
        showThinkingFallback: false
      }
    }
    case 'collapsed-tool-activity':
    case 'web-search-group': {
      const summary = summarizeToolGroup(unit.parts)
      const key = groupKey(unit, index)
      return {
        type: unit.type,
        key,
        partIndices: unit.partIndices,
        target: targetForUnit(key, unit),
        parts: unit.parts,
        summary,
        active: summary.active || unit.parts.some(isToolPartActive),
        showThinkingFallback: false
      }
    }
    case 'multi-agent-group': {
      const summary = summarizeToolGroup(unit.parts)
      const key = groupKey(unit, index)
      return {
        type: 'multi-agent-group',
        key,
        partIndices: unit.partIndices,
        target: targetForUnit(key, unit),
        parts: unit.parts,
        summary,
        active: summary.active || unit.parts.some(isToolPartActive),
        showThinkingFallback: false,
        action: unit.action
      }
    }
    case 'dynamic-tool-call-group': {
      const summary = summarizeToolGroup(unit.parts)
      const key = groupKey(unit, index)
      return {
        type: 'dynamic-tool-call-group',
        key,
        partIndices: unit.partIndices,
        target: targetForUnit(key, unit),
        parts: unit.parts,
        summary,
        active: summary.active || unit.parts.some(isToolPartActive),
        showThinkingFallback: false,
        dynamicMetadata: unit.dynamicMetadata
      }
    }
    case 'pending-mcp-tool-calls': {
      const summary = summarizeToolGroup(unit.parts)
      const key = groupKey(unit, index)
      return {
        type: 'pending-mcp-tool-calls',
        key,
        partIndices: unit.partIndices,
        target: targetForUnit(key, unit),
        parts: unit.parts,
        summary,
        active: summary.active || unit.parts.some(isToolPartActive),
        showThinkingFallback: false,
        mcpSource: unit.mcpSource
      }
    }
  }
}

function normalizedToUnit(part: NormalizedPart): GroupableUnit {
  if (part.kind === 'text') {
    return {
      type: 'text',
      partIndex: part.partIndex,
      partIndices: [part.partIndex],
      text: part.text
    }
  }

  if (part.kind === 'unknown') {
    return {
      type: 'unknown',
      partIndex: part.partIndex,
      partIndices: [part.partIndex],
      part: part.part
    }
  }

  if (part.kind === 'entry') {
    return {
      type: 'entry',
      partIndex: part.partIndex,
      partIndices: [part.partIndex],
      part: part.part,
      item: part.item,
      itemType: part.itemType
    }
  }

  return {
    type: 'entry',
    partIndex: part.partIndex,
    partIndices: [part.partIndex],
    part: part.part,
    item: part.item,
    itemType: part.itemType,
    toolName: part.toolName,
    callId: part.callId,
    action: part.action,
    mcpSource: part.mcpSource,
    dynamicMetadata: part.dynamicMetadata
  }
}

function collectConsecutive(
  units: readonly GroupableUnit[],
  startIndex: number,
  predicate: (unit: GroupableUnit) => boolean
): GroupableUnit[] {
  const group: GroupableUnit[] = []

  for (let index = startIndex; index < units.length; index += 1) {
    const unit = units[index]
    if (!unit || !predicate(unit)) break
    group.push(unit)
  }

  return group
}

function isCollapsibleActivityUnit(unit: GroupableUnit): boolean {
  if (unit.type === 'web-search-group') return true
  if (unit.type !== 'entry') return false
  if (unit.itemType == null) return true
  return ACTIVITY_ITEM_TYPES.has(unit.itemType)
}

function isLowValueStepsProseActivityUnit(unit: GroupableUnit): boolean {
  if (isGroupableUnitActive(unit) || unit.type !== 'entry') return false
  if (!unit.itemType) return false
  return STEPS_PROSE_HIDDEN_ACTIVITY_TYPES.has(unit.itemType)
}

function isGroupableUnitActive(unit: GroupableUnit): boolean {
  if (unit.type === 'entry') {
    return isToolPartActive(unit.part) || isActiveStatus(unit.item?.status)
  }
  return partsForUnit(unit).some(isToolPartActive)
}

function isExplorationActivityUnit(unit: GroupableUnit): unit is EntryGroupableUnit {
  return unit.type === 'entry' && explorationActionsForUnit(unit).length > 0
}

function explorationUnitFromGroup(group: readonly EntryGroupableUnit[]): GroupableUnit {
  const first = group[0]!
  const actions = group.flatMap(explorationActionsForUnit)
  const items = group.map((unit) => unit.item).filter(isDefined)
  const active = group.some(
    (unit) => isToolPartActive(unit.part) || isActiveStatus(unit.item?.status)
  )
  const firstId =
    stringValue(items[0]?.callId) ?? stringValue(items[0]?.id) ?? String(first.partIndex)

  return {
    type: 'entry',
    partIndex: first.partIndex,
    partIndices: group.flatMap((unit) => [...unit.partIndices]),
    part: first.part,
    item: {
      id: `exploration:${firstId}`,
      type: 'exploration',
      status: active ? 'inProgress' : 'completed',
      actions,
      items
    },
    itemType: 'exploration'
  }
}

function explorationActionsForUnit(unit: EntryGroupableUnit): ExplorationAction[] {
  if (unit.itemType === 'exploration') return []
  if (!isCommandExecutionUnit(unit)) return []

  const itemActions = explorationActionsForItem(unit.item)
  if (itemActions.length > 0) return itemActions

  return explorationActionsFromRecord(recordValue(extractToolInput(unit.part)))
}

function isCommandExecutionUnit(unit: EntryGroupableUnit): boolean {
  return (
    unit.itemType === 'commandExecution' ||
    canonicalItemType(stringValue(unit.item?.type)) === 'commandExecution' ||
    unit.toolName === 'codex_command_execution'
  )
}

function explorationActionsForItem(item: Record<string, unknown> | undefined): ExplorationAction[] {
  const record = recordValue(item)
  if (!record) return []
  return explorationActionsFromRecord(record)
}

function explorationActionsFromRecord(
  record: Record<string, unknown> | undefined
): ExplorationAction[] {
  if (!record) return []

  const commandActions = arrayValue(record.commandActions)
    .map((action) => explorationActionFromRecord(recordValue(action)))
    .filter(isDefined)
  if (commandActions.length > 0) return commandActions

  const parsedCommand = explorationActionFromRecord(recordValue(record.parsedCmd))
  return parsedCommand ? [parsedCommand] : []
}

function explorationActionFromRecord(
  record: Record<string, unknown> | undefined
): ExplorationAction | undefined {
  if (!record) return undefined

  const type = explorationActionKind(stringValue(record.type))
  if (!type) return undefined

  return {
    type,
    label:
      stringValue(record.name) ??
      stringValue(record.label) ??
      stringValue(record.path) ??
      stringValue(record.query) ??
      stringValue(record.command),
    path:
      stringValue(record.path) ??
      stringValue(record.file) ??
      stringValue(record.filename) ??
      stringValue(record.directory),
    query: stringValue(record.query) ?? stringValue(record.pattern),
    command: stringValue(record.command)
  }
}

function explorationActionKind(value: string | undefined): ExplorationActionKind | undefined {
  switch (value) {
    case 'read':
    case 'readFile':
    case 'read_file':
      return 'read'
    case 'list':
    case 'listFiles':
    case 'list_files':
    case 'ls':
      return 'list'
    case 'search':
    case 'searchCode':
    case 'search_code':
    case 'grep':
    case 'rg':
      return 'search'
    default:
      return undefined
  }
}

function isDynamicToolUnit(unit: GroupableUnit): boolean {
  return unit.type === 'entry' && DYNAMIC_ITEM_TYPES.has(unit.itemType ?? '')
}

function isMcpToolUnit(unit: GroupableUnit): boolean {
  return (
    unit.type === 'entry' &&
    MCP_ITEM_TYPES.has(unit.itemType ?? '') &&
    unit.mcpSource?.sourceType !== 'computer-use'
  )
}

function shouldRenderSingleMcpGroup(unit: GroupableUnit): boolean {
  if (unit.type !== 'entry') return false

  const sourceType = unit.mcpSource?.sourceType
  return sourceType !== 'computer-use'
}

function isToolLikeUnit(unit: AssistantRenderUnit): boolean {
  return (
    unit.type === 'entry' ||
    unit.type === 'collapsed-tool-activity' ||
    unit.type === 'pending-mcp-tool-calls' ||
    unit.type === 'dynamic-tool-call-group' ||
    unit.type === 'web-search-group' ||
    unit.type === 'multi-agent-group'
  )
}

function partsForUnit(unit: ToolGroupableUnit): readonly AssistantMessagePart[] {
  if (unit.parts) return unit.parts
  return unit.type === 'entry' ? [unit.part] : []
}

function mcpGroupKey(unit: GroupableUnit): string {
  if (unit.type !== 'entry') return 'unknown'
  return unit.mcpSource?.groupKey ?? 'unknown'
}

function groupKey(unit: GroupableUnit, index: number): string {
  const firstIndex = unit.partIndices[0] ?? index
  if (unit.type === 'multi-agent-group') {
    return `multi-agent-group:${unit.action ?? 'unknown'}:${firstIndex}`
  }
  if (unit.type === 'web-search-group') {
    const firstItem = extractThreadItem(unit.parts[0])
    return `web-search-group:${stringValue(firstItem?.query) ?? firstIndex}:${unit.partIndices.length}`
  }
  if (unit.type === 'pending-mcp-tool-calls') {
    return `pending-mcp-tool-calls:${unit.mcpSource?.groupKey ?? firstIndex}:${unit.partIndices.length}`
  }
  if (unit.type === 'dynamic-tool-call-group') {
    return `dynamic-tool-call-group:${unit.dynamicMetadata?.completedSummaryKey ?? firstIndex}:${unit.partIndices.length}`
  }
  return `${unit.type}:${firstIndex}:${unit.partIndices.length}`
}

function itemKey(
  item: Record<string, unknown> | undefined,
  partIndex: number,
  fallbackCallId?: string
): string {
  const type = canonicalItemType(stringValue(item?.type)) ?? 'tool'
  if (type === 'exploration') return explorationKey(item, partIndex)

  const id = stringValue(item?.id)
  const callId = stringValue(item?.callId) ?? fallbackCallId
  if (id) return `item:${type}:${id}`
  if (callId) return `item:${type}:${callId}`
  return `item:${type}:${partIndex}`
}

function explorationKey(item: Record<string, unknown> | undefined, partIndex: number): string {
  const firstItem = arrayValue(item?.items).map(recordValue).find(isDefined)
  const firstType = canonicalItemType(stringValue(firstItem?.type))
  const callId = stringValue(firstItem?.callId) ?? stringValue(firstItem?.id)

  if (firstType === 'commandExecution' && callId) return `exploration:${callId}`
  const id = stringValue(item?.id)
  if (id) return id
  return `exploration:${firstType ?? `unknown-${partIndex}`}`
}

function isVisibleAssistantText(text: string): boolean {
  return text.trim().length > 0 && text !== pendingAssistantMessageText
}

function isItemActive(item: Record<string, unknown> | undefined): boolean {
  return isActiveStatus(item?.status)
}

function isCompleteStatus(status: unknown): boolean {
  if (status === 'completed' || status === 'complete') return true
  const record = recordValue(status)
  if (!record) return false
  return record.type === 'complete' || record.type === 'completed'
}

function entryRenderModeFor(itemType: string | undefined): EntryRenderMode {
  if (!itemType) return 'tool'
  return ENTRY_ITEM_RENDER_MODES[itemType] ?? 'tool'
}

function targetForUnit(key: string, unit: GroupableUnit): AssistantRenderTarget {
  const itemIds = collectTargetIds(unit)
  return {
    id: domSafeId(`render-unit:${key}`),
    itemIds
  }
}

function collectTargetIds(unit: GroupableUnit): readonly string[] {
  const parts = partsForUnit(unit)
  const ids = new Set<string>()

  for (const part of parts) {
    collectTargetIdsFromPart(part, ids)
  }

  if (unit.type === 'entry') {
    collectTargetIdsFromItem(unit.item, ids)
    addStringToSet(ids, unit.callId)
  }

  return [...ids]
}

function collectTargetIdsFromPart(part: AssistantMessagePart, ids: Set<string>): void {
  addStringToSet(ids, stringValue(part.toolCallId))
  addStringToSet(ids, stringValue(part.id))
  collectTargetIdsFromItem(extractThreadItem(part), ids)
}

function collectTargetIdsFromItem(
  item: Record<string, unknown> | undefined,
  ids: Set<string>
): void {
  if (!item) return
  addStringToSet(ids, stringValue(item.id))
  addStringToSet(ids, stringValue(item.callId))

  for (const child of arrayValue(item.items)) {
    collectTargetIdsFromItem(recordValue(child), ids)
  }
}

function addStringToSet(values: Set<string>, value: string | undefined): void {
  if (value) values.add(value)
}

function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function canonicalItemType(itemType: string | undefined): string | undefined {
  switch (itemType) {
    case 'web-search':
      return 'webSearch'
    case 'mcp-tool-call':
      return 'mcpToolCall'
    case 'dynamic-tool-call':
      return 'dynamicToolCall'
    case 'multi-agent-action':
      return 'multi-agent-action'
    case 'exec':
      return 'commandExecution'
    case 'patch':
      return 'fileChange'
    case 'todo-list':
      return 'todoList'
    case 'user-input-response':
      return 'userInputResponse'
    case 'mcp-server-elicitation':
      return 'mcpServerElicitation'
    case 'permission-request':
      return 'permissionRequest'
    case 'stream-error':
      return 'streamError'
    case 'system-error':
      return 'systemError'
    case 'remote-task-created':
      return 'remoteTaskCreated'
    case 'personality-changed':
      return 'personalityChanged'
    case 'model-changed':
      return 'modelChanged'
    case 'model-rerouted':
      return 'modelRerouted'
    case 'subagent-activity':
      return 'subAgentActivity'
    case 'context-compaction':
      return 'contextCompaction'
    case 'worktree-init':
      return 'worktreeInit'
    case 'automation-update':
      return 'automationUpdate'
    case 'hook-prompt':
      return 'hookPrompt'
    case 'automatic-approval-review':
      return 'automaticApprovalReview'
    case 'turn-diff':
      return 'turnDiff'
    case 'generated-image':
      return 'imageGeneration'
    case 'review-comments':
      return 'reviewComments'
    case 'loaded-tool':
      return 'loadedTool'
    default:
      return itemType
  }
}

function inferredItemForToolPart(
  part: AssistantMessagePart,
  toolName: string | undefined,
  isMessageRunning: boolean
): Record<string, unknown> | undefined {
  if (toolName !== 'codex_web_search') return undefined
  if (!isMessageRunning && !isToolPartActive(part)) return undefined

  const input = extractToolInput(part)
  const query = webSearchQueryFromInput(input)
  const action = webSearchActionFromInput(input) ?? (query ? { type: 'search' } : undefined)

  return {
    id: stringValue(part.toolCallId) ?? stringValue(part.id) ?? 'web-search',
    type: 'webSearch',
    status: isToolPartActive(part) ? 'inProgress' : 'completed',
    ...(query ? { query } : {}),
    ...(action ? { action } : {})
  }
}

function webSearchQueryFromInput(input: unknown): string | undefined {
  const record = recordValue(input)
  if (!record) return undefined

  const directQuery = stringValue(record.query)
  if (directQuery) return directQuery

  const action = recordValue(record.action)
  const actionQuery = stringValue(action?.query)
  if (actionQuery) return actionQuery

  const firstSearchQuery = arrayValue(record.search_query).map(recordValue).find(isDefined)
  const searchQuery = stringValue(firstSearchQuery?.q) ?? stringValue(firstSearchQuery?.query)
  if (searchQuery) return searchQuery

  const commands = recordValue(record.commands)
  const commandSearchQuery = arrayValue(commands?.search_query).map(recordValue).find(isDefined)
  return stringValue(commandSearchQuery?.q) ?? stringValue(commandSearchQuery?.query)
}

function webSearchActionFromInput(input: unknown): unknown {
  const record = recordValue(input)
  if (!record) return undefined
  return record.action ?? record.actionType
}

function isToolLikePartType(type: string | undefined): boolean {
  return type === 'tool-call' || type === 'dynamic-tool'
}

function partCallId(
  part: AssistantMessagePart,
  item: Record<string, unknown> | undefined
): string | undefined {
  return stringValue(item?.callId) ?? stringValue(item?.id) ?? stringValue(part.toolCallId)
}

function multiAgentAction(item: Record<string, unknown> | undefined): string | undefined {
  return (
    stringValue(item?.action) ??
    stringValue(recordValue(item?.metadata)?.action) ??
    stringValue(recordValue(item?.display)?.action)
  )
}

function dynamicMetadataForPart(
  part: AssistantMessagePart,
  item: Record<string, unknown> | undefined
): DynamicToolMetadata {
  const registry = firstRecord(
    item?.registryMetadata,
    item?.displayMetadata,
    item?.dynamicTool,
    item?.toolRegistration,
    recordValue(part.result)?.metadata,
    recordValue(part.output)?.metadata
  )

  return {
    summaryOnlyInConversationGroup: booleanValue(registry?.summaryOnlyInConversationGroup),
    standaloneInConversation: booleanValue(registry?.standaloneInConversation),
    continuesLiveActivityBetweenCalls: booleanValue(registry?.continuesLiveActivityBetweenCalls),
    completedSummaryKey:
      stringValue(registry?.completedSummaryKey) ??
      stringValue(item?.completedSummaryKey) ??
      stringValue(item?.summaryKey),
    repeatCount: numberValue(item?.repeatCount) ?? 1,
    hasRegistryMetadata: registry !== undefined
  }
}

function dynamicMetadataForUnit(unit: GroupableUnit): DynamicToolMetadata | undefined {
  return unit.type === 'entry' ? unit.dynamicMetadata : undefined
}

function mergeDynamicMetadata(group: readonly GroupableUnit[]): DynamicToolMetadata {
  const metadata = group.map(dynamicMetadataForUnit).filter(isDefined)
  const first = metadata[0]
  const completedSummaryKey =
    first?.completedSummaryKey ??
    metadata.find((item) => item.completedSummaryKey)?.completedSummaryKey
  const repeatedCount =
    completedSummaryKey == null
      ? group.length
      : metadata.filter((item) => item.completedSummaryKey === completedSummaryKey).length

  return {
    summaryOnlyInConversationGroup: metadata.some((item) => item.summaryOnlyInConversationGroup),
    standaloneInConversation: first?.standaloneInConversation ?? false,
    continuesLiveActivityBetweenCalls: metadata.some(
      (item) => item.continuesLiveActivityBetweenCalls
    ),
    completedSummaryKey,
    repeatCount: Math.max(repeatedCount, ...metadata.map((item) => item.repeatCount)),
    hasRegistryMetadata: metadata.some((item) => item.hasRegistryMetadata)
  }
}

function mcpSourceForPart(
  part: AssistantMessagePart,
  item: Record<string, unknown> | undefined
): McpSourceMetadata {
  const invocation = recordValue(item?.invocation)
  const appContext = recordValue(item?.appContext)
  const toolName = stringValue(part.toolName)
  const parsedToolName = parseMcpToolName(toolName)
  const server =
    stringValue(item?.server) ?? stringValue(invocation?.server) ?? parsedToolName?.server
  const connectorId = stringValue(appContext?.connectorId) ?? stringValue(appContext?.id)
  const resourceUri = stringValue(appContext?.resourceUri) ?? stringValue(item?.mcpAppResourceUri)
  const pluginId = stringValue(item?.pluginId)
  const appKey = connectorId ?? resourceUri ?? pluginId
  const appLabel =
    stringValue(appContext?.displayName) ??
    stringValue(appContext?.appName) ??
    stringValue(appContext?.name)
  const tool =
    stringValue(item?.tool) ?? stringValue(invocation?.tool) ?? parsedToolName?.tool ?? toolName
  const sourceType = mcpSourceType(server, toolName, appKey, appLabel)
  const label = mcpSourceLabel({ sourceType, appLabel, server, tool })
  const groupKey = mcpSourceGroupKey({
    sourceType,
    connectorId,
    resourceUri,
    pluginId,
    server,
    toolName
  })

  return {
    groupKey,
    sourceType,
    label,
    server,
    appKey,
    resourceUri,
    pluginId,
    toolName: tool,
    callIds: [partCallId(part, item)].filter(isDefined),
    hasAppMetadata: appKey !== undefined || appLabel !== undefined
  }
}

function mergeMcpSource(group: readonly GroupableUnit[]): McpSourceMetadata | undefined {
  const sources = group
    .map((unit) => (unit.type === 'entry' ? unit.mcpSource : undefined))
    .filter(isDefined)
  const first = sources[0]
  if (!first) return undefined

  return {
    ...first,
    callIds: [...new Set(sources.flatMap((source) => source.callIds))]
  }
}

function parseMcpToolName(
  toolName: string | undefined
): { server?: string; tool?: string } | undefined {
  if (!toolName?.startsWith('mcp:')) return undefined
  const body = toolName.slice('mcp:'.length)
  const slashIndex = body.indexOf('/')
  if (slashIndex < 0) return { server: body }
  return {
    server: body.slice(0, slashIndex) || undefined,
    tool: body.slice(slashIndex + 1) || undefined
  }
}

function mcpSourceType(
  server: string | undefined,
  toolName: string | undefined,
  appKey: string | undefined,
  appLabel: string | undefined
): McpSourceMetadata['sourceType'] {
  const haystack = `${server ?? ''} ${toolName ?? ''}`.toLowerCase()
  if (haystack.includes('computer-use')) return 'computer-use'
  if (haystack.includes('node_repl') || haystack.includes('node-repl')) return 'node-repl'
  if (haystack.includes('browser')) return 'browser'
  if (appKey || appLabel) return 'app'
  return 'server'
}

function mcpSourceGroupKey({
  sourceType,
  connectorId,
  resourceUri,
  pluginId,
  server,
  toolName
}: {
  sourceType: McpSourceMetadata['sourceType']
  connectorId?: string
  resourceUri?: string
  pluginId?: string
  server?: string
  toolName?: string
}): string {
  if (sourceType === 'app') {
    if (connectorId) return `app:${connectorId}`
    if (resourceUri) return `resource:${resourceUri}`
    if (pluginId) return `plugin:${pluginId}`
  }

  return `${sourceType}:${server ?? toolName ?? 'unknown'}`
}

function mcpSourceLabel({
  sourceType,
  appLabel,
  server,
  tool
}: {
  sourceType: McpSourceMetadata['sourceType']
  appLabel?: string
  server?: string
  tool?: string
}): string {
  if (sourceType === 'browser') return 'Browser'
  if (sourceType === 'computer-use') return 'Computer Use'
  if (sourceType === 'node-repl') return 'Node REPL'
  if (appLabel) return appLabel
  if (server) return server
  return tool ?? 'MCP'
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find((value): value is Record<string, unknown> => recordValue(value) !== undefined)
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
