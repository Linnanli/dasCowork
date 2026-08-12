import {
  Columns2Icon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  PanelRightIcon,
  RefreshCwIcon,
  Rows3Icon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReviewJumpToFileMenu } from './ReviewJumpToFileMenu'
import { ReviewCommitControl } from './ReviewCommitControl'
import { ReviewOptionsMenu } from './ReviewOptionsMenu'
import { ReviewSourceMenu } from './ReviewSourceMenu'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  lastTurnId?: string
}

export function ReviewToolbar({ controller, lastTurnId }: Props): React.JSX.Element {
  const groups = controller.loadState.status === 'ready' ? controller.loadState.groups : []
  const totals = groups.reduce(
    (result, group) => ({
      additions: result.additions + group.additions,
      deletions: result.deletions + group.deletions
    }),
    { additions: 0, deletions: 0 }
  )
  const richPreviewAvailable = groups.some((group) =>
    /\.(?:md|mdx|png|jpe?g|gif|webp|pdf)$/iu.test(group.path)
  )
  const unstagedSection = groups
    .flatMap((group) => group.sections)
    .find((section) => section.kind === 'snapshot' && section.backendSource.type === 'unstaged')
  const stagedSection = groups
    .flatMap((group) => group.sections)
    .find((section) => section.kind === 'snapshot' && section.backendSource.type === 'staged')
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
      <ReviewSourceMenu
        target={controller.target}
        value={controller.displaySource}
        lastTurnId={lastTurnId}
        onChange={controller.setDisplaySource}
      />
      <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        <span className="text-emerald-600">+{totals.additions}</span>{' '}
        <span className="text-destructive">-{totals.deletions}</span>
      </div>
      <div role="toolbar" aria-label="Review controls" className="flex items-center gap-1">
        {unstagedSection ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            title="暂存全部未暂存文件"
            disabled={controller.isMutationDisabled(unstagedSection, 'section')}
            onClick={() => controller.applySectionAction(unstagedSection, 'stage')}
          >
            暂存全部
          </Button>
        ) : null}
        {stagedSection ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            title="取消暂存全部已暂存文件"
            disabled={controller.isMutationDisabled(stagedSection, 'section')}
            onClick={() => controller.applySectionAction(stagedSection, 'unstage')}
          >
            取消暂存
          </Button>
        ) : null}
        <ReviewJumpToFileMenu groups={groups} onSelect={controller.setSelectedPath} />
        <ReviewOptionsMenu controller={controller} richPreviewAvailable={richPreviewAvailable} />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh changes"
          title="Refresh"
          onClick={controller.refresh}
        >
          <RefreshCwIcon
            className={cn(
              (controller.loadState.status === 'loading' || controller.refreshing) && 'animate-spin'
            )}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="展开全部文件"
          title="展开全部"
          onClick={controller.expandAll}
        >
          <ChevronsUpDownIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="折叠全部文件"
          title="折叠全部"
          onClick={controller.collapseAll}
        >
          <ChevronsDownUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={
            controller.preferences.diffMode === 'split' ? 'Use unified diff' : 'Use split diff'
          }
          aria-pressed={controller.preferences.diffMode === 'split'}
          title="Split/unified"
          onClick={() =>
            controller.setDiffMode(
              controller.preferences.diffMode === 'split' ? 'unified' : 'split'
            )
          }
        >
          {controller.preferences.diffMode === 'split' ? <Rows3Icon /> : <Columns2Icon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Toggle file tree"
          aria-pressed={controller.treeVisible}
          title="File tree"
          onClick={() => controller.setTreeVisible(!controller.treeVisible)}
        >
          <PanelRightIcon />
        </Button>
        <ReviewCommitControl controller={controller} />
      </div>
    </header>
  )
}
