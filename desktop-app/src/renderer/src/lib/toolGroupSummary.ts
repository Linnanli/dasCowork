type ToolGroupCounterKey =
  | 'readFiles'
  | 'listFiles'
  | 'searchCode'
  | 'runCommands'
  | 'createFolders'
  | 'createFiles'
  | 'editFiles'
  | 'deleteFiles'
  | 'webSearches'
  | 'mcpTools'
  | 'subAgentActivities'
  | 'imageViews'
  | 'contextCompactions'
  | 'hookPrompts'
  | 'reviewModeChanges'
  | 'loadedTools'
  | 'sleeps'
  | 'approvalDenied'
  | 'approvalTimedOut'
  | 'approvalApproved'
  | 'approvalInProgress'
  | 'genericTools'

export type ToolGroupIconName =
  | 'read-files'
  | 'list-files'
  | 'code-searching'
  | 'run-command'
  | 'edit-files'
  | 'web-search'
  | 'mcp-tools'
  | 'sub-agent'
  | 'image-view'
  | 'context-compaction'
  | 'hook-prompt'
  | 'review-mode'
  | 'generic-tool'

type ToolGroupCounter = {
  active: number
  completed: number
}

export type ToolGroupSummary = {
  label?: string
  icon?: ToolGroupIconName
  active: boolean
  count: number
  expandable: boolean
  sourceSummary?: string
}

type ToolGroupSummaryState = Record<ToolGroupCounterKey, ToolGroupCounter>

type ToolPartRecord = Record<string, unknown>

type CounterLabels = {
  active: string
  completed: string
  unit: string
}

const counterKeys: ToolGroupCounterKey[] = [
  'readFiles',
  'listFiles',
  'searchCode',
  'runCommands',
  'createFolders',
  'createFiles',
  'editFiles',
  'deleteFiles',
  'webSearches',
  'mcpTools',
  'subAgentActivities',
  'imageViews',
  'contextCompactions',
  'hookPrompts',
  'reviewModeChanges',
  'loadedTools',
  'sleeps',
  'approvalDenied',
  'approvalTimedOut',
  'approvalApproved',
  'approvalInProgress',
  'genericTools'
]

const counterLabels: Record<ToolGroupCounterKey, CounterLabels> = {
  readFiles: { active: '正在读取', completed: '已读取', unit: '个文件' },
  listFiles: { active: '正在列出', completed: '已列出', unit: '个目录' },
  searchCode: { active: '正在搜索', completed: '已搜索', unit: '次代码' },
  runCommands: { active: '正在运行', completed: '已运行', unit: '条命令' },
  createFolders: { active: '正在创建', completed: '已创建', unit: '个文件夹' },
  createFiles: { active: '正在创建', completed: '已创建', unit: '个文件' },
  editFiles: { active: '正在编辑', completed: '已编辑', unit: '个文件' },
  deleteFiles: { active: '正在删除', completed: '已删除', unit: '个文件' },
  webSearches: { active: '正在搜索', completed: '已搜索', unit: '次网页' },
  mcpTools: { active: '正在调用', completed: '已调用', unit: '个 MCP 工具' },
  subAgentActivities: { active: '正在更新', completed: '已更新', unit: '次子任务' },
  imageViews: { active: '正在查看', completed: '已查看', unit: '张图片' },
  contextCompactions: { active: '正在压缩', completed: '已压缩', unit: '次上下文' },
  hookPrompts: { active: '正在读取', completed: '已读取', unit: '条项目指令' },
  reviewModeChanges: { active: '正在切换', completed: '已切换', unit: '次审查模式' },
  loadedTools: { active: '正在加载', completed: '已加载', unit: '个工具定义' },
  sleeps: { active: '正在等待', completed: '已等待', unit: '次' },
  approvalDenied: { active: '正在审核', completed: '已拒绝', unit: '次自动审批' },
  approvalTimedOut: { active: '正在等待', completed: '已超时', unit: '次自动审批' },
  approvalApproved: { active: '正在审核', completed: '已通过', unit: '次自动审批' },
  approvalInProgress: { active: '正在审核', completed: '已审核', unit: '次自动审批' },
  genericTools: { active: '正在调用', completed: '已调用', unit: '个工具' }
}

const CODEX_PROVIDER_ID = '@janole/ai-sdk-provider-codex-asp'

export function summarizeToolGroup(parts: readonly unknown[]): ToolGroupSummary {
  const state = createSummaryState()
  let knownPartCount = 0
  const sourceNames = new Set<string>()

  for (const part of parts) {
    if (!isRecord(part)) continue

    const item = extractThreadItem(part)
    if (item) {
      knownPartCount += 1
      addSourceName(sourceNames, item, part)
      addThreadItemToSummary(state, item, isToolPartActive(part))
      continue
    }

    if (addToolInputToSummary(state, part)) {
      knownPartCount += 1
      addSourceName(sourceNames, undefined, part)
    }
  }

  const active = hasActiveCounters(state) || parts.some(isToolPartActive)

  if (knownPartCount === 0 && parts.length > 0) {
    addCounter(state, 'genericTools', active, parts.length)
  }

  return {
    label: renderSummaryLabel(state),
    icon: renderSummaryIcon(state),
    active,
    count: knownPartCount || parts.length,
    expandable: parts.length > 0,
    sourceSummary: renderSourceSummary(sourceNames)
  }
}

function createSummaryState(): ToolGroupSummaryState {
  return Object.fromEntries(
    counterKeys.map((key) => [key, { active: 0, completed: 0 }])
  ) as ToolGroupSummaryState
}

function addThreadItemToSummary(
  state: ToolGroupSummaryState,
  item: ToolPartRecord,
  partActive: boolean
): void {
  const type = canonicalItemType(stringValue(item.type))
  const active = partActive || isActiveStatus(item.status)

  switch (type) {
    case 'commandExecution':
      addCommandActionsToSummary(state, arrayValue(item.commandActions), active)
      break
    case 'fileChange':
      addFileChangesToSummary(state, arrayValue(item.changes), active)
      break
    case 'webSearch':
      addCounter(state, 'webSearches', active)
      break
    case 'mcpToolCall':
      addCounter(state, 'mcpTools', active)
      break
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'collabToolCall':
    case 'multi-agent-action':
      addCounter(state, 'genericTools', active)
      break
    case 'subAgentActivity':
      addCounter(state, 'subAgentActivities', active)
      break
    case 'imageView':
      addCounter(state, 'imageViews', active)
      break
    case 'contextCompaction':
      addCounter(state, 'contextCompactions', active)
      break
    case 'hookPrompt':
      addCounter(state, 'hookPrompts', active)
      break
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      addCounter(state, 'reviewModeChanges', active)
      break
    case 'loadedTool':
      addCounter(state, 'loadedTools', active)
      break
    case 'sleep':
      addCounter(state, 'sleeps', active)
      break
    case 'automaticApprovalReview':
      addAutomaticApprovalToSummary(state, item, active)
      break
    default:
      addCounter(state, 'genericTools', active)
      break
  }
}

function addToolInputToSummary(state: ToolGroupSummaryState, part: ToolPartRecord): boolean {
  const toolName = stringValue(part.toolName)
  const input = extractToolInput(part)
  const active = isToolPartActive(part) || (isRecord(input) && isActiveStatus(input.status))

  if (toolName === 'codex_command_execution') {
    const commandActions = isRecord(input) ? arrayValue(input.commandActions) : []
    addCommandActionsToSummary(state, commandActions, active)
    return true
  }

  if (toolName === 'codex_file_change') {
    const changes = isRecord(input) ? arrayValue(input.changes) : []
    addFileChangesToSummary(state, changes, active)
    return true
  }

  if (toolName === 'codex_web_search') {
    addCounter(state, 'webSearches', active)
    return true
  }

  if (toolName?.startsWith('mcp:')) {
    addCounter(state, 'mcpTools', active)
    return true
  }

  if (toolName === 'codex_sub_agent_activity') {
    addCounter(state, 'subAgentActivities', active)
    return true
  }

  if (toolName === 'codex_image_view') {
    addCounter(state, 'imageViews', active)
    return true
  }

  if (toolName === 'codex_context_compaction') {
    addCounter(state, 'contextCompactions', active)
    return true
  }

  if (toolName === 'codex_hook_prompt') {
    addCounter(state, 'hookPrompts', active)
    return true
  }

  if (toolName === 'codex_review_mode_entered' || toolName === 'codex_review_mode_exited') {
    addCounter(state, 'reviewModeChanges', active)
    return true
  }

  if (toolName === 'codex_loaded_tool') {
    addCounter(state, 'loadedTools', active)
    return true
  }

  if (toolName === 'codex_sleep') {
    addCounter(state, 'sleeps', active)
    return true
  }

  if (toolName === 'codex_automatic_approval_review') {
    addAutomaticApprovalToSummary(state, isRecord(input) ? input : part, active)
    return true
  }

  if (toolName) {
    addCounter(state, 'genericTools', active)
    return true
  }

  return false
}

function addCommandActionsToSummary(
  state: ToolGroupSummaryState,
  commandActions: readonly unknown[],
  active: boolean
): void {
  if (commandActions.length === 0) {
    addCounter(state, 'runCommands', active)
    return
  }

  for (const action of commandActions) {
    if (!isRecord(action)) {
      addCounter(state, 'runCommands', active)
      continue
    }

    switch (action.type) {
      case 'read':
        addCounter(state, 'readFiles', active)
        break
      case 'listFiles':
        addCounter(state, 'listFiles', active)
        break
      case 'search':
        addCounter(state, 'searchCode', active)
        break
      case 'createFolder':
      case 'mkdir':
        addCounter(state, 'createFolders', active)
        break
      default:
        addCounter(state, 'runCommands', active)
        break
    }
  }
}

function addAutomaticApprovalToSummary(
  state: ToolGroupSummaryState,
  item: ToolPartRecord,
  active: boolean
): void {
  const outcome =
    stringValue(item.outcome) ?? stringValue(item.result) ?? stringValue(item.decision)

  if (outcome === 'denied' || outcome === 'rejected') {
    addCounter(state, 'approvalDenied', active)
    return
  }

  if (outcome === 'timedOut' || outcome === 'timed-out' || outcome === 'timeout') {
    addCounter(state, 'approvalTimedOut', active)
    return
  }

  if (outcome === 'approved' || outcome === 'allowed') {
    addCounter(state, 'approvalApproved', active)
    return
  }

  if (outcome === 'inProgress' || outcome === 'in-progress' || active) {
    addCounter(state, 'approvalInProgress', true)
    return
  }

  addCounter(state, 'genericTools', active)
}

function addFileChangesToSummary(
  state: ToolGroupSummaryState,
  changes: readonly unknown[],
  active: boolean
): void {
  if (changes.length === 0) {
    addCounter(state, 'editFiles', active)
    return
  }

  for (const change of changes) {
    const kind = isRecord(change) && isRecord(change.kind) ? change.kind.type : undefined

    switch (kind) {
      case 'add':
        addCounter(state, 'createFiles', active)
        break
      case 'delete':
        addCounter(state, 'deleteFiles', active)
        break
      default:
        addCounter(state, 'editFiles', active)
        break
    }
  }
}

function addCounter(
  state: ToolGroupSummaryState,
  key: ToolGroupCounterKey,
  active: boolean,
  amount = 1
): void {
  const counter = state[key]
  if (active) {
    counter.active += amount
  } else {
    counter.completed += amount
  }
}

function renderSummaryLabel(state: ToolGroupSummaryState): string | undefined {
  const segments = counterKeys.flatMap((key) => {
    const counter = state[key]
    const labels = counterLabels[key]
    const rendered: string[] = []

    if (counter.active > 0) {
      rendered.push(`${labels.active} ${counter.active} ${labels.unit}`)
    }

    if (counter.completed > 0) {
      rendered.push(`${labels.completed} ${counter.completed} ${labels.unit}`)
    }

    return rendered
  })

  return segments.length > 0 ? segments.join('，') : undefined
}

function renderSummaryIcon(state: ToolGroupSummaryState): ToolGroupIconName | undefined {
  if (counterTotal(state.webSearches) > 0) return 'web-search'
  if (counterTotal(state.searchCode) > 0) return 'code-searching'
  if (counterTotal(state.listFiles) > 0) return 'list-files'
  if (counterTotal(state.readFiles) > 0) return 'read-files'

  const fileChangeCount =
    counterTotal(state.createFolders) +
    counterTotal(state.createFiles) +
    counterTotal(state.editFiles) +
    counterTotal(state.deleteFiles)
  if (fileChangeCount > 0) return 'edit-files'

  if (counterTotal(state.runCommands) > 0) return 'run-command'
  if (counterTotal(state.mcpTools) > 0) return 'mcp-tools'
  if (counterTotal(state.subAgentActivities) > 0) return 'sub-agent'
  if (counterTotal(state.imageViews) > 0) return 'image-view'
  if (counterTotal(state.contextCompactions) > 0) return 'context-compaction'
  if (counterTotal(state.hookPrompts) > 0) return 'hook-prompt'
  if (counterTotal(state.reviewModeChanges) > 0) return 'review-mode'
  if (counterTotal(state.loadedTools) > 0) return 'generic-tool'
  if (counterTotal(state.sleeps) > 0) return 'generic-tool'
  if (
    counterTotal(state.approvalDenied) > 0 ||
    counterTotal(state.approvalTimedOut) > 0 ||
    counterTotal(state.approvalApproved) > 0 ||
    counterTotal(state.approvalInProgress) > 0
  ) {
    return 'review-mode'
  }
  if (counterTotal(state.genericTools) > 0) return 'generic-tool'

  return undefined
}

function counterTotal(counter: ToolGroupCounter): number {
  return counter.active + counter.completed
}

export function extractThreadItem(part: unknown): ToolPartRecord | undefined {
  if (!isRecord(part)) return undefined

  const resultItem = recordProperty(part.result, 'item')
  if (resultItem && typeof resultItem.type === 'string') return resultItem

  const outputItem = recordProperty(part.output, 'item')
  if (outputItem && typeof outputItem.type === 'string') return outputItem

  const result = recordValue(part.result)
  if (result && typeof result.type === 'string') return result

  const output = recordValue(part.output)
  if (output && typeof output.type === 'string') return output

  const providerMetadata = recordValue(part.providerMetadata)
  const codexMetadata = recordValue(providerMetadata?.[CODEX_PROVIDER_ID])
  const providerItem = recordValue(codexMetadata?.item)
  if (providerItem && typeof providerItem.type === 'string') return providerItem

  return undefined
}

function addSourceName(
  sourceNames: Set<string>,
  item: ToolPartRecord | undefined,
  part: ToolPartRecord
): void {
  const invocation = recordValue(item?.invocation)
  const appContext = recordValue(item?.appContext)
  const appName =
    stringValue(appContext?.displayName) ??
    stringValue(appContext?.appName) ??
    stringValue(appContext?.name)
  const source = recordValue(item?.source)
  const sourceName =
    appName ??
    stringValue(item?.server) ??
    stringValue(invocation?.server) ??
    stringValue(source?.type) ??
    mcpServerFromToolName(stringValue(part.toolName))

  if (sourceName) sourceNames.add(sourceName)
}

function renderSourceSummary(sourceNames: Set<string>): string | undefined {
  const names = [...sourceNames]
  if (names.length === 0) return undefined
  if (names.length === 1) return names[0]
  return `${names[0]} 等 ${names.length} 个来源`
}

function mcpServerFromToolName(toolName: string | undefined): string | undefined {
  if (!toolName?.startsWith('mcp:')) return undefined
  const body = toolName.slice('mcp:'.length)
  return body.split('/')[0] || undefined
}

function canonicalItemType(itemType: string | undefined): string | undefined {
  switch (itemType) {
    case 'web-search':
      return 'webSearch'
    case 'mcp-tool-call':
      return 'mcpToolCall'
    case 'dynamic-tool-call':
      return 'dynamicToolCall'
    case 'exec':
      return 'commandExecution'
    case 'patch':
      return 'fileChange'
    case 'subagent-activity':
      return 'subAgentActivity'
    case 'context-compaction':
      return 'contextCompaction'
    case 'hook-prompt':
      return 'hookPrompt'
    case 'automatic-approval-review':
      return 'automaticApprovalReview'
    case 'loaded-tool':
      return 'loadedTool'
    default:
      return itemType
  }
}

function extractToolInput(part: ToolPartRecord): unknown {
  if (part.input !== undefined) return parseJsonIfNeeded(part.input)
  if (part.args !== undefined) return parseJsonIfNeeded(part.args)
  if (part.argsText !== undefined) return parseJsonIfNeeded(part.argsText)
  return undefined
}

export function isToolPartActive(part: unknown): boolean {
  if (!isRecord(part)) return false

  if (isActiveStatus(part.status)) return true
  if (part.preliminary === true) return true

  return isActiveToolState(part.state)
}

function isActiveToolState(state: unknown): boolean {
  return (
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-requested' ||
    state === 'approval-responded'
  )
}

export function isActiveStatus(status: unknown): boolean {
  if (status === 'inProgress' || status === 'running') return true
  if (!isRecord(status)) return false
  return (
    status.type === 'inProgress' || status.type === 'running' || status.type === 'requires-action'
  )
}

function hasActiveCounters(state: ToolGroupSummaryState): boolean {
  return counterKeys.some((key) => state[key].active > 0)
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function recordProperty(value: unknown, key: string): ToolPartRecord | undefined {
  const record = recordValue(value)
  return recordValue(record?.[key])
}

function recordValue(value: unknown): ToolPartRecord | undefined {
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseJsonIfNeeded(value: unknown): unknown {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isRecord(value: unknown): value is ToolPartRecord {
  return typeof value === 'object' && value !== null
}
