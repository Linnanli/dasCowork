/* eslint-disable react-hooks/set-state-in-effect -- effects synchronize the signed Git summary with the active conversation. */
import { useEffect, useState } from 'react'
import { LoaderCircleIcon, PencilLineIcon } from 'lucide-react'

import type { LocalGitSummary } from '../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import { useGitRepository } from './GitRepositoryProvider'
import { useLocalGitReview } from './LocalGitReviewProvider'

export function ConversationChangesRow(): React.JSX.Element {
  const repository = useGitRepository()
  const target = repository.status === 'ready' ? repository.target : undefined
  const { openReview } = useLocalGitReview()
  const git = window.desktopApp?.git
  const [summary, setSummary] = useState<LocalGitSummary>()
  const [loading, setLoading] = useState(repository.status === 'loading')
  const [refreshRevision, setRefreshRevision] = useState(0)

  useEffect(() => {
    let active = true
    if (!target || !git) {
      setSummary(undefined)
      setLoading(repository.status === 'loading')
      return () => {
        active = false
      }
    }
    setLoading(true)
    try {
      void git
        .getSummary({ target })
        .then((next) => {
          if (active) setSummary(next)
        })
        .catch(() => {
          if (active) setSummary(undefined)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    } catch {
      if (active) {
        setSummary(undefined)
        setLoading(false)
      }
    }
    return () => {
      active = false
    }
  }, [git, refreshRevision, repository.status, target])

  useEffect(() => {
    if (!target || !git) return
    return git.subscribe?.((event) => {
      if (
        event.target.conversationId === target.conversationId &&
        event.target.threadId === target.threadId
      ) {
        setRefreshRevision((revision) => revision + 1)
      }
    })
  }, [git, target])

  const available = Boolean(target && git && summary?.gitRoot)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-slot="conversation-changes-row"
      aria-label="Changes"
      disabled={!available}
      onClick={() => openReview({ type: 'unstaged' })}
      className="h-7 w-full justify-between px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
      title={
        available
          ? 'Review changes'
          : unavailableReviewTitle(
              repository.reason ?? repository.error?.message ?? summary?.unavailableReason
            )
      }
    >
      <span className="flex items-center gap-1.5">
        <PencilLineIcon className="size-3.5" />
        <span>Changes</span>
      </span>
      {loading ? (
        <LoaderCircleIcon aria-label="Loading changes" className="size-3.5 animate-spin" />
      ) : summary ? (
        <span className="tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{summary.additions}</span>
          <span className="ml-1 text-red-600 dark:text-red-400">-{summary.deletions}</span>
        </span>
      ) : null}
    </Button>
  )
}

function unavailableReviewTitle(reason: string | undefined): string {
  if (!reason) return 'Git review is unavailable'
  if (/not a git repository|rev-parse.*exit code 128/iu.test(reason)) {
    return 'Git review is unavailable: this folder is not a Git repository.'
  }
  return `Git review is unavailable: ${reason}`
}
