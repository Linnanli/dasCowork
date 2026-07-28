import { z } from 'zod'

export type CodexApprovalKind =
  | 'command'
  | 'file-change'
  | 'tool-user-input'
  | 'permission-request'
  | 'mcp-elicitation'

export type CodexApprovalContext = {
  threadId?: string
  turnId?: string
  hostId?: string
  cwd?: string
  projectLabel?: string
}

export type CodexCommandApprovalIntent =
  | 'approve'
  | 'approveForSession'
  | 'approveWithExecpolicyAmendment'
  | 'applyNetworkPolicyAmendment'
  | 'decline'
  | 'cancel'

export type CodexCommandApprovalParams = {
  threadId?: string
  turnId?: string
  itemId?: string
  approvalId?: string
  startedAtMs?: number
  environmentId?: string | null
  reason?: string
  command?: string
  cwd?: string
  networkTarget?: {
    host: string
    protocol?: string
  }
  networkPolicyScopes: Array<{
    host: string
    action?: string
  }>
  requestedPermissions?: CodexPermissionDetails
  availableIntents: CodexCommandApprovalIntent[]
}

export type CodexPermissionAccess = 'read' | 'write' | 'read-write' | 'deny' | 'connect'
export type CodexPermissionResource = 'network' | 'path' | 'glob' | 'special'

/**
 * A display-only projection of a permission request.  The original profile
 * deliberately remains in Main so a renderer cannot add paths or hosts.
 */
export type CodexPermissionDetail = {
  resource: CodexPermissionResource
  access: CodexPermissionAccess
  value: string
  globScanMaxDepth?: number
}

export type CodexPermissionDetails =
  | { supported: true; details: CodexPermissionDetail[] }
  | { supported: false; reasonCode: 'empty' | 'unsupported' | 'invalid-glob-depth' }

export type CodexPermissionRequestParams = {
  threadId?: string
  turnId?: string
  itemId?: string
  startedAtMs?: number
  environmentId?: string | null
  cwd?: string
  reason?: string
  details: CodexPermissionDetails
  availableScopes: Array<'turn' | 'session'>
}

export type CodexFileChangeSummary = {
  path: string
  kind?: 'add' | 'delete' | 'update'
  diff?: string
}

export type CodexFileChangeApprovalIntent = 'approve' | 'approveForSession' | 'decline' | 'cancel'

export type CodexFileChangeApprovalParams = {
  threadId?: string
  turnId?: string
  itemId?: string
  startedAtMs?: number
  reason?: string
  changes: CodexFileChangeSummary[]
  stats: {
    files: number
    additions?: number
    deletions?: number
  }
  availableIntents: CodexFileChangeApprovalIntent[]
}

export type CodexToolUserInputQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: Array<{ label: string; description: string }> | null
}

export type CodexToolUserInputParams = {
  threadId?: string
  turnId?: string
  itemId?: string
  startedAtMs?: number
  autoResolutionMs: number | null
  /** An epoch deadline supplied by Main; it never restarts after a refresh. */
  deadlineAtMs?: number
  autoResolutionSnoozed?: boolean
  questions: CodexToolUserInputQuestion[]
}

export type CodexMcpFormValue = string | number | boolean | string[]

export type CodexMcpFormField = {
  name: string
  label: string
  description?: string
  kind: 'text' | 'number' | 'boolean' | 'single-select' | 'multi-select'
  required: boolean
  default?: CodexMcpFormValue
  options?: Array<{ value: string; label: string }>
  integer?: boolean
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  format?: 'email' | 'uri' | 'date' | 'date-time'
  imageOptions?: Array<{ value: string; label: string; imageDataUrl: string }>
}

export type CodexMcpFormSupport =
  | { supported: true; fields: CodexMcpFormField[] }
  | { supported: false; reasonCode: 'invalid-schema' | 'unsupported-schema' }

export type CodexMcpElicitationParams =
  | {
      threadId?: string
      turnId?: string | null
      serverName: string
      mode: 'form'
      message: string
      form: CodexMcpFormSupport
    }
  | {
      threadId?: string
      turnId?: string | null
      serverName: string
      mode: 'openai/form'
      message: string
      form: CodexMcpFormSupport
    }
  | {
      threadId?: string
      turnId?: string | null
      serverName: string
      mode: 'url'
      message: string
      url: string
      elicitationId: string
    }

export type CodexApprovalRequest =
  | {
      id: string
      kind: 'command'
      params: CodexCommandApprovalParams
      createdAt: string
      context?: CodexApprovalContext
    }
  | {
      id: string
      kind: 'file-change'
      params: CodexFileChangeApprovalParams
      createdAt: string
      context?: CodexApprovalContext
    }
  | {
      id: string
      kind: 'tool-user-input'
      params: CodexToolUserInputParams
      createdAt: string
      context?: CodexApprovalContext
    }
  | {
      id: string
      kind: 'permission-request'
      params: CodexPermissionRequestParams
      createdAt: string
      context?: CodexApprovalContext
    }
  | {
      id: string
      kind: 'mcp-elicitation'
      params: CodexMcpElicitationParams
      createdAt: string
      context?: CodexApprovalContext
    }

export type CodexApprovalResponse =
  | { action: 'approve' }
  | { action: 'approveForSession' }
  | { action: 'approveWithExecpolicyAmendment' }
  | { action: 'applyNetworkPolicyAmendment' }
  | { action: 'decline'; reason?: string }
  | { action: 'cancel' }
  | { action: 'approvePermissions'; scope: 'turn' | 'session' }
  | { action: 'answer'; answers: Record<string, string[]> }
  | { action: 'submitMcpForm'; values: Record<string, CodexMcpFormValue> }

export const codexApprovalResponseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('approveForSession') }),
  z.object({ action: z.literal('approveWithExecpolicyAmendment') }),
  z.object({ action: z.literal('applyNetworkPolicyAmendment') }),
  z.object({ action: z.literal('decline'), reason: z.string().optional() }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('approvePermissions'), scope: z.enum(['turn', 'session']) }),
  z.object({ action: z.literal('answer'), answers: z.record(z.string(), z.array(z.string())) }),
  z.object({
    action: z.literal('submitMcpForm'),
    values: z.record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())])
    )
  })
]) satisfies z.ZodType<CodexApprovalResponse>

export function createRendererSafeApprovalParams(
  kind: CodexApprovalKind,
  params: unknown
): CodexApprovalRequest['params'] {
  if (kind === 'command') return createCommandApprovalParams(params)
  if (kind === 'file-change') return createFileChangeApprovalParams(params)
  if (kind === 'tool-user-input') return createToolUserInputParams(params)
  if (kind === 'permission-request') return createPermissionRequestParams(params)
  return createMcpElicitationParams(params)
}

function createCommandApprovalParams(params: unknown): CodexCommandApprovalParams {
  const record = asRecord(params)
  const availableIntents = commandApprovalIntents(record)

  return pruneUndefined({
    threadId: stringValue(record?.threadId),
    turnId: stringValue(record?.turnId),
    itemId: stringValue(record?.itemId),
    approvalId: nullableStringValue(record?.approvalId) ?? undefined,
    startedAtMs: finiteNumberValue(record?.startedAtMs),
    environmentId:
      record && 'environmentId' in record ? nullableStringValue(record.environmentId) : undefined,
    reason: nullableStringValue(record?.reason) ?? undefined,
    command: nullableStringValue(record?.command) ?? undefined,
    cwd: nullableStringValue(record?.cwd) ?? undefined,
    networkTarget: toSafeNetworkTarget(record?.networkApprovalContext),
    networkPolicyScopes: arrayValue(record?.proposedNetworkPolicyAmendments).flatMap(
      toSafeNetworkPolicyScope
    ),
    requestedPermissions:
      record?.additionalPermissions === null || record?.additionalPermissions === undefined
        ? undefined
        : compilePermissionDetails(record.additionalPermissions),
    availableIntents
  })
}

function createFileChangeApprovalParams(params: unknown): CodexFileChangeApprovalParams {
  const record = asRecord(params)
  const changes = arrayValue(record?.changes).flatMap(toSafeFileChange)
  const hasSessionGrant = Boolean(nullableStringValue(record?.grantRoot))
  return {
    ...pruneUndefined({
      threadId: stringValue(record?.threadId),
      turnId: stringValue(record?.turnId),
      itemId: stringValue(record?.itemId),
      startedAtMs: finiteNumberValue(record?.startedAtMs),
      reason: nullableStringValue(record?.reason) ?? undefined
    }),
    changes,
    stats: toSafeFileChangeStats(record?.stats, changes),
    availableIntents:
      hasSessionGrant && changes.length > 0
        ? ['approve', 'decline', 'cancel', 'approveForSession']
        : ['approve', 'decline', 'cancel']
  }
}

function commandApprovalIntents(
  record: Record<string, unknown> | undefined
): CodexCommandApprovalIntent[] {
  if (
    !record ||
    !('availableDecisions' in record) ||
    record.availableDecisions === undefined ||
    record.availableDecisions === null
  ) {
    return legacyCommandApprovalIntents(record)
  }
  if (!Array.isArray(record.availableDecisions)) return []

  const intents = record.availableDecisions.map(commandApprovalIntentFromDecision)
  if (intents.some((intent) => intent === undefined)) return []
  return [...new Set(intents as CodexCommandApprovalIntent[])]
}

function legacyCommandApprovalIntents(
  record: Record<string, unknown> | undefined
): CodexCommandApprovalIntent[] {
  if (record?.networkApprovalContext !== null && record?.networkApprovalContext !== undefined) {
    const intents: CodexCommandApprovalIntent[] = ['approve', 'approveForSession']
    if (arrayValue(record.proposedNetworkPolicyAmendments).some(isAllowNetworkPolicyAmendment)) {
      intents.push('applyNetworkPolicyAmendment')
    }
    intents.push('cancel')
    return intents
  }

  if (record?.additionalPermissions !== null && record?.additionalPermissions !== undefined) {
    return ['approve', 'cancel']
  }

  const intents: CodexCommandApprovalIntent[] = ['approve']
  if (isExecPolicyAmendment(record?.proposedExecpolicyAmendment)) {
    intents.push('approveWithExecpolicyAmendment')
  }
  intents.push('cancel')
  return intents
}

function commandApprovalIntentFromDecision(
  decision: unknown
): CodexCommandApprovalIntent | undefined {
  if (decision === 'accept') return 'approve'
  if (decision === 'acceptForSession') return 'approveForSession'
  if (decision === 'decline') return 'decline'
  if (decision === 'cancel') return 'cancel'
  if (hasExecpolicyAmendmentDecision(decision)) return 'approveWithExecpolicyAmendment'
  if (hasNetworkPolicyAmendmentDecision(decision)) return 'applyNetworkPolicyAmendment'
  return undefined
}

function createToolUserInputParams(params: unknown): CodexToolUserInputParams {
  const record = asRecord(params)
  return {
    ...pruneUndefined({
      threadId: stringValue(record?.threadId),
      turnId: stringValue(record?.turnId),
      itemId: stringValue(record?.itemId),
      startedAtMs: finiteNumberValue(record?.startedAtMs)
    }),
    autoResolutionMs: nullableFiniteNumberValue(record?.autoResolutionMs),
    questions: arrayValue(record?.questions).flatMap(toSafeToolUserInputQuestion)
  }
}

function createMcpElicitationParams(params: unknown): CodexMcpElicitationParams {
  const record = asRecord(params)
  const mode = stringValue(record?.mode)
  const base = {
    ...pruneUndefined({
      threadId: stringValue(record?.threadId),
      turnId: record && 'turnId' in record ? nullableStringValue(record.turnId) : undefined
    }),
    serverName: stringValue(record?.serverName) ?? 'MCP server',
    message: stringValue(record?.message) ?? ''
  }

  if (mode === 'url') {
    return {
      ...base,
      mode,
      url: safeHttpUrl(record?.url) ?? '',
      elicitationId: stringValue(record?.elicitationId) ?? ''
    }
  }

  if (mode === 'openai/form') {
    return {
      ...base,
      mode,
      form: compileMcpFormSchema(record?.requestedSchema, { allowOpenAiImagePicker: true })
    }
  }

  if (mode !== 'form') {
    return {
      ...base,
      mode: 'form',
      form: { supported: false, reasonCode: 'invalid-schema' }
    }
  }

  return {
    ...base,
    mode: 'form',
    form: compileMcpFormSchema(record?.requestedSchema)
  }
}

function createPermissionRequestParams(params: unknown): CodexPermissionRequestParams {
  const record = asRecord(params)
  return {
    ...pruneUndefined({
      threadId: stringValue(record?.threadId),
      turnId: stringValue(record?.turnId),
      itemId: stringValue(record?.itemId),
      startedAtMs: finiteNumberValue(record?.startedAtMs),
      environmentId:
        record && 'environmentId' in record ? nullableStringValue(record.environmentId) : undefined,
      cwd: stringValue(record?.cwd),
      reason: nullableStringValue(record?.reason) ?? undefined
    }),
    details: compilePermissionDetails(record?.permissions),
    availableScopes: ['turn', 'session']
  }
}

function toSafeToolUserInputQuestion(value: unknown): CodexToolUserInputQuestion[] {
  const record = asRecord(value)
  const id = stringValue(record?.id)
  if (!record || !id) return []
  const header = stringValue(record.header) ?? id
  return [
    {
      id,
      header,
      question: stringValue(record.question) ?? header,
      isOther: record.isOther === true,
      isSecret: record.isSecret === true,
      options: Array.isArray(record.options)
        ? record.options.flatMap((option) => {
            const optionRecord = asRecord(option)
            const label = stringValue(optionRecord?.label)
            if (!optionRecord || !label) return []
            return [{ label, description: stringValue(optionRecord.description) ?? '' }]
          })
        : null
    }
  ]
}

function compileMcpFormSchema(
  value: unknown,
  options: { allowOpenAiImagePicker?: boolean } = {}
): CodexMcpFormSupport {
  const record = asRecord(value)
  const propertiesRecord = asRecord(record?.properties)
  if (
    !record ||
    record.type !== 'object' ||
    !propertiesRecord ||
    !hasOnlyKeys(record, formRootKeys)
  ) {
    return { supported: false, reasonCode: 'invalid-schema' }
  }
  if (!isStringArrayOrUndefined(record.required)) {
    return { supported: false, reasonCode: 'invalid-schema' }
  }
  const required = new Set(
    arrayValue(record?.required).filter((item): item is string => typeof item === 'string')
  )
  if ([...required].some((name) => !(name in propertiesRecord))) {
    return { supported: false, reasonCode: 'invalid-schema' }
  }
  const fields: CodexMcpFormField[] = []
  for (const [name, property] of Object.entries(propertiesRecord ?? {})) {
    const field = toSafeMcpFormField(name, property, required.has(name), options)
    if (!field) return { supported: false, reasonCode: 'unsupported-schema' }
    fields.push(field)
  }
  return { supported: true, fields }
}

const formRootKeys = new Set(['$schema', 'type', 'properties', 'required', 'title', 'description'])

function toSafeFileChange(value: unknown): CodexFileChangeSummary[] {
  const record = asRecord(value)
  const path = stringValue(record?.path)
  if (!record || !path) return []
  return [
    pruneUndefined({
      path,
      kind: toSafeFileChangeKind(record.kind),
      diff: stringValue(record.diff)
    })
  ]
}

function toSafeFileChangeStats(
  value: unknown,
  changes: CodexFileChangeSummary[]
): CodexFileChangeApprovalParams['stats'] {
  const record = asRecord(value)
  const calculated = changes.reduce(
    (totals, change) => {
      const diff = countDiffLines(change.diff)
      return {
        additions: totals.additions + diff.additions,
        deletions: totals.deletions + diff.deletions
      }
    },
    { additions: 0, deletions: 0 }
  )
  return pruneUndefined({
    files: finiteNumberValue(record?.files) ?? changes.length,
    additions: finiteNumberValue(record?.additions) ?? calculated.additions,
    deletions: finiteNumberValue(record?.deletions) ?? calculated.deletions
  })
}

function toSafeNetworkTarget(value: unknown): CodexCommandApprovalParams['networkTarget'] {
  const record = asRecord(value)
  const host = stringValue(record?.host)
  if (!record || !host) return undefined
  return pruneUndefined({
    host,
    protocol: stringValue(record.protocol)
  })
}

function toSafeNetworkPolicyScope(
  value: unknown
): NonNullable<CodexCommandApprovalParams['networkPolicyScopes']>[number][] {
  const record = asRecord(value)
  const host = stringValue(record?.host)
  if (!record || !host) return []
  return [
    pruneUndefined({
      host,
      action: stringValue(record.action)
    })
  ]
}

function compilePermissionDetails(value: unknown): CodexPermissionDetails {
  const profile = asRecord(value)
  if (!profile || !hasOnlyKeys(profile, new Set(['network', 'fileSystem']))) {
    return { supported: false, reasonCode: 'unsupported' }
  }
  const details: CodexPermissionDetail[] = []

  if (profile.network !== null && profile.network !== undefined) {
    const network = asRecord(profile.network)
    if (
      !network ||
      !hasOnlyKeys(network, new Set(['enabled'])) ||
      typeof network.enabled !== 'boolean'
    ) {
      return { supported: false, reasonCode: 'unsupported' }
    }
    details.push({
      resource: 'network',
      access: network.enabled ? 'connect' : 'deny',
      value: '网络访问'
    })
  }

  if (profile.fileSystem !== null && profile.fileSystem !== undefined) {
    const fileSystem = asRecord(profile.fileSystem)
    if (!fileSystem) return { supported: false, reasonCode: 'unsupported' }
    const compiled = compileFileSystemPermissionDetails(fileSystem)
    if (!compiled) return { supported: false, reasonCode: 'unsupported' }
    if (compiled.invalidGlobDepth) return { supported: false, reasonCode: 'invalid-glob-depth' }
    details.push(...compiled.details)
  }

  if (details.length === 0) return { supported: false, reasonCode: 'empty' }
  return { supported: true, details: mergePermissionDetails(details) }
}

function compileFileSystemPermissionDetails(
  fileSystem: Record<string, unknown>
): { details: CodexPermissionDetail[]; invalidGlobDepth?: boolean } | undefined {
  if (!hasOnlyKeys(fileSystem, new Set(['read', 'write', 'globScanMaxDepth', 'entries']))) {
    return undefined
  }
  const depth = fileSystem.globScanMaxDepth
  if (depth !== undefined && (!Number.isSafeInteger(depth) || (depth as number) < 0)) {
    return { details: [], invalidGlobDepth: true }
  }
  const globScanMaxDepth = depth as number | undefined
  const entries = fileSystem.entries
  const details: CodexPermissionDetail[] = []

  if (entries !== undefined) {
    if (!Array.isArray(entries)) return undefined
    for (const entryValue of entries) {
      const entry = asRecord(entryValue)
      const path = asRecord(entry?.path)
      const access = stringValue(entry?.access)
      if (!entry || !path || (access !== 'read' && access !== 'write' && access !== 'deny'))
        return undefined
      const detail = permissionDetailFromPath(path, access, globScanMaxDepth)
      if (!detail) return undefined
      details.push(detail)
    }
  }

  for (const [access, paths] of [
    ['read', fileSystem.read],
    ['write', fileSystem.write]
  ] as const) {
    if (paths === null || paths === undefined) continue
    if (!Array.isArray(paths) || paths.some((path) => !stringValue(path))) return undefined
    for (const path of paths) {
      details.push({ resource: 'path', access, value: path as string })
    }
  }
  return { details }
}

function permissionDetailFromPath(
  path: Record<string, unknown>,
  access: Extract<CodexPermissionAccess, 'read' | 'write' | 'deny'>,
  globScanMaxDepth: number | undefined
): CodexPermissionDetail | undefined {
  if (path.type === 'path' && stringValue(path.path)) {
    return { resource: 'path', access, value: path.path as string }
  }
  if (path.type === 'glob_pattern' && stringValue(path.pattern)) {
    return pruneUndefined({
      resource: 'glob' as const,
      access,
      value: path.pattern as string,
      globScanMaxDepth
    })
  }
  if (path.type !== 'special') return undefined
  const special = asRecord(path.value)
  const kind = stringValue(special?.kind)
  if (!special || !kind) return undefined
  const labels: Record<string, string> = {
    root: '系统根目录',
    minimal: '最小系统目录',
    tmpdir: '临时目录',
    slash_tmp: '/tmp'
  }
  if (kind === 'project_roots') {
    const subpath = special.subpath
    if (subpath !== null && subpath !== undefined && !stringValue(subpath)) return undefined
    return { resource: 'special', access, value: subpath ? `项目根目录/${subpath}` : '项目根目录' }
  }
  if (kind === 'unknown') {
    const unknownPath = stringValue(special.path)
    const subpath = special.subpath
    if (!unknownPath || (subpath !== null && subpath !== undefined && !stringValue(subpath)))
      return undefined
    return {
      resource: 'special',
      access,
      value: subpath ? `${unknownPath}/${subpath}` : unknownPath
    }
  }
  return labels[kind] ? { resource: 'special', access, value: labels[kind] } : undefined
}

function mergePermissionDetails(details: CodexPermissionDetail[]): CodexPermissionDetail[] {
  const merged = new Map<string, CodexPermissionDetail>()
  for (const detail of details) {
    const key = `${detail.resource}\u0000${detail.value}\u0000${detail.globScanMaxDepth ?? ''}`
    const previous = merged.get(key)
    if (
      !previous ||
      previous.access === detail.access ||
      previous.access === 'deny' ||
      detail.access === 'deny'
    ) {
      merged.set(key, detail)
    } else {
      merged.set(key, { ...detail, access: 'read-write' })
    }
  }
  return [...merged.values()]
}

function toSafeMcpFormField(
  name: string,
  value: unknown,
  required: boolean,
  compilerOptions: { allowOpenAiImagePicker?: boolean }
): CodexMcpFormField | undefined {
  const record = asRecord(value)
  if (!record || !isSafeFieldName(name)) return undefined
  const type = stringValue(record.type)
  if (!type || !hasOnlyKeys(record, permittedFieldKeys)) return undefined
  const base = {
    name,
    label: stringValue(record.title) ?? name,
    description: stringValue(record.description),
    required
  }

  if (type === 'openai/imagePicker') {
    return compilerOptions.allowOpenAiImagePicker
      ? toSafeOpenAiImagePickerField(record, base)
      : undefined
  }

  if (type === 'boolean') {
    const defaultValue = primitiveValue(record.default)
    if (record.default !== undefined && typeof defaultValue !== 'boolean') return undefined
    return pruneUndefined({
      ...base,
      kind: 'boolean' as const,
      default: typeof defaultValue === 'boolean' ? defaultValue : undefined
    })
  }

  if (type === 'number' || type === 'integer') {
    const defaultValue = primitiveValue(record.default)
    const minimum = finiteNumberValue(record.minimum)
    const maximum = finiteNumberValue(record.maximum)
    if (
      (record.default !== undefined && typeof defaultValue !== 'number') ||
      (record.minimum !== undefined && minimum === undefined) ||
      (record.maximum !== undefined && maximum === undefined) ||
      (minimum !== undefined && maximum !== undefined && minimum > maximum) ||
      (typeof defaultValue === 'number' &&
        ((type === 'integer' && !Number.isInteger(defaultValue)) ||
          (minimum !== undefined && defaultValue < minimum) ||
          (maximum !== undefined && defaultValue > maximum)))
    ) {
      return undefined
    }
    return pruneUndefined({
      ...base,
      kind: 'number' as const,
      default: typeof defaultValue === 'number' ? defaultValue : undefined,
      integer: type === 'integer' ? true : undefined,
      minimum,
      maximum
    })
  }

  const enumValues = enumOptions(record)
  if (enumValues === undefined) return undefined
  if (type === 'array') {
    if (record.enum !== undefined || record.enumNames !== undefined || record.oneOf !== undefined)
      return undefined
    const rawDefault = record.default
    const defaultValue = arrayValue(rawDefault).filter(
      (item): item is string => typeof item === 'string'
    )
    const minimum = finiteNumberValue(record.minItems)
    const maximum = finiteNumberValue(record.maxItems)
    if (
      enumValues.length === 0 ||
      (rawDefault !== undefined &&
        (defaultValue.length !== arrayValue(rawDefault).length || !Array.isArray(rawDefault))) ||
      !isFiniteIntegerOrUndefined(record.minItems) ||
      !isFiniteIntegerOrUndefined(record.maxItems) ||
      (minimum !== undefined && maximum !== undefined && minimum > maximum) ||
      (defaultValue.length > 0 &&
        (defaultValue.some((value) => !enumValues.some((option) => option.value === value)) ||
          (minimum !== undefined && defaultValue.length < minimum) ||
          (maximum !== undefined && defaultValue.length > maximum)))
    ) {
      return undefined
    }
    return pruneUndefined({
      ...base,
      kind: 'multi-select' as const,
      default: defaultValue.length > 0 ? defaultValue : undefined,
      options: enumValues,
      minimum,
      maximum,
      minItems: minimum,
      maxItems: maximum
    })
  }

  if (enumValues.length > 0) {
    if (record.items !== undefined || record.anyOf !== undefined) return undefined
    const defaultValue = primitiveValue(record.default)
    if (
      (record.default !== undefined && typeof defaultValue !== 'string') ||
      (typeof defaultValue === 'string' &&
        !enumValues.some((option) => option.value === defaultValue))
    ) {
      return undefined
    }
    return pruneUndefined({
      ...base,
      kind: 'single-select' as const,
      default: typeof defaultValue === 'string' ? defaultValue : undefined,
      options: enumValues
    })
  }

  if (type !== 'string') return undefined
  const defaultValue = primitiveValue(record.default)
  const format = stringValue(record.format)
  const minLength = finiteNumberValue(record.minLength)
  const maxLength = finiteNumberValue(record.maxLength)
  if (
    (record.default !== undefined && typeof defaultValue !== 'string') ||
    (record.format !== undefined && !format) ||
    (format &&
      format !== 'email' &&
      format !== 'uri' &&
      format !== 'date' &&
      format !== 'date-time') ||
    !isFiniteIntegerOrUndefined(record.minLength) ||
    !isFiniteIntegerOrUndefined(record.maxLength) ||
    (minLength !== undefined && maxLength !== undefined && minLength > maxLength) ||
    (typeof defaultValue === 'string' &&
      ((minLength !== undefined && defaultValue.length < minLength) ||
        (maxLength !== undefined && defaultValue.length > maxLength) ||
        !isValidMcpTextFormatValue(format as CodexMcpFormField['format'], defaultValue)))
  ) {
    return undefined
  }
  return pruneUndefined({
    ...base,
    kind: 'text' as const,
    default: typeof defaultValue === 'string' ? defaultValue : undefined,
    minLength,
    maxLength,
    format: format as CodexMcpFormField['format']
  })
}

const permittedFieldKeys = new Set([
  'type',
  'title',
  'description',
  'default',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'format',
  'enum',
  'enumNames',
  'oneOf',
  'items'
])

function toSafeOpenAiImagePickerField(
  record: Record<string, unknown>,
  base: Pick<CodexMcpFormField, 'name' | 'label' | 'description' | 'required'>
): CodexMcpFormField | undefined {
  if (!hasOnlyKeys(record, openAiImagePickerFieldKeys) || !Array.isArray(record.items))
    return undefined
  const options = record.items.map(toSafeOpenAiImagePickerOption)
  if (
    options.length === 0 ||
    options.some((option) => option === undefined) ||
    new Set(options.map((option) => option?.value)).size !== options.length
  ) {
    return undefined
  }
  const imageOptions = options as Array<{ value: string; label: string; imageDataUrl: string }>
  return {
    ...base,
    kind: 'single-select',
    options: imageOptions.map(({ value, label }) => ({ value, label })),
    imageOptions
  }
}

function toSafeOpenAiImagePickerOption(
  value: unknown
): { value: string; label: string; imageDataUrl: string } | undefined {
  const record = asRecord(value)
  const optionValue = stringValue(record?.id)
  const label = stringValue(record?.title)
  const imageDataUrl = stringValue(record?.image)
  if (
    !record ||
    !optionValue ||
    !label ||
    !imageDataUrl ||
    !hasOnlyKeys(record, openAiImagePickerItemKeys) ||
    !dataImageUrlPattern.test(imageDataUrl)
  ) {
    return undefined
  }
  return { value: optionValue, label, imageDataUrl }
}

const openAiImagePickerFieldKeys = new Set(['type', 'title', 'description', 'items'])
const openAiImagePickerItemKeys = new Set(['id', 'title', 'image'])
const dataImageUrlPattern = /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/u

function enumOptions(
  record: Record<string, unknown>
): Array<{ value: string; label: string }> | undefined {
  const items = record.items === undefined ? undefined : asRecord(record.items)
  if (record.items !== undefined && (!items || !hasOnlyKeys(items, permittedItemsKeys)))
    return undefined
  if (record.oneOf !== undefined && !Array.isArray(record.oneOf)) return undefined
  if (items?.anyOf !== undefined && !Array.isArray(items.anyOf)) return undefined
  if (record.enum !== undefined && !Array.isArray(record.enum)) return undefined
  if (items?.enum !== undefined && !Array.isArray(items.enum)) return undefined
  if (items?.enum !== undefined && (items.type !== 'string' || items.anyOf !== undefined))
    return undefined
  if (items?.anyOf !== undefined && (items.type !== undefined || items.enum !== undefined)) {
    return undefined
  }
  if (items?.type !== undefined && items.enum === undefined) return undefined
  if (record.enumNames !== undefined && !isStringArrayOrUndefined(record.enumNames))
    return undefined
  const oneOf = arrayValue(record.oneOf)
  const anyOf = arrayValue(items?.anyOf)
  const titledOptions = oneOf.length > 0 ? oneOf : anyOf
  if (titledOptions.length > 0) {
    const options = titledOptions.map((option) => {
      const entry = asRecord(option)
      const value = stringValue(entry?.const)
      if (!entry || !value || !hasOnlyKeys(entry, permittedChoiceKeys)) return undefined
      return { value, label: stringValue(entry.title) ?? value }
    })
    return hasUniqueOptionValues(options) ? options : undefined
  }

  const values = arrayValue(record.enum)
  const itemValues = arrayValue(items?.enum)
  const labels = arrayValue(record.enumNames)
  const rawValues = values.length > 0 ? values : itemValues
  if (labels.length > 0 && labels.length !== rawValues.length) return undefined
  const options = rawValues.map((value, index) => {
    if (typeof value !== 'string' || value.length === 0) return undefined
    return { value, label: typeof labels[index] === 'string' ? labels[index] : value }
  })
  return hasUniqueOptionValues(options) ? options : undefined
}

const permittedItemsKeys = new Set(['type', 'enum', 'anyOf'])
const permittedChoiceKeys = new Set(['const', 'title'])

function hasUniqueOptionValues(
  options: Array<{ value: string; label: string } | undefined>
): options is Array<{ value: string; label: string }> {
  return (
    options.every((option): option is { value: string; label: string } => option !== undefined) &&
    new Set(options.map((option) => option.value)).size === options.length
  )
}

function toSafeFileChangeKind(value: unknown): CodexFileChangeSummary['kind'] {
  const type = stringValue(asRecord(value)?.type) ?? stringValue(value)
  if (type === 'add' || type === 'delete' || type === 'update') return type
  return undefined
}

function countDiffLines(patch: string | undefined): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 }
  return patch.split('\n').reduce(
    (totals, line) => ({
      additions: totals.additions + (line.startsWith('+') && !line.startsWith('+++') ? 1 : 0),
      deletions: totals.deletions + (line.startsWith('-') && !line.startsWith('---') ? 1 : 0)
    }),
    { additions: 0, deletions: 0 }
  )
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = stringValue(value)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

export function validateMcpFormValues(
  request: Extract<CodexMcpElicitationParams, { mode: 'form' | 'openai/form' }>,
  values: Record<string, CodexMcpFormValue>
): string | undefined {
  if (!request.form.supported) return 'This MCP form is not supported'
  const fields = new Map(request.form.fields.map((field) => [field.name, field]))
  for (const name of Object.keys(values)) {
    if (!fields.has(name)) return `Unknown MCP form field: ${name}`
  }

  for (const field of request.form.fields) {
    const value = values[field.name]
    if (value === undefined) {
      if (field.required) return `${field.label} is required`
      continue
    }
    const error = validateMcpFieldValue(field, value)
    if (error) return error
  }

  return undefined
}

function validateMcpFieldValue(
  field: CodexMcpFormField,
  value: CodexMcpFormValue
): string | undefined {
  if (field.kind === 'text') {
    if (typeof value !== 'string') return `${field.label} must be text`
    if (field.required && value.trim().length === 0) return `${field.label} is required`
    if (field.minLength !== undefined && value.length < field.minLength) {
      return `${field.label} is too short`
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return `${field.label} is too long`
    }
    if (!isValidMcpTextFormatValue(field.format, value)) {
      return `${field.label} has an invalid ${field.format} value`
    }
    return undefined
  }

  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return `${field.label} must be a number`
    if (field.integer && !Number.isInteger(value)) return `${field.label} must be an integer`
    if (field.minimum !== undefined && value < field.minimum)
      return `${field.label} is below the minimum`
    if (field.maximum !== undefined && value > field.maximum)
      return `${field.label} is above the maximum`
    return undefined
  }

  if (field.kind === 'boolean') {
    return typeof value === 'boolean' ? undefined : `${field.label} must be true or false`
  }

  const optionValues = new Set(field.options?.map((option) => option.value) ?? [])
  if (field.kind === 'single-select') {
    if (typeof value !== 'string') return `${field.label} must select one option`
    return optionValues.has(value) ? undefined : `${field.label} has an invalid option`
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return `${field.label} must select one or more options`
  }
  if (field.required && value.length === 0) return `${field.label} is required`
  if (field.minimum !== undefined && value.length < field.minimum)
    return `${field.label} needs more selections`
  if (field.maximum !== undefined && value.length > field.maximum)
    return `${field.label} has too many selections`
  return value.every((item) => optionValues.has(item))
    ? undefined
    : `${field.label} has an invalid option`
}

function isValidMcpTextFormatValue(
  format: CodexMcpFormField['format'] | undefined,
  value: string
): boolean {
  if (!format) return true
  if (format === 'uri') return safeHttpUrl(value) !== undefined
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  if (format === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value)
  }
  if (format === 'date-time') {
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) return false
    return !Number.isNaN(new Date(value).valueOf())
  }
  return false
}

function hasExecpolicyAmendmentDecision(value: unknown): boolean {
  const decision = asRecord(value)
  if (!decision || !hasOnlyKeys(decision, new Set(['acceptWithExecpolicyAmendment']))) return false
  const wrapper = asRecord(decision.acceptWithExecpolicyAmendment)
  return Boolean(
    wrapper &&
    hasOnlyKeys(wrapper, new Set(['execpolicy_amendment'])) &&
    isExecPolicyAmendment(wrapper.execpolicy_amendment)
  )
}

function hasNetworkPolicyAmendmentDecision(value: unknown): boolean {
  const decision = asRecord(value)
  if (!decision || !hasOnlyKeys(decision, new Set(['applyNetworkPolicyAmendment']))) return false
  const wrapper = asRecord(decision.applyNetworkPolicyAmendment)
  return Boolean(
    wrapper &&
    hasOnlyKeys(wrapper, new Set(['network_policy_amendment'])) &&
    isNetworkPolicyAmendment(wrapper.network_policy_amendment)
  )
}

function isExecPolicyAmendment(value: unknown): boolean {
  return Array.isArray(value) && value.every((part) => typeof part === 'string')
}

function isNetworkPolicyAmendment(value: unknown): boolean {
  const amendment = asRecord(value)
  return Boolean(
    amendment &&
    hasOnlyKeys(amendment, new Set(['host', 'action'])) &&
    stringValue(amendment.host) &&
    (amendment.action === 'allow' || amendment.action === 'deny')
  )
}

function isAllowNetworkPolicyAmendment(value: unknown): boolean {
  return isNetworkPolicyAmendment(value) && asRecord(value)?.action === 'allow'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null
  return stringValue(value)
}

function finiteNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nullableFiniteNumberValue(value: unknown): number | null {
  if (value === null) return null
  return finiteNumberValue(value) ?? null
}

function primitiveValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null
  return isPrimitiveValue(value) ? value : undefined
}

function isPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function pruneUndefined<T extends Record<string, unknown>>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key]
  }
  return record
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key))
}

function isStringArrayOrUndefined(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}

function isFiniteIntegerOrUndefined(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
}

function isSafeFieldName(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !hasControlCharacters(value)
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0 && code <= 31) return true
  }
  return false
}
