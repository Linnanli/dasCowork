import { GitBranchIcon, GitCompareIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ReviewTargetChoice = 'base-branch' | 'uncommitted'

type Props = {
  pendingChoice?: ReviewTargetChoice
  disabled?: boolean
  onChooseBaseBranch(): void
  onChooseUncommitted(): void
}

export function ReviewTargetPicker({
  pendingChoice,
  disabled = false,
  onChooseBaseBranch,
  onChooseUncommitted
}: Props): React.JSX.Element {
  return (
    <div
      data-slot="review-target-picker"
      role="group"
      aria-label="Choose review target"
      className="grid gap-2"
    >
      <ReviewTargetButton
        icon={<GitCompareIcon className="size-4" />}
        label="Review against a base branch"
        pending={pendingChoice === 'base-branch'}
        disabled={disabled || Boolean(pendingChoice)}
        onClick={onChooseBaseBranch}
      />
      <ReviewTargetButton
        icon={<GitBranchIcon className="size-4" />}
        label="Review uncommitted changes"
        pending={pendingChoice === 'uncommitted'}
        disabled={disabled || Boolean(pendingChoice)}
        onClick={onChooseUncommitted}
      />
    </div>
  )
}

function ReviewTargetButton({
  icon,
  label,
  pending,
  disabled,
  onClick
}: {
  icon: React.ReactNode
  label: string
  pending: boolean
  disabled: boolean
  onClick(): void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-11 w-full justify-start rounded-md border px-3 text-left',
        pending && 'bg-accent text-accent-foreground'
      )}
      disabled={disabled}
      aria-busy={pending}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm">
        {pending ? 'Starting review…' : label}
      </span>
    </Button>
  )
}
