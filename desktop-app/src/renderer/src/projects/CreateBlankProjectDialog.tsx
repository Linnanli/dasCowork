import { useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const DEFAULT_PROJECT_NAME = 'New project'

export type CreateBlankProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, operationId: string) => Promise<void>
}

export function CreateBlankProjectDialog({
  open,
  onOpenChange,
  onCreate
}: CreateBlankProjectDialogProps): React.JSX.Element {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(DEFAULT_PROJECT_NAME)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const resetForm = (): void => {
    setName(DEFAULT_PROJECT_NAME)
    setOperationId(crypto.randomUUID())
    setError(null)
    setCreating(false)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  const createProject = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const projectName = name.trim()
    if (!projectName) {
      setError('请输入项目名称')
      return
    }

    setCreating(true)
    setError(null)
    try {
      await onCreate(projectName, operationId)
      handleOpenChange(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={creating ? undefined : handleOpenChange}>
      <DialogContent
        data-slot="create-blank-project-dialog"
        className="bg-popover/90 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameInputRef.current?.focus()
          nameInputRef.current?.select()
        }}
      >
        <form className="grid gap-5" onSubmit={(event) => void createProject(event)}>
          <DialogHeader>
            <DialogTitle>为项目命名</DialogTitle>
            <DialogDescription>保持简短且易识别</DialogDescription>
          </DialogHeader>
          <label>
            <span className="sr-only">项目名称</span>
            <input
              ref={nameInputRef}
              aria-invalid={Boolean(error)}
              className="h-10 w-full rounded-md border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              data-slot="blank-project-name-input"
              disabled={creating}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={creating}
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button disabled={creating} type="submit">
              {creating ? '正在保存…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
