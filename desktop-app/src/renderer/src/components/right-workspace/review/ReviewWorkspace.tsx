import { LocalGitReviewPanel } from '@/components/local-git-review/LocalGitReviewPanel'
import { useLocalGitReview } from '@/components/local-git-review/LocalGitReviewProvider'

export function ReviewWorkspace(): React.JSX.Element {
  const { lastTurn, notifyGitOperation, setReviewSource, source, target } = useLocalGitReview()
  return (
    <LocalGitReviewPanel
      open
      target={target}
      source={source}
      lastTurn={lastTurn}
      onClose={() => undefined}
      onSourceChange={setReviewSource}
      onGitOperationFeedback={notifyGitOperation}
    />
  )
}
