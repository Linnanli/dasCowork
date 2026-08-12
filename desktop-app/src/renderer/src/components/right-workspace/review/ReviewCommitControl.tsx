import { GitCommitHorizontalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CommitChangesDialog } from '@/components/local-git-review/CommitChangesDialog'
import { Button } from '@/components/ui/button'
import type { LocalBranchSummary } from '../../../../../shared/localGitApi'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

export function ReviewCommitControl({ controller }: { controller: ReviewWorkspaceController }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<LocalBranchSummary>()
  const uncommittedFileCount = controller.loadState.status === 'ready' ? controller.loadState.groups.length : 0

  useEffect(() => {
    if (!controller.target) return
    let active = true
    void window.desktopApp.git.listBranches({ target: controller.target }).then(
      (summary) => active && setBranches(summary),
      () => active && setBranches(undefined)
    )
    return () => {
      active = false
    }
  }, [controller.target])

  const commit = async (message: string, includeUnstaged: boolean): Promise<void> => {
    if (!controller.target) throw new Error('当前项目不可提交。')
    const result = await window.desktopApp.git.commitChanges({
      target: controller.target,
      message: message.trim(),
      includeUnstaged
    })
    if (result.status !== 'success') throw new Error(result.message ?? '提交失败。')
    setOpen(false)
    controller.refresh()
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!controller.target || uncommittedFileCount === 0}
        title="提交或推送"
        onClick={() => setOpen(true)}
      >
        <GitCommitHorizontalIcon />
        提交或推送
      </Button>
      <CommitChangesDialog
        open={open}
        branch={branches?.current ?? '当前分支'}
        uncommittedFileCount={uncommittedFileCount}
        onOpenChange={setOpen}
        onCommit={commit}
      />
    </>
  )
}
