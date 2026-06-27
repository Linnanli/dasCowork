import { CheckIcon, ShieldCheckIcon, XIcon } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'

import type {
  CodexApprovalRequest,
  CodexApprovalResponse
} from '../../../../shared/codexIpcApi'

type ServerRequestPanelProps = {
  requests: readonly CodexApprovalRequest[]
  onRespond: (request: CodexApprovalRequest, response: CodexApprovalResponse) => Promise<void>
  onReject: (request: CodexApprovalRequest) => Promise<void>
}

type ActionState = 'approve' | 'approveForSession' | 'alwaysApprove' | 'decline' | 'answer'

export function ServerRequestPanel({
  requests,
  onRespond,
  onReject
}: ServerRequestPanelProps): React.JSX.Element | null {
  const request = requests[0]
  const [busyAction, setBusyAction] = useState<ActionState>()
  const [error, setError] = useState<string>()

  if (!request) return null

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
    <section
      className="border-t border-border/70 bg-background px-4 py-3"
      data-slot="server-request-panel"
    >
      <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-3">
        <div key={request.id}>
          {renderRequestBody(request, onRespond, onReject, runAction, busyAction)}
        </div>
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function renderRequestBody(
  request: CodexApprovalRequest,
  onRespond: ServerRequestPanelProps['onRespond'],
  onReject: ServerRequestPanelProps['onReject'],
  runAction: (action: ActionState, callback: () => Promise<void>) => Promise<void>,
  busyAction: ActionState | undefined
): React.JSX.Element {
  if (request.kind === 'tool-user-input') {
    return (
      <ToolUserInputRequest
        busy={Boolean(busyAction)}
        onReject={() => void runAction('decline', () => onReject(request))}
        onSubmit={(response) => void runAction('answer', () => onRespond(request, response))}
        request={request}
      />
    )
  }

  const approveOnce: CodexApprovalResponse = { action: 'approve' }
  const approveSession: CodexApprovalResponse = { action: 'approveForSession' }
  const approveAlways: CodexApprovalResponse = { action: 'alwaysApprove' }

  return (
    <RequestShell title={requestTitle(request)} method={request.kind}>
      <Detail label="Created" value={new Date(request.createdAt).toLocaleString()} />
      <Detail label="Parameters" value={formatUnknown(request.params)} />
      <ActionRow>
        <Button
          disabled={Boolean(busyAction)}
          onClick={() => void runAction('approve', () => onRespond(request, approveOnce))}
          size="sm"
          type="button"
        >
          <CheckIcon className="size-4" />
          Approve
        </Button>
        <Button
          disabled={Boolean(busyAction)}
          onClick={() =>
            void runAction('approveForSession', () => onRespond(request, approveSession))
          }
          size="sm"
          type="button"
          variant="secondary"
        >
          <ShieldCheckIcon className="size-4" />
          Approve session
        </Button>
        {request.kind === 'mcp-elicitation' ? (
          <Button
            disabled={Boolean(busyAction)}
            onClick={() =>
              void runAction('alwaysApprove', () => onRespond(request, approveAlways))
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            <ShieldCheckIcon className="size-4" />
            Always approve
          </Button>
        ) : null}
        <RejectButton
          busy={busyAction === 'decline'}
          disabled={Boolean(busyAction)}
          onClick={() => void runAction('decline', () => onReject(request))}
        />
      </ActionRow>
    </RequestShell>
  )
}

function ToolUserInputRequest({
  busy,
  onReject,
  onSubmit,
  request
}: {
  busy: boolean
  onReject: () => void
  onSubmit: (response: CodexApprovalResponse) => void
  request: CodexApprovalRequest
}): React.JSX.Element {
  const questions = readToolUserInputQuestions(request.params)
  const initialValues = useMemo(
    () => Object.fromEntries(questions.map((question) => [question.id, ''])),
    [questions]
  )
  const [values, setValues] = useState<Record<string, string>>(initialValues)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit({
      action: 'answer',
      answers: Object.fromEntries(
        questions.map((question) => [question.id, [values[question.id] ?? '']])
      )
    })
  }

  return (
    <RequestShell title="User input requested" method={request.kind}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {questions.map((question) => (
          <label className="flex flex-col gap-1.5" key={question.id}>
            <span className="text-sm font-medium text-foreground">{question.header}</span>
            <span className="text-sm text-muted-foreground">{question.question}</span>
            <input
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy}
              onChange={(event) =>
                setValues((current) => ({ ...current, [question.id]: event.target.value }))
              }
              type={question.isSecret ? 'password' : 'text'}
              value={values[question.id] ?? ''}
            />
          </label>
        ))}
        {questions.length === 0 ? <Detail label="Parameters" value={formatUnknown(request.params)} /> : null}
        <ActionRow>
          <Button disabled={busy} size="sm" type="submit">
            <CheckIcon className="size-4" />
            Submit answers
          </Button>
          <RejectButton busy={busy} disabled={busy} onClick={onReject} />
        </ActionRow>
      </form>
    </RequestShell>
  )
}

function RequestShell({
  children,
  method,
  title
}: {
  children: React.ReactNode
  method: string
  title: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{method}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">{value}</dd>
    </dl>
  )
}

function ActionRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
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
    <Button disabled={disabled} onClick={onClick} size="sm" type="button" variant="outline">
      <XIcon className="size-4" />
      {busy ? 'Rejecting' : 'Reject'}
    </Button>
  )
}

function requestTitle(request: CodexApprovalRequest): string {
  if (request.kind === 'command') return 'Command execution approval'
  if (request.kind === 'file-change') return 'File change approval'
  if (request.kind === 'tool-user-input') return 'User input requested'
  return 'MCP approval requested'
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ToolUserInputQuestion = {
  id: string
  header: string
  question: string
  isSecret?: boolean
}

function readToolUserInputQuestions(params: unknown): ToolUserInputQuestion[] {
  if (!params || typeof params !== 'object') return []
  const questions = (params as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((question) => {
    if (!question || typeof question !== 'object') return []
    const record = question as Record<string, unknown>
    if (typeof record.id !== 'string') return []
    const header = typeof record.header === 'string' ? record.header : record.id
    const text = typeof record.question === 'string' ? record.question : header
    return [{ id: record.id, header, question: text, isSecret: record.isSecret === true }]
  })
}
