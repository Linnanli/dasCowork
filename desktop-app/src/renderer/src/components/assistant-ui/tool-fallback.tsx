/* eslint-disable @typescript-eslint/explicit-function-return-type, react/prop-types */
'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { AlertCircleIcon, ChevronDownIcon, XCircleIcon } from 'lucide-react'
import {
  useScrollLock,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent
} from '@assistant-ui/react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FilePath } from '@/components/ui/file-path'
import { DiffViewer } from './diff-viewer'
import { toolGroupIconMap } from './tool-group'
import {
  shellMetadata,
  shellOutputText,
  type ToolItemDisplay,
  type ToolItemFileChangeDetails,
  type ToolItemFileChangeStats,
  type ToolItemShellDetails
} from '@/lib/toolActivityDisplay'
import type { ToolGroupIconName } from '@/lib/toolGroupSummary'

const ANIMATION_DURATION = 200

const pressable = 'active:scale-[0.98]'

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll()
      if (!isControlled) {
        setUncontrolledOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [lockScroll, isControlled, controlledOnOpenChange]
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('aui-tool-fallback-root group/tool-fallback-root w-full', className)}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  )
}

type ToolStatus = ToolCallMessagePartStatus['type']

const statusIconMap: Partial<Record<ToolStatus, React.ElementType>> = {
  incomplete: XCircleIcon,
  'requires-action': AlertCircleIcon
}

type ToolFallbackProps = ToolCallMessagePartProps & {
  display?: ToolItemDisplay
  summaryLabel?: string
  summaryIcon?: ToolGroupIconName
  args?: unknown
  input?: unknown
  output?: unknown
}

type AnyRecord = Record<string, unknown>

function ToolFallbackTrigger({
  toolName,
  summaryLabel,
  summaryIcon,
  filePath,
  fileChangeStats,
  statusLabel,
  status,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string
  summaryLabel?: string
  summaryIcon?: ToolGroupIconName
  filePath?: string
  fileChangeStats?: ToolItemFileChangeStats
  statusLabel?: string
  status?: ToolCallMessagePartStatus
}) {
  const statusType = status?.type ?? 'complete'
  const isRunning = statusType === 'running'
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const visibleStatusLabel = visibleTriggerStatusLabel(summaryLabel, statusLabel)

  const Icon =
    statusIconMap[statusType] ?? (summaryIcon ? toolGroupIconMap[summaryIcon] : undefined)
  const label = isCancelled ? 'Cancelled tool' : 'Used tool'
  const labelContent =
    summaryLabel && filePath ? (
      <span className="inline-flex min-w-0 items-baseline gap-1.5">
        {visibleStatusLabel ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {visibleStatusLabel}
          </span>
        ) : null}
        <span className="inline-flex min-w-0 items-baseline gap-0.5">
          <span className="shrink-0">{toolItemLabelPrefix(summaryLabel, filePath)}：</span>
          <FilePath path={filePath} className="max-w-48" />
          {fileChangeStats ? (
            <span data-slot="tool-file-change-stats" className="inline-flex shrink-0 gap-1 text-xs">
              <span className="text-muted-foreground group-hover/tool-fallback-root:text-emerald-700 dark:group-hover/tool-fallback-root:text-emerald-300">
                +{fileChangeStats.additions}
              </span>
              <span className="text-muted-foreground group-hover/tool-fallback-root:text-red-700 dark:group-hover/tool-fallback-root:text-red-300">
                -{fileChangeStats.deletions}
              </span>
            </span>
          ) : null}
        </span>
      </span>
    ) : summaryLabel ? (
      <span className="inline-flex min-w-0 items-baseline gap-1.5">
        {visibleStatusLabel ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {visibleStatusLabel}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{summaryLabel}</span>
      </span>
    ) : (
      <span>
        {label}: <b>{toolName}</b>
      </span>
    )

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      className={cn(
        'aui-tool-fallback-trigger group/trigger text-muted-foreground hover:text-foreground flex w-fit origin-left items-center gap-2 py-1.5 text-sm transition-colors',
        className
      )}
      {...props}
    >
      {Icon ? (
        <Icon
          data-slot="tool-fallback-trigger-icon"
          className={cn(
            'aui-tool-fallback-trigger-icon size-4 shrink-0',
            isCancelled && 'text-muted-foreground'
          )}
        />
      ) : null}
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          'aui-tool-fallback-trigger-label-wrapper relative inline-block text-start leading-none',
          isCancelled && 'text-muted-foreground line-through'
        )}
      >
        {labelContent}
        {isRunning && (
          <span
            aria-hidden
            data-slot="tool-fallback-trigger-shimmer"
            className="aui-tool-fallback-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {labelContent}
          </span>
        )}
      </span>
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className={cn(
          'aui-tool-fallback-trigger-chevron size-4 shrink-0',
          'transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          'group-data-[state=closed]/trigger:-rotate-90',
          'group-data-[state=open]/trigger:rotate-0'
        )}
      />
    </CollapsibleTrigger>
  )
}

function toolItemLabelPrefix(summaryLabel: string, filePath: string): string {
  const suffix = `：${filePath}`
  return summaryLabel.endsWith(suffix) ? summaryLabel.slice(0, -suffix.length) : summaryLabel
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        'aui-tool-fallback-content relative overflow-hidden text-sm outline-none',
        'group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
        'data-[state=closed]:animate-collapsible-up',
        'data-[state=open]:animate-collapsible-down',
        'data-[state=closed]:fill-mode-forwards',
        'data-[state=closed]:pointer-events-none',
        'data-[state=open]:duration-(--animation-duration)',
        'data-[state=closed]:duration-(--animation-duration)',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'flex flex-col gap-2 ps-6 pt-1 pb-2 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
          'group-data-[state=open]/collapsible-content:animate-in group-data-[state=open]/collapsible-content:fade-in-0 group-data-[state=open]/collapsible-content:blur-in-[2px] group-data-[state=open]/collapsible-content:slide-in-from-top-1',
          'group-data-[state=closed]/collapsible-content:animate-out group-data-[state=closed]/collapsible-content:fade-out-0 group-data-[state=closed]/collapsible-content:blur-out-[2px] group-data-[state=closed]/collapsible-content:slide-out-to-top-1',
          'group-data-[state=closed]/collapsible-content:duration-(--animation-duration) group-data-[state=open]/collapsible-content:duration-(--animation-duration)'
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  )
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  argsText?: string
}) {
  if (!argsText) return null

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn('aui-tool-fallback-args', className)}
      {...props}
    >
      <pre className="aui-tool-fallback-args-value bg-muted/50 text-foreground/90 rounded-md p-2.5 text-xs whitespace-pre-wrap">
        {argsText}
      </pre>
    </div>
  )
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  result?: unknown
}) {
  if (result === undefined) return null

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn('aui-tool-fallback-result', className)}
      {...props}
    >
      <p className="aui-tool-fallback-result-header text-muted-foreground text-xs font-medium">
        Result:
      </p>
      <pre className="aui-tool-fallback-result-content bg-muted/50 text-foreground/90 mt-1 rounded-md p-2.5 text-xs whitespace-pre-wrap">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}

function ToolFallbackFileChange({
  details,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  details: ToolItemFileChangeDetails
}) {
  const files = details.files.filter(fileChangeHasRenderableDiff)

  if (files.length === 0) {
    return (
      <p
        data-slot="tool-file-change-diff"
        className={cn(
          'rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground',
          className
        )}
        {...props}
      >
        {details.files.length === 0 ? '正在等待文件差异' : '文件变更未提供可展示的差异'}
      </p>
    )
  }

  return (
    <div
      data-slot="tool-file-change-diff"
      className={cn('max-h-96 space-y-2 overflow-y-auto pe-1', className)}
      {...props}
    >
      {files.map((file, index) => (
        <FileChangeDiffViewer
          key={`${file.path}:${index}`}
          path={file.path}
          kind={file.kind}
          patch={file.patch}
        />
      ))}
    </div>
  )
}

function FileChangeDiffViewer({
  path,
  kind,
  patch
}: ToolItemFileChangeDetails['files'][number]): React.JSX.Element {
  if (kind === 'add') {
    return (
      <DiffViewer
        oldFile={{ content: '', name: path }}
        newFile={{ content: patch ?? '', name: path }}
        size="sm"
      />
    )
  }
  if (kind === 'delete') {
    return (
      <DiffViewer
        oldFile={{ content: patch ?? '', name: path }}
        newFile={{ content: '', name: path }}
        size="sm"
      />
    )
  }

  return <DiffViewer patch={fileChangePatch(path, patch)} size="sm" />
}

function fileChangeHasRenderableDiff(file: ToolItemFileChangeDetails['files'][number]): boolean {
  return (
    file.kind === 'add' || file.kind === 'delete' || Boolean(fileChangePatch(file.path, file.patch))
  )
}

function fileChangePatch(path: string, patch: string | undefined): string | undefined {
  if (!patch?.trim()) return undefined

  const normalizedPath = path.replace(/^[/\\]+/, '') || 'file'
  const hasFileHeaders = /^(?:diff --git |--- )/m.test(patch)
  const diff = hasFileHeaders ? patch : `--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${patch}`
  if (/^@@/m.test(diff)) return diff

  const lines = diff.split('\n')
  const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---'))
  if (additions.length === 0 && deletions.length === 0) return diff

  const oldStart = deletions.length > 0 ? 1 : 0
  const newStart = additions.length > 0 ? 1 : 0
  const newHeaderIndex = lines.findIndex((line) => line.startsWith('+++'))
  if (newHeaderIndex < 0) return diff

  return [
    ...lines.slice(0, newHeaderIndex + 1),
    `@@ -${oldStart},${deletions.length} +${newStart},${additions.length} @@`,
    ...lines.slice(newHeaderIndex + 1)
  ].join('\n')
}

function ToolFallbackShell({
  details,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  details?: ToolItemShellDetails
}) {
  if (!details) return null

  const shellText = shellOutputText(details)
  const metadata = shellMetadata(details)
  if (!shellText && metadata.length === 0) return null

  return (
    <div
      data-slot="tool-fallback-shell"
      className={cn(
        'aui-tool-fallback-shell overflow-hidden rounded-md border border-border/50 bg-muted/40',
        className
      )}
      {...props}
    >
      {shellText ? (
        <pre
          data-slot="tool-fallback-shell-output"
          className="aui-tool-fallback-shell-output max-h-80 overflow-auto p-2.5 font-mono text-xs whitespace-pre-wrap text-foreground/90"
        >
          {shellText}
        </pre>
      ) : null}
      {metadata.length > 0 ? (
        <p
          data-slot="tool-fallback-shell-meta"
          className="aui-tool-fallback-shell-meta border-t border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          {metadata.join(' | ')}
        </p>
      ) : null}
    </div>
  )
}

function ToolFallbackError({
  error,
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  error?: unknown
  status?: ToolCallMessagePartStatus
}) {
  const errorText = error ? (typeof error === 'string' ? error : JSON.stringify(error)) : null

  if (!errorText) return null

  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const headerText = isCancelled ? 'Cancelled reason:' : 'Error:'

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn('aui-tool-fallback-error', className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header text-muted-foreground font-semibold">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">{errorText}</p>
    </div>
  )
}

const APPROVED_RESULT = 'Approved by user'
const DENIED_RESULT = 'User denied tool execution'

function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  ...props
}: React.ComponentProps<'div'> &
  Partial<Pick<ToolCallMessagePartProps, 'addResult' | 'resume'>> & {
    interrupt?: ToolCallMessagePart['interrupt']
    approval?: ToolCallMessagePart['approval']
  }) {
  const [submitted, setSubmitted] = useState(false)

  if (approval != null) {
    if (approval.approved !== undefined || approval.resolution !== undefined) return null
    return (
      <p
        data-slot="tool-fallback-approval-panel-hint"
        className={cn(
          'aui-tool-fallback-approval-panel-hint text-muted-foreground pt-1',
          className
        )}
        {...props}
      >
        Approval is pending in the approval panel.
      </p>
    )
  }

  const respond = (approved: boolean) => {
    if (submitted) return
    if (interrupt) {
      resume?.({ approved })
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT)
    }
    setSubmitted(true)
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn('aui-tool-fallback-approval flex items-center gap-2 pt-1', className)}
      {...props}
    >
      <Button size="sm" className={pressable} onClick={() => respond(true)} disabled={submitted}>
        Allow
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={pressable}
        onClick={() => respond(false)}
        disabled={submitted}
      >
        Deny
      </Button>
    </div>
  )
}

const ToolFallbackImpl = ({
  toolName,
  display,
  summaryLabel,
  summaryIcon,
  argsText,
  args,
  input,
  result,
  output,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  ...partRest
}) => {
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const isRequiresAction = status?.type === 'requires-action'

  const [open, setOpen] = useState(display?.defaultOpen ?? isRequiresAction)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) setOpen(true)
  }

  const shellDetails = display?.details.shell
  const fileChangeDetails = display?.details.fileChange
  const fallbackArgsText = display?.details.argsText ?? argsText ?? formattedJson(args ?? input)
  const fallbackResult = display?.details.result ?? result ?? output
  const fallbackApproval =
    approval ?? (display?.details.approval as ToolCallMessagePart['approval'] | undefined)
  const showShellResult =
    display?.details.showResult ??
    shouldRenderShellResult(fallbackResult, partRest.isError === true)

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger
        toolName={toolName}
        summaryLabel={display?.label ?? summaryLabel}
        summaryIcon={display?.icon ?? summaryIcon}
        filePath={display?.filePath}
        fileChangeStats={display?.fileChangeStats}
        statusLabel={display?.statusLabel}
        status={status}
      />
      <ToolFallbackContent>
        <ToolFallbackError error={display?.details.error ?? status?.error} status={status} />
        {fileChangeDetails ? (
          <ToolFallbackFileChange
            details={fileChangeDetails}
            className={cn(isCancelled && 'opacity-60')}
          />
        ) : shellDetails ? (
          <ToolFallbackShell details={shellDetails} className={cn(isCancelled && 'opacity-60')} />
        ) : (
          <ToolFallbackArgs
            argsText={fallbackArgsText}
            className={cn(isCancelled && 'opacity-60')}
          />
        )}
        {isRequiresAction && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={fallbackApproval}
          />
        )}
        {!fileChangeDetails && !isCancelled && (!shellDetails || showShellResult) && (
          <ToolFallbackResult result={fallbackResult} />
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}

function shouldRenderShellResult(result: unknown, isError: boolean): boolean {
  if (result === undefined) return false
  if (isError) return true

  const record = recordValue(result)
  if (!record) return true
  if (record.error !== undefined) return true
  if (record.isError === true) return true

  const item = recordValue(record.item)
  if (stringValue(item?.type) === 'commandExecution') return false
  if (stringValue(record.type) === 'commandExecution') return false

  return true
}

function visibleTriggerStatusLabel(
  summaryLabel: string | undefined,
  statusLabel: string | undefined
): string | undefined {
  if (!statusLabel || statusLabel === '已完成') return undefined
  if (!summaryLabel) return statusLabel
  if (labelImpliesStatus(summaryLabel, statusLabel)) return undefined
  return statusLabel
}

function labelImpliesStatus(label: string, statusLabel: string): boolean {
  if (label.includes(statusLabel)) return true
  if (statusLabel === '正在运行' && label.startsWith('正在')) return true
  if (statusLabel === '已停止' && label.startsWith('已停止')) return true
  if (statusLabel === '出错' && label.includes('出错')) return true
  if (statusLabel === '等待审批' && label.includes('等待审批')) return true
  if (statusLabel === '状态混合' && label.includes('状态混合')) return true
  return false
}

function formattedJson(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function recordValue(value: unknown): AnyRecord | undefined {
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null
}

const ToolFallback = memo(ToolFallbackImpl) as unknown as ToolCallMessagePartComponent & {
  (props: ToolFallbackProps): React.ReactElement | null
  Root: typeof ToolFallbackRoot
  Trigger: typeof ToolFallbackTrigger
  Content: typeof ToolFallbackContent
  Args: typeof ToolFallbackArgs
  Result: typeof ToolFallbackResult
  Error: typeof ToolFallbackError
  Approval: typeof ToolFallbackApproval
}

ToolFallback.displayName = 'ToolFallback'
ToolFallback.Root = ToolFallbackRoot
ToolFallback.Trigger = ToolFallbackTrigger
ToolFallback.Content = ToolFallbackContent
ToolFallback.Args = ToolFallbackArgs
ToolFallback.Result = ToolFallbackResult
ToolFallback.Error = ToolFallbackError
ToolFallback.Approval = ToolFallbackApproval

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackApproval
}
