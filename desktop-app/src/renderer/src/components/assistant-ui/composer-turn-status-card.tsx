import { CheckCircle2Icon, CircleIcon, Loader2Icon } from 'lucide-react'
import { useId, useState } from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type {
  ComposerPlanStatus,
  ComposerPlanStep,
  ComposerTurnStatus
} from '@/lib/composerTurnStatus'
import { cn } from '@/lib/utils'

type ComposerTurnStatusCardProps = {
  status?: ComposerTurnStatus | null
}

const PROGRESS_CIRCLE_RADIUS = 8
const PROGRESS_CIRCLE_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_CIRCLE_RADIUS

export function ComposerTurnStatusCard({
  status
}: ComposerTurnStatusCardProps): React.JSX.Element | null {
  if (!status?.plan && !status?.diff) return null

  if (!status.plan) {
    return (
      <div
        aria-live="polite"
        data-slot="composer-turn-status-card"
        className={STATUS_PILL_CLASS_NAME}
        role="status"
      >
        <StatusPill status={status} />
      </div>
    )
  }

  return <PlanStatusHoverCard status={{ ...status, plan: status.plan }} />
}

function PlanStatusHoverCard({
  status
}: {
  status: ComposerTurnStatus & { plan: ComposerPlanStatus }
}): React.JSX.Element {
  const planContentId = useId()
  const [planOpen, setPlanOpen] = useState(false)

  return (
    <HoverCard open={planOpen} onOpenChange={setPlanOpen} openDelay={0} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-controls={planContentId}
          aria-expanded={planOpen}
          aria-live="polite"
          aria-label={statusCardAriaLabel(status)}
          data-slot="composer-turn-status-card"
          className={cn(
            STATUS_PILL_CLASS_NAME,
            'outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
        >
          <StatusPill status={status} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        id={planContentId}
        data-slot="composer-turn-plan-card"
        side="top"
        align="center"
        sideOffset={8}
        className="max-h-[min(24rem,var(--radix-hover-card-content-available-height))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl bg-popover/95 p-3 shadow-xl backdrop-blur-md"
      >
        <PlanStepList plan={status.plan} />
      </HoverCardContent>
    </HoverCard>
  )
}

const STATUS_PILL_CLASS_NAME =
  'mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 overflow-hidden rounded-full border border-border/80 bg-muted/80 px-4 py-2.5 text-sm text-foreground shadow-sm backdrop-blur-md'

function statusCardAriaLabel(status: ComposerTurnStatus): string {
  const plan = status.plan
  const diff = status.diff
  const labels = plan ? [`查看执行计划，第 ${plan.currentStep} / ${plan.totalSteps} 步`] : []
  if (!diff) return labels.join('，')

  labels.push(`${diff.filesChanged} 个文件已更改`)
  if (diff.additions > 0) labels.push(`新增 ${diff.additions} 行`)
  if (diff.deletions > 0) labels.push(`删除 ${diff.deletions} 行`)
  return labels.join('，')
}

function StatusPill({ status }: { status: ComposerTurnStatus }): React.JSX.Element {
  const { plan, diff } = status

  return (
    <>
      {plan ? (
        <span data-slot="composer-turn-plan-summary" className="flex shrink-0 items-center gap-2.5">
          <PlanProgressRing progressPercent={plan.progressPercent} />
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            第 {plan.currentStep} / {plan.totalSteps} 步
          </span>
        </span>
      ) : null}
      {plan && diff ? (
        <span
          aria-hidden
          data-slot="composer-turn-status-separator"
          className="text-muted-foreground"
        >
          ·
        </span>
      ) : null}
      {diff ? (
        <span
          data-slot="composer-turn-diff-summary"
          className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap tabular-nums"
        >
          <span className="min-w-0 truncate text-muted-foreground">
            {diff.filesChanged} 个文件已更改
          </span>
          {diff.additions > 0 ? (
            <span className="shrink-0 text-emerald-500 dark:text-emerald-400">
              +{diff.additions}
            </span>
          ) : null}
          {diff.deletions > 0 ? (
            <span className="shrink-0 text-red-500 dark:text-red-400">-{diff.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </>
  )
}

function PlanProgressRing({ progressPercent }: { progressPercent: number }): React.JSX.Element {
  const clampedProgress = Math.min(100, Math.max(0, progressPercent))
  const dashOffset = PROGRESS_CIRCLE_CIRCUMFERENCE * (1 - clampedProgress / 100)

  return (
    <svg
      aria-hidden
      data-slot="composer-turn-plan-progress"
      className="size-[1em] shrink-0 -rotate-90"
      viewBox="0 0 20 20"
    >
      <circle
        cx="10"
        cy="10"
        r={PROGRESS_CIRCLE_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-muted-foreground/25"
      />
      <circle
        cx="10"
        cy="10"
        r={PROGRESS_CIRCLE_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={PROGRESS_CIRCLE_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        className="text-blue-500 transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  )
}

function PlanStepList({ plan }: { plan: ComposerPlanStatus }): React.JSX.Element {
  return (
    <ol aria-label="执行计划" data-slot="composer-turn-plan-list" className="space-y-1">
      {plan.steps.map((step, index) => (
        <PlanStepRow key={`${step.label}:${index}`} step={step} />
      ))}
    </ol>
  )
}

function PlanStepRow({ step }: { step: ComposerPlanStep }): React.JSX.Element {
  const completed = step.status === 'completed'

  return (
    <li
      data-slot="composer-turn-plan-step"
      data-status={step.status}
      className="flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-sm"
    >
      <PlanStepStatusIcon status={step.status} />
      <span
        className={cn(
          'min-w-0 break-words leading-snug [overflow-wrap:anywhere]',
          completed ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {step.label}
      </span>
    </li>
  )
}

function PlanStepStatusIcon({ status }: { status: ComposerPlanStep['status'] }): React.JSX.Element {
  if (status === 'completed') {
    return <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  }

  if (status === 'in-progress') {
    return (
      <Loader2Icon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
      />
    )
  }

  return <CircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}
