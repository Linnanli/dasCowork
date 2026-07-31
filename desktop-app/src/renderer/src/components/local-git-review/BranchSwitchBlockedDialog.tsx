import { GitBranchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
  conflictedPaths: readonly string[]
  message?: string
  onCancel(): void
  onCommit(): void
}

export function BranchSwitchBlockedDialog({
  open,
  branch,
  conflictedPaths,
  message,
  onCancel,
  onCommit
}: Props): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent data-slot="branch-switch-blocked-dialog">
        <DialogHeader>
          <DialogTitle>Commit changes to switch branch</DialogTitle>
          <DialogDescription>Please commit your changes to continue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
            <GitBranchIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{branch}</span>
          </div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {conflictedPaths.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {conflictedPaths.map((path) => (
                <div key={path} className="border-b px-2 py-1.5 text-xs last:border-b-0">
                  {path}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Uncommitted files block this branch switch.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onCommit}>
            Commit and switch branch…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
