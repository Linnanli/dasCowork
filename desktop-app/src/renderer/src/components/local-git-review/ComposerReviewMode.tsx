import { useCallback, useState } from 'react'
import { AlertCircleIcon, XIcon } from 'lucide-react'

import type { LocalGitTarget } from '../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'

import { ReviewBaseBranchPicker } from './ReviewBaseBranchPicker'
import { ReviewTargetPicker, type ReviewTargetChoice } from './ReviewTargetPicker'

export type ComposerReviewSelection =
  | { type: 'uncommitted' }
  | { type: 'base-branch'; baseBranch: string }

export type ComposerReviewDelivery = 'inline' | 'detached'

type Step = 'choose-target' | 'choose-base'

type Props = {
  target?: LocalGitTarget
  disabled?: boolean
  delivery?: ComposerReviewDelivery
  error?: string
  onCancel(): void
  onDeliveryChange?(delivery: ComposerReviewDelivery): void
  onSubmit(selection: ComposerReviewSelection): void | Promise<void>
  onError?(message: string): void
}

export function ComposerReviewMode({
  target,
  disabled = false,
  delivery = 'inline',
  error,
  onCancel,
  onDeliveryChange = () => undefined,
  onSubmit,
  onError
}: Props): React.JSX.Element {
  const [step, setStep] = useState<Step>('choose-target')
  const [pendingChoice, setPendingChoice] = useState<ReviewTargetChoice>()
  const [pendingBranch, setPendingBranch] = useState<string>()
  const [localError, setLocalError] = useState<string>()
  const visibleError = error ?? localError

  const submit = async (selection: ComposerReviewSelection): Promise<void> => {
    setLocalError(undefined)
    if (selection.type === 'uncommitted') setPendingChoice('uncommitted')
    else {
      setPendingChoice('base-branch')
      setPendingBranch(selection.baseBranch)
    }
    try {
      await onSubmit(selection)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to start review'
      setLocalError(message)
      onError?.(message)
    } finally {
      setPendingChoice(undefined)
      setPendingBranch(undefined)
    }
  }

  const chooseBaseBranch = (): void => {
    setLocalError(undefined)
    setStep('choose-base')
  }

  const cancelBaseBranch = (): void => {
    setLocalError(undefined)
    setStep('choose-target')
  }

  const handleBranchLoadError = useCallback(
    (message: string) => {
      setLocalError(message)
      onError?.(message)
    },
    [onError]
  )

  return (
    <div
      data-slot="composer-review-mode"
      className="grid gap-2 rounded-md border bg-background p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Review</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close Review Mode"
          onClick={onCancel}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div role="group" aria-label="Review delivery" className="flex gap-1">
        <Button
          type="button"
          size="xs"
          variant={delivery === 'inline' ? 'secondary' : 'ghost'}
          aria-pressed={delivery === 'inline'}
          onClick={() => onDeliveryChange('inline')}
        >
          Review in this task
        </Button>
        <Button
          type="button"
          size="xs"
          variant={delivery === 'detached' ? 'secondary' : 'ghost'}
          aria-pressed={delivery === 'detached'}
          onClick={() => onDeliveryChange('detached')}
        >
          Review in a new task
        </Button>
      </div>

      {visibleError ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          <AlertCircleIcon className="size-3.5" />
          {visibleError}
        </p>
      ) : null}

      {step === 'choose-target' ? (
        <ReviewTargetPicker
          disabled={disabled}
          pendingChoice={pendingChoice}
          onChooseBaseBranch={chooseBaseBranch}
          onChooseUncommitted={() => void submit({ type: 'uncommitted' })}
        />
      ) : (
        <ReviewBaseBranchPicker
          target={target}
          pendingBranch={pendingBranch}
          onCancel={cancelBaseBranch}
          onError={handleBranchLoadError}
          onSelectBranch={(baseBranch) => void submit({ type: 'base-branch', baseBranch })}
        />
      )}
    </div>
  )
}
