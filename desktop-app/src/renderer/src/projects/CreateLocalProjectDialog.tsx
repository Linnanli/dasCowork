import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import type { ProjectStateController } from './useProjectState'

export function CreateLocalProjectDialog({
  children,
  projectState
}: {
  children: ReactNode
  projectState: ProjectStateController
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [rootsText, setRootsText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createProject = async (): Promise<void> => {
    const sourceRoots = rootsText
      .split('\n')
      .map((root) => root.trim())
      .filter(Boolean)
    if (sourceRoots.length === 0) {
      setError('Add at least one source root.')
      return
    }

    try {
      await projectState.createLocalProject({
        name: name.trim() || undefined,
        sourceRoots
      })
      setName('')
      setRootsText('')
      setError(null)
      setOpen(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Local Project</DialogTitle>
          <DialogDescription>
            Store a named project with one or more trusted local source roots.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Name</span>
            <input
              className="h-9 rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Source roots</span>
            <textarea
              className="min-h-24 resize-y rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder="/Users/me/code/app"
              value={rootsText}
              onChange={(event) => setRootsText(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void createProject()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
