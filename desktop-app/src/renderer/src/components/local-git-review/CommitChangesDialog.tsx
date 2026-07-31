/* eslint-disable @typescript-eslint/explicit-function-return-type, react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { GitBranchIcon, LoaderCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  branch: string
  uncommittedFileCount: number
  pendingPhase?: 'committing' | 'switching-branch'
  onOpenChange(open: boolean): void
  onCommit(message: string, includeUnstaged: boolean): Promise<void>
}

export function CommitChangesDialog({
  open,
  branch,
  uncommittedFileCount,
  pendingPhase,
  onOpenChange,
  onCommit
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (open) {
      setMessage('')
      setIncludeUnstaged(true)
      setPending(false)
      setError(undefined)
    }
  }, [open])

  const submit = async () => {
    setPending(true)
    setError(undefined)
    try {
      await onCommit(message, includeUnstaged)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to commit changes')
    } finally {
      setPending(false)
    }
  }

  const isPending = pending || pendingPhase !== undefined
  const pendingLabel = pendingPhase === 'switching-branch' ? 'Switching branch…' : 'Committing…'

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
      <DialogContent data-slot="commit-changes-dialog">
        <DialogHeader>
          <DialogTitle>Commit</DialogTitle>
          <DialogDescription>Commit local changes before switching branches.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
            <GitBranchIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{branch}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {uncommittedFileCount} files currently shown. The latest changes will be used when you
            commit.
          </p>
          <label className="space-y-2 text-sm font-medium">
            <span>Commit message</span>
            <textarea
              aria-label="Commit message"
              className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Commit message (leave blank to generate)…"
              value={message}
              disabled={isPending}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeUnstaged}
              disabled={isPending}
              onCheckedChange={(checked) => setIncludeUnstaged(checked === true)}
            />
            Include unstaged changes
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={isPending} onClick={() => void submit()}>
            {isPending ? (
              <>
                <LoaderCircleIcon className="size-3.5 animate-spin" /> {pendingLabel}
              </>
            ) : (
              'Commit'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
