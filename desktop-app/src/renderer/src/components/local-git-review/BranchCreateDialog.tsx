/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Props = {
  open: boolean
  existingBranches: readonly string[]
  pending: boolean
  error?: string
  onOpenChange(open: boolean): void
  onCreate(branch: string): Promise<void> | void
  onError(error?: string): void
}

export function BranchCreateDialog({
  open,
  existingBranches,
  pending,
  error,
  onOpenChange,
  onCreate,
  onError
}: Props): React.JSX.Element {
  const [branch, setBranch] = useState('')

  useEffect(() => {
    if (open) {
      setBranch('')
      onError(undefined)
    }
  }, [onError, open])

  const validationError = useMemo(
    () => validateBranchName(branch, existingBranches),
    [branch, existingBranches]
  )
  const displayError = validationError ?? error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="branch-create-dialog">
        <DialogHeader>
          <DialogTitle>Create and checkout branch</DialogTitle>
          <DialogDescription>Create a local branch and switch to it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="branch-create-name">
            Branch name
          </label>
          <Input
            id="branch-create-name"
            aria-label="Branch name"
            aria-invalid={Boolean(displayError)}
            autoFocus
            value={branch}
            placeholder="feature/local-review"
            disabled={pending}
            onChange={(event) => {
              setBranch(event.target.value)
              onError(undefined)
            }}
          />
          {displayError ? (
            <p role="alert" className="text-xs text-destructive">
              {displayError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || Boolean(validationError)}
            onClick={() => void onCreate(branch.trim())}
          >
            {pending ? 'Creating…' : 'Create and checkout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function validateBranchName(
  branch: string,
  existingBranches: readonly string[]
): string | undefined {
  const value = branch.trim()
  if (!value) return 'Branch name is required'
  if (value.endsWith('/')) return 'Branch name cannot end with /'
  if (existingBranches.includes(value)) return 'Branch already exists'
  if (
    value.startsWith('/') ||
    value.endsWith('.') ||
    value.includes('//') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('\\') ||
    /[\s~^:?*[\]]/u.test(value) ||
    value.split('/').some((part) => part.length === 0 || part.endsWith('.lock'))
  ) {
    return 'Branch name must be a safe git ref'
  }
  return undefined
}
