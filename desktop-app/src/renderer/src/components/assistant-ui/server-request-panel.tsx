import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  FilePenLineIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type {
  CodexApprovalRequest,
  CodexApprovalResponse,
  CodexMcpFormField,
  CodexMcpFormValue,
  CodexToolUserInputQuestion
} from '../../../../shared/codexIpcApi'
import { FileChangeDiffList } from './file-change-diff'

type ServerRequestPanelProps = {
  requests: readonly CodexApprovalRequest[]
  onRespond: (request: CodexApprovalRequest, response: CodexApprovalResponse) => Promise<void>
  onReject: (request: CodexApprovalRequest) => Promise<void>
  onInteraction?: (request: CodexApprovalRequest) => Promise<void> | void
}

type ActionState = CodexApprovalResponse['action']

export function ServerRequestPanel({
  requests,
  onRespond,
  onReject,
  onInteraction
}: ServerRequestPanelProps): React.JSX.Element | null {
  if (requests.length === 0) return null

  return (
    <section aria-label="待处理的授权请求" className="w-full" data-slot="server-request-panel">
      <div className="flex max-h-[45vh] w-full flex-col gap-3 overflow-y-auto">
        {requests.map((request) => (
          <ServerRequestCard
            key={request.id}
            onInteraction={onInteraction}
            onReject={onReject}
            onRespond={onRespond}
            request={request}
          />
        ))}
      </div>
    </section>
  )
}

function ServerRequestCard({
  onInteraction,
  onReject,
  onRespond,
  request
}: {
  onInteraction: ServerRequestPanelProps['onInteraction']
  onReject: ServerRequestPanelProps['onReject']
  onRespond: ServerRequestPanelProps['onRespond']
  request: CodexApprovalRequest
}): React.JSX.Element {
  const [busyAction, setBusyAction] = useState<ActionState>()
  const [error, setError] = useState<string>()

  const runAction = async (action: ActionState, callback: () => Promise<void>): Promise<void> => {
    setBusyAction(action)
    setError(undefined)
    try {
      await callback()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusyAction(undefined)
    }
  }

  return (
    <Card
      aria-busy={Boolean(busyAction)}
      className="@container/request-card min-w-0 gap-0 overflow-hidden rounded-3xl border-border/70 py-0 shadow-[0_12px_36px_-28px_rgba(0,0,0,0.85)]"
      data-codex-approval-surface="true"
      data-request-id={request.id}
    >
      {request.kind === 'command' ? (
        <CommandApprovalRequest
          busyAction={busyAction}
          onReject={() => void runAction('decline', () => onReject(request))}
          onRespond={(response) =>
            void runAction(response.action, () => onRespond(request, response))
          }
          request={request}
        />
      ) : null}
      {request.kind === 'file-change' ? (
        <FileChangeApprovalRequest
          busyAction={busyAction}
          onReject={() => void runAction('decline', () => onReject(request))}
          onRespond={(response) =>
            void runAction(response.action, () => onRespond(request, response))
          }
          request={request}
        />
      ) : null}
      {request.kind === 'tool-user-input' ? (
        <ToolUserInputRequest
          busy={Boolean(busyAction)}
          onReject={() => void runAction('decline', () => onReject(request))}
          onInteraction={() => void onInteraction?.(request)}
          onSubmit={(response) =>
            void runAction(response.action, () => onRespond(request, response))
          }
          request={request}
        />
      ) : null}
      {request.kind === 'permission-request' ? (
        <PermissionApprovalRequest
          busyAction={busyAction}
          onReject={() => void runAction('decline', () => onReject(request))}
          onRespond={(response) =>
            void runAction(response.action, () => onRespond(request, response))
          }
          request={request}
        />
      ) : null}
      {request.kind === 'mcp-elicitation' ? (
        <McpElicitationRequest
          busyAction={busyAction}
          onReject={() => void runAction('decline', () => onReject(request))}
          onRespond={(response) =>
            void runAction(response.action, () => onRespond(request, response))
          }
          request={request}
        />
      ) : null}
      {error ? (
        <p className="mx-4 mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Card>
  )
}

function CommandApprovalRequest({
  busyAction,
  onReject,
  onRespond,
  request
}: {
  busyAction: ActionState | undefined
  onReject: () => void
  onRespond: (response: CodexApprovalResponse) => void
  request: Extract<CodexApprovalRequest, { kind: 'command' }>
}): React.JSX.Element {
  const { params } = request
  const command = params.command ?? '命令内容不可用'
  const canCollapse = command.length > 320 || command.split('\n').length > 8
  const [expanded, setExpanded] = useState(false)

  if (params.networkTarget) {
    return (
      <RequestShell
        subtitle={`${params.networkTarget.host} 不在当前网络允许列表中`}
        title="网络访问"
      >
        <NetworkApprovalDetails
          reason={params.reason}
          requestedPermissions={params.requestedPermissions}
          scopes={params.networkPolicyScopes}
          target={params.networkTarget}
        />
        <ApprovalActions
          busyAction={busyAction}
          intents={params.availableIntents.filter(isPositiveApprovalIntent)}
          intentLabels={networkApprovalIntentLabels(params.networkPolicyScopes)}
          negativeIntents={params.availableIntents.filter(isNegativeApprovalIntent)}
          onReject={onReject}
          onRespond={onRespond}
        />
      </RequestShell>
    )
  }

  return (
    <RequestShell subtitle={params.reason} title="是否允许执行以下命令？">
      <pre
        className={cn(
          'overflow-auto rounded-xl border border-border/70 bg-muted/45 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words',
          !expanded && canCollapse ? 'max-h-[3lh]' : 'max-h-80'
        )}
      >
        {command}
      </pre>
      {canCollapse ? (
        <Button
          className="self-start px-0 text-muted-foreground"
          onClick={() => setExpanded((current) => !current)}
          type="button"
          variant="link"
        >
          {expanded ? '收起命令' : '展开完整命令'}
        </Button>
      ) : null}
      {params.requestedPermissions ? (
        <div>
          <p className="mb-1 text-sm text-muted-foreground">请求权限</p>
          <PermissionDetails details={params.requestedPermissions} />
        </div>
      ) : null}
      <ApprovalActions
        busyAction={busyAction}
        intents={params.availableIntents.filter(isPositiveApprovalIntent)}
        negativeIntents={params.availableIntents.filter(isNegativeApprovalIntent)}
        onReject={onReject}
        onRespond={onRespond}
      />
    </RequestShell>
  )
}

function NetworkApprovalDetails({
  reason,
  requestedPermissions,
  scopes,
  target
}: {
  reason?: string
  requestedPermissions?:
    | Extract<
        Extract<CodexApprovalRequest, { kind: 'command' }>['params']['requestedPermissions'],
        { supported: true }
      >
    | { supported: false; reasonCode: string }
  scopes: Array<{ host: string; action?: string }>
  target: { host: string; protocol?: string }
}): React.JSX.Element {
  const destination = target.protocol ? `${target.protocol}://${target.host}` : target.host
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-sm">
      <dl className="space-y-2">
        <NetworkApprovalDetail label="当前目标范围" value={destination} />
        <NetworkApprovalDetail label="请求原因" value={reason || '未提供'} />
        <NetworkApprovalDetail
          label="可用规则范围"
          value={
            scopes.length > 0
              ? scopes.map(formatNetworkPolicyScope).join('；')
              : '此请求不提供可记住的网络规则'
          }
        />
        {requestedPermissions ? (
          <div>
            <dt className="mb-1 text-muted-foreground">请求权限</dt>
            <dd>
              <PermissionDetails details={requestedPermissions} />
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

function PermissionApprovalRequest({
  busyAction,
  onReject,
  onRespond,
  request
}: {
  busyAction: ActionState | undefined
  onReject: () => void
  onRespond: (response: Extract<CodexApprovalResponse, { action: 'approvePermissions' }>) => void
  request: Extract<CodexApprovalRequest, { kind: 'permission-request' }>
}): React.JSX.Element {
  const { params } = request
  const busy = Boolean(busyAction)
  const isSupported = params.details.supported && params.details.details.length > 0
  return (
    <RequestShell
      subtitle={params.reason || '此操作需要额外权限才能继续。'}
      title={
        params.details.supported &&
        params.details.details.every((detail) => detail.resource === 'network')
          ? '网络访问'
          : '请求权限'
      }
    >
      <PermissionDetails details={params.details} />
      {params.cwd ? <NetworkApprovalDetail label="工作目录" value={params.cwd} /> : null}
      {params.environmentId ? (
        <NetworkApprovalDetail label="环境" value={params.environmentId} />
      ) : null}
      <ActionRow className="justify-end">
        <RejectButton busy={busyAction === 'decline'} disabled={busy} onClick={onReject} />
        {isSupported ? (
          <>
            <Button
              disabled={busy || !params.availableScopes.includes('turn')}
              onClick={() => onRespond({ action: 'approvePermissions', scope: 'turn' })}
              size="composer"
              type="button"
            >
              <CheckIcon className="size-4" />
              允许本轮
            </Button>
            <Button
              disabled={busy || !params.availableScopes.includes('session')}
              onClick={() => onRespond({ action: 'approvePermissions', scope: 'session' })}
              size="composer"
              type="button"
              variant="outline"
            >
              本次会话允许
            </Button>
          </>
        ) : null}
      </ActionRow>
    </RequestShell>
  )
}

function PermissionDetails({
  details
}: {
  details:
    | Extract<
        Extract<CodexApprovalRequest, { kind: 'permission-request' }>['params']['details'],
        { supported: true }
      >
    | { supported: false; reasonCode: string }
}): React.JSX.Element {
  if (!details.supported) {
    return (
      <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
        无法完整、安全地解释这项权限请求，因此不能批准。
      </p>
    )
  }
  return (
    <ul className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-border/60 p-3 text-sm">
      {details.details.map((detail, index) => (
        <li className="flex min-w-0 gap-2" key={`${detail.resource}-${detail.value}-${index}`}>
          <span className="shrink-0 text-muted-foreground">
            {permissionAccessLabel(detail.access)}
          </span>
          <span className="min-w-0 break-all text-foreground">{detail.value}</span>
          {detail.globScanMaxDepth !== undefined ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              扫描深度 ≤ {detail.globScanMaxDepth}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function permissionAccessLabel(
  access: 'read' | 'write' | 'read-write' | 'deny' | 'connect'
): string {
  if (access === 'read') return '读取'
  if (access === 'write') return '写入'
  if (access === 'read-write') return '读写'
  if (access === 'deny') return '拒绝'
  return '连接'
}

function NetworkApprovalDetail({
  label,
  value
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-medium text-foreground">{value}</dd>
    </div>
  )
}

function formatNetworkPolicyScope(scope: { host: string; action?: string }): string {
  if (!scope.action) return `访问 ${scope.host}`
  if (scope.action === 'allow') return `允许访问 ${scope.host}`
  return `${scope.action} ${scope.host}`
}

function networkApprovalIntentLabels(
  scopes: Array<{ host: string; action?: string }>
): Partial<Record<Exclude<PositiveApprovalIntent, 'approve'>, string>> {
  const firstScope = scopes[0]
  if (!firstScope) return {}
  return {
    applyNetworkPolicyAmendment: `${formatNetworkPolicyScope(firstScope)}，并记住该规则`
  }
}

function FileChangeApprovalRequest({
  busyAction,
  onReject,
  onRespond,
  request
}: {
  busyAction: ActionState | undefined
  onReject: () => void
  onRespond: (response: CodexApprovalResponse) => void
  request: Extract<CodexApprovalRequest, { kind: 'file-change' }>
}): React.JSX.Element {
  const { params } = request

  return (
    <RequestShell
      icon={<FilePenLineIcon />}
      method="编辑文件"
      title="是否允许 ChatGPT 编辑以下文件？"
    >
      {params.changes.length > 0 ? (
        <div className="max-h-[200px] space-y-2 overflow-y-auto pe-1" data-slot="file-change-list">
          {params.changes.map((change, index) => (
            <FileChangeEntry change={change} key={`${change.path}:${index}`} />
          ))}
        </div>
      ) : (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground"
          data-slot="file-change-empty"
        >
          暂未收到可展示的文件 diff。你仍可选择仅允许这一次。
        </p>
      )}
      <ApprovalActions
        busyAction={busyAction}
        intents={params.availableIntents.filter(isPositiveApprovalIntent)}
        negativeIntents={params.availableIntents.filter(isNegativeApprovalIntent)}
        onReject={onReject}
        onRespond={onRespond}
        sessionLabel="允许所有修改"
        sessionTooltip="当前会话内后续文件修改不再询问。"
      />
    </RequestShell>
  )
}

function FileChangeEntry({
  change
}: {
  change: Extract<CodexApprovalRequest, { kind: 'file-change' }>['params']['changes'][number]
}): React.JSX.Element {
  if (!change.diff?.trim() && change.kind !== 'add' && change.kind !== 'delete') {
    return <FileChangeRow change={change} />
  }

  return (
    <details className="rounded-2xl border border-border/70 bg-muted/20">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <FileChangeRow change={change} />
      </summary>
      <FileChangeDiffList
        className="border-t border-border/60 p-3"
        files={[{ kind: change.kind, patch: change.diff, path: change.path }]}
      />
    </details>
  )
}

function FileChangeRow({
  change
}: {
  change: Extract<CodexApprovalRequest, { kind: 'file-change' }>['params']['changes'][number]
}): React.JSX.Element {
  const { prefix, name } = splitPath(change.path)
  const stats = countPatchLines(change.diff)
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium" title={change.path}>
        <span className="text-muted-foreground">{prefix}</span>
        <span className="text-foreground">{name}</span>
      </span>
      <span className="shrink-0 text-sm tabular-nums">
        <span className="text-emerald-500">+{stats.additions}</span>
        <span className="ms-2 text-red-500">−{stats.deletions}</span>
      </span>
    </div>
  )
}

function ToolUserInputRequest({
  busy,
  onInteraction,
  onReject,
  onSubmit,
  request
}: {
  busy: boolean
  onInteraction: () => void
  onReject: () => void
  onSubmit: (response: Extract<CodexApprovalResponse, { action: 'answer' }>) => void
  request: Extract<CodexApprovalRequest, { kind: 'tool-user-input' }>
}): React.JSX.Element {
  const { questions } = request.params
  const [values, setValues] = useState<Record<string, string[]>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const didSnooze = useRef(false)
  const automaticAdvance = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const currentQuestion = questions[currentIndex]
  const currentValue = currentQuestion ? (values[currentQuestion.id] ?? []) : []
  const incomplete = questions.some((question) => !(values[question.id] ?? []).some(hasText))
  const hasOptions = Boolean(currentQuestion?.options?.length)
  const canContinue = currentValue.some(hasText)
  const isLastQuestion = currentIndex === questions.length - 1

  useEffect(() => {
    return () => {
      if (automaticAdvance.current) clearTimeout(automaticAdvance.current)
    }
  }, [])

  useEffect(() => {
    if (!request.params.deadlineAtMs || request.params.autoResolutionSnoozed) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [request.params.autoResolutionSnoozed, request.params.deadlineAtMs])

  const snooze = (): void => {
    if (didSnooze.current || request.params.autoResolutionSnoozed) return
    didSnooze.current = true
    onInteraction()
  }

  const cancelAutomaticAdvance = (): void => {
    if (automaticAdvance.current) clearTimeout(automaticAdvance.current)
    automaticAdvance.current = undefined
  }

  const submitAnswers = (nextValues: Record<string, string[]>): void => {
    if (questions.some((question) => !(nextValues[question.id] ?? []).some(hasText))) return
    cancelAutomaticAdvance()
    onSubmit({ action: 'answer', answers: nextValues })
  }

  const continueCurrentQuestion = (): void => {
    if (!canContinue || !currentQuestion) return
    snooze()
    if (isLastQuestion) {
      submitAnswers(values)
      return
    }
    setCurrentIndex((index) => Math.min(index + 1, questions.length - 1))
  }

  const selectOption = (answer: string[]): void => {
    if (!currentQuestion || busy) return
    cancelAutomaticAdvance()
    snooze()
    const nextValues = {
      ...values,
      [currentQuestion.id]: answer
    }
    setValues(nextValues)
    if (currentQuestion.isOther) return
    automaticAdvance.current = setTimeout(() => {
      automaticAdvance.current = undefined
      if (isLastQuestion) {
        submitAnswers(nextValues)
        return
      }
      setCurrentIndex((index) => Math.min(index + 1, questions.length - 1))
    }, TOOL_OPTION_ADVANCE_DELAY_MS)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!currentQuestion) return
    continueCurrentQuestion()
  }

  return (
    <RequestShell title={currentQuestion?.question ?? '请回答以下问题'}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {currentQuestion ? (
          <>
            {questions.length > 1 ? (
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  第 {currentIndex + 1} / {questions.length} 题
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label="上一题"
                    disabled={busy || currentIndex === 0}
                    onClick={() => {
                      cancelAutomaticAdvance()
                      snooze()
                      setCurrentIndex((index) => Math.max(index - 1, 0))
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </Button>
                  <Button
                    aria-label="下一题"
                    disabled={busy || !canContinue || isLastQuestion}
                    onClick={() => {
                      cancelAutomaticAdvance()
                      snooze()
                      continueCurrentQuestion()
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRightIcon className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
            <ToolQuestion
              disabled={busy}
              onCancelAutomaticAdvance={cancelAutomaticAdvance}
              onInteraction={snooze}
              onChange={(next) =>
                setValues((current) => ({ ...current, [currentQuestion.id]: next }))
              }
              onSelectOption={selectOption}
              question={currentQuestion}
              value={currentValue}
            />
          </>
        ) : null}
        {questions.length === 0 ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            该输入请求没有可回答的问题。
          </p>
        ) : null}
        <ActionRow className="justify-end">
          {request.params.deadlineAtMs && !request.params.autoResolutionSnoozed ? (
            <span
              aria-label="自动处理倒计时"
              className="me-auto text-xs tabular-nums text-muted-foreground"
            >
              {Math.max(0, Math.ceil((request.params.deadlineAtMs - now) / 1000))} 秒后自动跳过
            </span>
          ) : null}
          {!hasOptions || currentQuestion?.isOther ? (
            <Button
              disabled={busy || !canContinue || (isLastQuestion && incomplete)}
              size="composer"
              type="submit"
            >
              <CheckIcon className="size-4" />
              {isLastQuestion ? '提交回答' : '继续'}
            </Button>
          ) : null}
          <RejectButton
            busy={busy}
            disabled={busy}
            onClick={() => {
              cancelAutomaticAdvance()
              if (request.params.autoResolutionMs !== null) {
                onSubmit({ action: 'answer', answers: {} })
                return
              }
              onReject()
            }}
          />
        </ActionRow>
      </form>
    </RequestShell>
  )
}

const TOOL_OPTION_ADVANCE_DELAY_MS = 180

function ToolQuestion({
  disabled,
  onCancelAutomaticAdvance,
  onInteraction,
  onChange,
  onSelectOption,
  question,
  value
}: {
  disabled: boolean
  onCancelAutomaticAdvance: () => void
  onInteraction: () => void
  onChange: (value: string[]) => void
  onSelectOption: (value: string[]) => void
  question: CodexToolUserInputQuestion
  value: string[]
}): React.JSX.Element {
  const hasOptions = Boolean(question.options?.length)
  const optionLabels = new Set(question.options?.map((option) => option.label))
  const selectedOption = value.find((answer) => optionLabels.has(answer))
  const otherValue = value.find((answer) => !optionLabels.has(answer)) ?? ''

  const updateOtherAnswer = (nextOtherValue: string): void => {
    onInteraction()
    const answers: string[] = []
    if (nextOtherValue.trim()) answers.push(nextOtherValue)
    onChange(answers)
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border/60 p-3"
      data-slot="tool-input-question"
    >
      {hasOptions ? (
        <RadioGroup
          aria-label={question.question}
          disabled={disabled}
          onValueChange={(option) => onSelectOption([option])}
          value={selectedOption ?? ''}
        >
          {question.options?.map((option) => (
            <Field
              className="cursor-pointer rounded-lg px-2 py-1.5 hover:bg-muted/50"
              key={option.label}
              orientation="horizontal"
            >
              <RadioGroupItem id={`tool-${question.id}-${option.label}`} value={option.label} />
              <FieldContent>
                <FieldLabel
                  className="cursor-pointer"
                  htmlFor={`tool-${question.id}-${option.label}`}
                >
                  {option.label}
                </FieldLabel>
                {option.description ? (
                  <FieldDescription className="text-xs">{option.description}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
          ))}
        </RadioGroup>
      ) : null}
      {!hasOptions || question.isOther ? (
        <Field>
          {question.isOther && hasOptions ? (
            <FieldLabel htmlFor={`tool-${question.id}-other`}>其他回答</FieldLabel>
          ) : null}
          <Input
            aria-label={!hasOptions ? question.question : undefined}
            autoComplete={question.isSecret ? 'off' : undefined}
            disabled={disabled}
            id={`tool-${question.id}-other`}
            onChange={(event) => updateOtherAnswer(event.target.value)}
            onFocus={() => {
              onCancelAutomaticAdvance()
              onInteraction()
            }}
            onKeyDown={onInteraction}
            placeholder={question.isSecret ? '此输入不会显示在对话中' : '输入你的回答'}
            type={question.isSecret ? 'password' : 'text'}
            value={otherValue}
          />
        </Field>
      ) : null}
    </div>
  )
}

function McpElicitationRequest({
  busyAction,
  onReject,
  onRespond,
  request
}: {
  busyAction: ActionState | undefined
  onReject: () => void
  onRespond: (response: CodexApprovalResponse) => void
  request: Extract<CodexApprovalRequest, { kind: 'mcp-elicitation' }>
}): React.JSX.Element {
  const { params } = request
  const busy = Boolean(busyAction)

  if (params.mode === 'form' || params.mode === 'openai/form') {
    if (!params.form.supported) {
      return (
        <RequestShell
          subtitle={`${params.serverName} 请求了此表单。`}
          title="当前版本无法安全显示此请求"
        >
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            为保护隐私，原始表单数据不会发送到界面。你可以跳过并继续，或取消此请求。
          </p>
          <ActionRow className="justify-end">
            <Button
              disabled={busy}
              onClick={() => onRespond({ action: 'cancel' })}
              size="composer"
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <RejectButton busy={busy} disabled={busy} onClick={onReject} />
          </ActionRow>
        </RequestShell>
      )
    }
    return (
      <McpFormRequest
        busy={busy}
        fields={params.form.fields}
        message={params.message}
        onReject={onReject}
        onCancel={() => onRespond({ action: 'cancel' })}
        onSubmit={(values) => onRespond({ action: 'submitMcpForm', values })}
        serverName={params.serverName}
      />
    )
  }
  return (
    <McpUrlRequest
      busy={busy}
      onReject={onReject}
      onRespond={onRespond}
      request={{ ...request, params }}
    />
  )
}

function McpFormRequest({
  busy,
  fields,
  message,
  onCancel,
  onReject,
  onSubmit,
  serverName
}: {
  busy: boolean
  fields: CodexMcpFormField[]
  message: string
  onCancel: () => void
  onReject: () => void
  onSubmit: (values: Record<string, CodexMcpFormValue>) => void
  serverName: string
}): React.JSX.Element {
  const initialValues = useMemo(() => initialMcpFormValues(fields), [fields])
  const [values, setValues] = useState<Record<string, CodexMcpFormValue>>(initialValues)
  const [validationError, setValidationError] = useState<string>()

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const normalizedValues = normalizeRendererMcpFormValues(fields, values)
    const error = validateRendererMcpFormValues(fields, normalizedValues)
    if (error) {
      setValidationError(error)
      return
    }
    onSubmit(normalizedValues)
  }

  return (
    <RequestShell subtitle={`${serverName} 请求输入`} title={message || 'MCP 请求输入'}>
      <form
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        onSubmit={submit}
      >
        {fields.map((field) => (
          <McpFormField
            disabled={busy}
            field={field}
            key={field.name}
            onChange={(value) => {
              setValidationError(undefined)
              setValues((current) => ({ ...current, [field.name]: value }))
            }}
            value={values[field.name]}
          />
        ))}
        {validationError ? <p className="text-sm text-destructive">{validationError}</p> : null}
        <ActionRow className="justify-end">
          <Button disabled={busy} size="composer" type="submit">
            <CheckIcon className="size-4" />
            提交
          </Button>
          <Button
            disabled={busy}
            onClick={onCancel}
            size="composer"
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <RejectButton busy={busy} disabled={busy} onClick={onReject} />
        </ActionRow>
      </form>
    </RequestShell>
  )
}

function McpUrlRequest({
  busy,
  onReject,
  onRespond,
  request
}: {
  busy: boolean
  onReject: () => void
  onRespond: (response: CodexApprovalResponse) => void
  request: Extract<CodexApprovalRequest, { kind: 'mcp-elicitation' }> & {
    params: Extract<
      Extract<CodexApprovalRequest, { kind: 'mcp-elicitation' }>['params'],
      { mode: 'url' }
    >
  }
}): React.JSX.Element {
  const [opened, setOpened] = useState(false)
  const [openError, setOpenError] = useState<string>()
  const { params } = request
  const open = async (): Promise<void> => {
    if (!params.url || busy) return
    setOpenError(undefined)
    try {
      await window.desktopApp.codex.openExternalHttpUrl(params.url)
      setOpened(true)
    } catch (error) {
      setOpenError(errorMessage(error))
    }
  }
  return (
    <RequestShell title="需要操作">
      <div
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onReject()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {params.message || '此服务器需要继续操作。'}
        </p>
        {params.url ? (
          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm break-all">
            {params.url}
          </div>
        ) : (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            外部地址无效，无法批准此请求。
          </p>
        )}
        {openError ? <p className="text-sm text-destructive">{openError}</p> : null}
        <ActionRow className="justify-end">
          <RejectButton busy={busy} disabled={busy} onClick={onReject} />
          {params.url ? (
            <Button
              disabled={busy}
              onClick={() => (opened ? onRespond({ action: 'approve' }) : void open())}
              size="composer"
              type="button"
            >
              <CheckIcon className="size-4" />
              {opened ? '继续' : '打开链接'}
            </Button>
          ) : null}
        </ActionRow>
      </div>
    </RequestShell>
  )
}

function McpFormField({
  disabled,
  field,
  onChange,
  value
}: {
  disabled: boolean
  field: CodexMcpFormField
  onChange: (value: CodexMcpFormValue) => void
  value: CodexMcpFormValue | undefined
}): React.JSX.Element {
  const textValue = typeof value === 'string' ? value : ''
  const fieldId = `mcp-field-${field.name}`

  if (field.kind === 'boolean') {
    return (
      <Field className="rounded-xl border border-border/60 px-3 py-2.5" orientation="horizontal">
        <Checkbox
          checked={value === true}
          disabled={disabled}
          id={fieldId}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <FieldContent>
          <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
          {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        </FieldContent>
      </Field>
    )
  }

  if (field.kind === 'multi-select') {
    const selected = Array.isArray(value) ? value : []
    return (
      <FieldSet className="rounded-xl border border-border/60 p-3">
        <FieldLegend>{field.label}</FieldLegend>
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        <FieldGroup className="gap-2">
          {field.options?.map((option) => {
            const optionId = `${fieldId}-${option.value}`
            return (
              <Field key={option.value} orientation="horizontal">
                <Checkbox
                  checked={selected.includes(option.value)}
                  disabled={disabled}
                  id={optionId}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value)
                    )
                  }
                />
                <FieldLabel htmlFor={optionId}>{option.label}</FieldLabel>
              </Field>
            )
          })}
        </FieldGroup>
      </FieldSet>
    )
  }

  if (field.kind === 'single-select') {
    const imageOptions = field.imageOptions
    if (imageOptions?.length) {
      return (
        <FieldSet className="rounded-xl border border-border/60 p-3">
          <FieldLegend>{field.label}</FieldLegend>
          {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
          <div aria-label={field.label} className="grid grid-cols-2 gap-2" role="radiogroup">
            {imageOptions.map((option) => {
              const selected = value === option.value
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    'rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                  )}
                  disabled={disabled}
                  key={option.value}
                  onClick={() => onChange(option.value)}
                  role="radio"
                  type="button"
                >
                  {option.imageDataUrl ? (
                    <img
                      alt=""
                      className="mb-2 h-20 w-full rounded object-cover"
                      onError={(event) => event.currentTarget.classList.add('hidden')}
                      src={option.imageDataUrl}
                    />
                  ) : null}
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        </FieldSet>
      )
    }
    return (
      <Field>
        <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        <Combobox
          disabled={disabled}
          id={fieldId}
          onValueChange={onChange}
          options={field.options ?? []}
          placeholder={field.required ? `请选择 ${field.label}` : '请选择'}
          value={textValue}
        />
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
      {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
      <Input
        disabled={disabled}
        id={fieldId}
        max={field.maximum}
        maxLength={field.maxLength}
        min={field.minimum}
        minLength={field.minLength}
        onChange={(event) => {
          if (field.kind === 'number') {
            const raw = event.target.value
            if (raw === '') return onChange('')
            const numeric = Number(raw)
            return onChange(Number.isFinite(numeric) ? numeric : '')
          }
          onChange(event.target.value)
        }}
        required={field.required}
        step={field.kind === 'number' && field.integer ? 1 : undefined}
        type={field.kind === 'number' ? 'number' : 'text'}
        value={field.kind === 'number' && typeof value === 'number' ? value : textValue}
      />
    </Field>
  )
}

function ApprovalActions({
  busyAction,
  disabled = false,
  intents,
  intentLabels,
  negativeIntents,
  onReject,
  onRespond,
  sessionLabel,
  sessionTooltip
}: {
  busyAction: ActionState | undefined
  disabled?: boolean
  intents: readonly PositiveApprovalIntent[]
  intentLabels?: Partial<Record<Exclude<PositiveApprovalIntent, 'approve'>, string>>
  negativeIntents?: readonly NegativeApprovalIntent[]
  onReject: () => void
  onRespond: (response: CodexApprovalResponse) => void
  sessionLabel?: string
  sessionTooltip?: string
}): React.JSX.Element {
  const busy = Boolean(busyAction)
  const onceAllowed = intents.includes('approve')
  const menuIntents = intents.filter(
    (intent): intent is Exclude<PositiveApprovalIntent, 'approve'> => intent !== 'approve'
  )

  return (
    <ActionRow className="justify-end">
      {negativeIntents ? (
        negativeIntents.map((intent) => (
          <Button
            className="rounded-full"
            disabled={busy}
            key={intent}
            onClick={() => onRespond({ action: intent })}
            size="composer"
            type="button"
            variant="outline"
          >
            <XIcon className="size-4" />
            {negativeApprovalIntentLabel(intent, busyAction === intent)}
          </Button>
        ))
      ) : (
        <RejectButton busy={busyAction === 'decline'} disabled={busy} onClick={onReject} />
      )}
      {onceAllowed ? (
        <div className="flex overflow-hidden rounded-full">
          <Button
            className="rounded-e-none bg-foreground px-4 text-background hover:bg-foreground/90"
            disabled={busy || disabled}
            onClick={() => onRespond({ action: 'approve' })}
            size="composer"
            type="button"
          >
            <CheckIcon className="size-4" />
            允许一次
          </Button>
          {menuIntents.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="更多允许选项"
                  className="rounded-s-none border-s border-background/25 bg-foreground px-2 text-background hover:bg-foreground/90"
                  disabled={busy || disabled}
                  size="composer"
                  type="button"
                >
                  <ChevronDownIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 rounded-3xl p-2" side="top">
                <DropdownMenuItem
                  disabled={busy || disabled}
                  onSelect={() => onRespond({ action: 'approve' })}
                >
                  允许一次
                </DropdownMenuItem>
                {menuIntents.map((intent) => (
                  <ApprovalMenuItem
                    disabled={busy || disabled}
                    intent={intent}
                    key={intent}
                    label={intentLabels?.[intent]}
                    onSelect={() => onRespond({ action: intent })}
                    sessionLabel={sessionLabel}
                    sessionTooltip={sessionTooltip}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      {!onceAllowed
        ? intents.map((intent) => (
            <Button
              disabled={busy || disabled}
              key={intent}
              onClick={() => onRespond({ action: intent })}
              size="composer"
              type="button"
            >
              {approvalIntentLabel(intent)}
            </Button>
          ))
        : null}
    </ActionRow>
  )
}

function ApprovalMenuItem({
  disabled,
  intent,
  label: customLabel,
  onSelect,
  sessionLabel,
  sessionTooltip
}: {
  disabled: boolean
  intent: Exclude<PositiveApprovalIntent, 'approve'>
  label?: string
  onSelect: () => void
  sessionLabel?: string
  sessionTooltip?: string
}): React.JSX.Element {
  const label =
    customLabel ??
    (intent === 'approveForSession'
      ? (sessionLabel ?? approvalIntentLabel(intent))
      : approvalIntentLabel(intent))
  if (intent !== 'approveForSession') {
    return (
      <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
        {label}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <span>{label}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <CircleHelpIcon aria-label="说明" className="ms-auto text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="left">
            {sessionTooltip ?? '仅在当前任务中自动允许相同类型的操作。'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </DropdownMenuItem>
  )
}

type PositiveApprovalIntent = Exclude<
  CodexApprovalResponse['action'],
  'decline' | 'cancel' | 'answer' | 'submitMcpForm' | 'approvePermissions'
>

type NegativeApprovalIntent = Extract<CodexApprovalResponse['action'], 'decline' | 'cancel'>

function isPositiveApprovalIntent<T extends CodexApprovalResponse['action']>(
  intent: T
): intent is Extract<T, PositiveApprovalIntent> {
  return (
    intent !== 'decline' &&
    intent !== 'cancel' &&
    intent !== 'answer' &&
    intent !== 'submitMcpForm' &&
    intent !== 'approvePermissions'
  )
}

function isNegativeApprovalIntent<T extends CodexApprovalResponse['action']>(
  intent: T
): intent is Extract<T, NegativeApprovalIntent> {
  return intent === 'decline' || intent === 'cancel'
}

function negativeApprovalIntentLabel(intent: NegativeApprovalIntent, busy: boolean): string {
  if (intent === 'decline') return busy ? '正在拒绝' : '拒绝并继续'
  return busy ? '正在停止' : '拒绝并停止'
}

function RequestShell({
  children,
  icon,
  method,
  subtitle,
  title
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  method?: string
  subtitle?: string
  title: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-col gap-2 px-4 pt-4 pb-3">
        {method ? (
          <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
            {icon ? <span className="shrink-0 [&_svg]:size-4">{icon}</span> : null}
            <span>{method}</span>
          </div>
        ) : null}
        <h2 className="min-w-0 text-sm leading-5 font-medium wrap-anywhere text-foreground">
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-3">{children}</div>
    </div>
  )
}

function ActionRow({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 pt-2 pb-4 @max-md/request-card:flex-col @max-md/request-card:items-end',
        className
      )}
    >
      {children}
    </div>
  )
}

function RejectButton({
  busy,
  disabled,
  onClick
}: {
  busy: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      className="rounded-full"
      disabled={disabled}
      onClick={onClick}
      size="composer"
      type="button"
      variant="outline"
    >
      <XIcon className="size-4" />
      {busy ? '正在拒绝' : '拒绝'}
    </Button>
  )
}

function approvalIntentLabel(intent: PositiveApprovalIntent): string {
  if (intent === 'approve') return '允许一次'
  if (intent === 'approveForSession') return '允许当前任务中的相似操作'
  if (intent === 'approveWithExecpolicyAmendment') return '允许并记住执行规则'
  return '允许并记住网络权限'
}

function initialMcpFormValues(fields: CodexMcpFormField[]): Record<string, CodexMcpFormValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.default !== undefined) return [[field.name, field.default]]
      if (field.kind === 'multi-select') return [[field.name, []]]
      return []
    })
  )
}

function normalizeRendererMcpFormValues(
  fields: CodexMcpFormField[],
  values: Record<string, CodexMcpFormValue>
): Record<string, CodexMcpFormValue> {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]))
  return Object.fromEntries(
    Object.entries(values).filter(([name, value]) => {
      const field = fieldsByName.get(name)
      return !(field?.kind === 'number' && !field.required && value === '')
    })
  )
}

function validateRendererMcpFormValues(
  fields: CodexMcpFormField[],
  values: Record<string, CodexMcpFormValue>
): string | undefined {
  for (const field of fields) {
    const value = values[field.name]
    if (value === undefined) {
      if (field.required) return `${field.label} 为必填项`
      continue
    }
    if (field.kind === 'text') {
      if (typeof value !== 'string') return `${field.label} 必须是文本`
      if (field.required && !value.trim()) return `${field.label} 为必填项`
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `${field.label} 内容过短`
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `${field.label} 内容过长`
      }
      continue
    }
    if (field.kind === 'number') {
      if (value === '') return `${field.label} 为必填项`
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${field.label} 必须是数字`
      if (field.integer && !Number.isInteger(value)) return `${field.label} 必须是整数`
      if (field.minimum !== undefined && value < field.minimum) return `${field.label} 小于最小值`
      if (field.maximum !== undefined && value > field.maximum) return `${field.label} 大于最大值`
      continue
    }
    if (field.kind === 'boolean') {
      if (typeof value !== 'boolean') return `${field.label} 必须为真或假`
      continue
    }
    const optionValues = new Set(field.options?.map((option) => option.value))
    if (field.kind === 'single-select') {
      if (typeof value !== 'string' || !optionValues.has(value)) return `请选择 ${field.label}`
      continue
    }
    if (!Array.isArray(value) || value.some((item) => !optionValues.has(item))) {
      return `${field.label} 包含无效选项`
    }
    if (field.required && value.length === 0) return `请选择 ${field.label}`
    if (field.minimum !== undefined && value.length < field.minimum) {
      return `${field.label} 选择数量不足`
    }
    if (field.maximum !== undefined && value.length > field.maximum) {
      return `${field.label} 选择数量过多`
    }
  }
  return undefined
}

function splitPath(path: string): { prefix: string; name: string } {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separator < 0) return { prefix: '', name: path }
  return { prefix: path.slice(0, separator + 1), name: path.slice(separator + 1) }
}

function countPatchLines(patch: string | undefined): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 }
  return patch.split('\n').reduce(
    (totals, line) => ({
      additions: totals.additions + (line.startsWith('+') && !line.startsWith('+++') ? 1 : 0),
      deletions: totals.deletions + (line.startsWith('-') && !line.startsWith('---') ? 1 : 0)
    }),
    { additions: 0, deletions: 0 }
  )
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
