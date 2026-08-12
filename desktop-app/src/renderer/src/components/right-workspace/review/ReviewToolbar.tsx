import {
  Columns2Icon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  RefreshCwIcon,
  Rows3Icon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReviewJumpToFileMenu } from './ReviewJumpToFileMenu'
import { ReviewCommitControl } from './ReviewCommitControl'
import { ReviewOptionsMenu } from './ReviewOptionsMenu'
import { ReviewSourceMenu } from './ReviewSourceMenu'
import { groupKey } from './reviewWorkspaceModel'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  lastTurnId?: string
  onGitFeedback(feedback: { tone: 'success' | 'info' | 'error'; message: string }): void
}

export function ReviewToolbar({ controller, lastTurnId, onGitFeedback }: Props): React.JSX.Element {
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
  const stagedSection = groups
    .flatMap((group) => group.sections)
    .find((section) => section.kind === 'snapshot' && section.backendSource.type === 'staged')
  const allFilesCollapsed =
    groups.length > 0 &&
    groups.every((group) => controller.preferences.collapsedKeys.includes(groupKey(group)))
  const expansionControl = allFilesCollapsed
    ? {
        ariaLabel: '展开全部文件',
        title: '展开全部',
        onClick: controller.expandAll,
        icon: <ChevronsUpDownIcon />
      }
    : {
        ariaLabel: '折叠全部文件',
        title: '折叠全部',
        onClick: controller.collapseAll,
        icon: <ChevronsDownUpIcon />
      }
  const diffModeControlLabel =
    controller.preferences.diffMode === 'split' ? '切换为统一差异视图' : '切换为并排差异视图'
  const treeControlLabel = controller.treeVisible ? '隐藏文件树' : '显示文件树'
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
      <div role="toolbar" aria-label="审阅控件" className="flex items-center gap-2">
        {stagedSection ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
          size="sm"
          aria-label="刷新更改"
          title="刷新"
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
          size="sm"
          aria-label={expansionControl.ariaLabel}
          aria-pressed={!allFilesCollapsed}
          title={expansionControl.title}
          onClick={expansionControl.onClick}
        >
          {expansionControl.icon}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={diffModeControlLabel}
          aria-pressed={controller.preferences.diffMode === 'split'}
          title={diffModeControlLabel}
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
          size="sm"
          aria-label={treeControlLabel}
          aria-pressed={controller.treeVisible}
          title={treeControlLabel}
          onClick={() => controller.setTreeVisible(!controller.treeVisible)}
        >
          <FolderIcon />
        </Button>
        <ReviewCommitControl controller={controller} onFeedback={onGitFeedback} />
      </div>
    </header>
  )
}
