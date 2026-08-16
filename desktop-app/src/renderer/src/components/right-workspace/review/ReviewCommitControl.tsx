import { GitCommitHorizontalIcon, LoaderCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCommitOrPushControl } from '@/components/local-git-review/CommitOrPushControlProvider'

export function ReviewCommitControl(): React.JSX.Element {
  const { pending, buttonEnabled, targetAvailable, openDialog, registerTrigger } =
    useCommitOrPushControl()

  return (
    <Button
      ref={(element) => {
        registerTrigger('review-toolbar', element)
      }}
      type="button"
      variant="outline"
      size="sm"
      disabled={!targetAvailable || pending || !buttonEnabled}
      title="提交或推送"
      onClick={() => void openDialog('review-toolbar')}
    >
      {pending ? <LoaderCircleIcon className="animate-spin" /> : <GitCommitHorizontalIcon />}
      提交或推送
    </Button>
  )
}
