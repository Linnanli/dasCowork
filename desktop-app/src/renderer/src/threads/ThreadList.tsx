import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState
} from '@assistant-ui/react'
import { AlertTriangleIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ProjectState } from '../../../shared/projects/projectTypes'
import type { ProjectStateController } from '../projects/useProjectState'
import { buildThreadProjectSections, getThreadProjectBadge } from './threadProjectSections'

const threadListNewButtonClass =
  'inline-flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm text-foreground transition-colors'

const threadListNewButtonGlassClass = 'hover:bg-background/40 dark:hover:bg-foreground/8'

const threadListItemClass = 'group flex min-h-8 items-center gap-1 rounded-md transition-colors'

const threadListItemGlassClass =
  'hover:bg-background/40 focus-visible:bg-background/40 data-[active]:bg-background/50 dark:hover:bg-foreground/8 dark:focus-visible:bg-foreground/8 dark:data-[active]:bg-foreground/10'

export function ThreadList({
  nativeBackdrop,
  projectState
}: {
  nativeBackdrop: boolean
  projectState: ProjectStateController
}): React.JSX.Element {
  return (
    <ThreadListPrimitive.Root className="flex flex-col gap-1">
      <ThreadListPrimitive.New asChild>
        <button
          className={cn(
            threadListNewButtonClass,
            nativeBackdrop ? threadListNewButtonGlassClass : 'hover:bg-muted'
          )}
          type="button"
        >
          <PlusIcon className="size-4" />
          New thread
        </button>
      </ThreadListPrimitive.New>
      <ThreadProjectSections
        currentDetail={projectState.currentDetail}
        currentLabel={projectState.currentLabel}
        projectState={projectState}
      />
      <ThreadListPrimitive.Items>
        {() => (
          <ThreadListItem
            nativeBackdrop={nativeBackdrop}
            projectState={projectState.state}
            fallbackProjectLabel={projectState.currentLabel}
          />
        )}
      </ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  )
}

function ThreadProjectSections({
  currentDetail,
  currentLabel,
  projectState
}: {
  currentDetail: string | null
  currentLabel: string
  projectState: ProjectStateController
}): React.JSX.Element {
  const state = projectState.state
  const sections = buildThreadProjectSections(state, currentLabel, currentDetail)

  return (
    <div className="space-y-2 px-1 pt-2" data-slot="thread-project-sections">
      {sections.map((section) => (
        <section key={section.key} className="space-y-1">
          <div className="text-[11px] text-muted-foreground uppercase">{section.title}</div>
          <div className="space-y-0.5">
            {section.groups.map((group) => (
              <button
                key={group.key}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted disabled:pointer-events-none"
                disabled={!group.selection}
                type="button"
                onClick={() => {
                  if (!group.selection) return
                  void projectState.selectProject(group.selection)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{group.label}</span>
                  {group.detail ? <span className="block truncate">{group.detail}</span> : null}
                </span>
                {group.warning ? (
                  <span
                    className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                    title={group.warning}
                  >
                    <AlertTriangleIcon className="size-3.5" />
                    Missing
                  </span>
                ) : null}
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                  {group.threadCount}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ThreadListItem({
  nativeBackdrop,
  projectState,
  fallbackProjectLabel
}: {
  nativeBackdrop: boolean
  projectState: ProjectState | null
  fallbackProjectLabel: string
}): React.JSX.Element {
  const threadListItem = useAuiState((state) => state.threadListItem)
  const projectBadge = getThreadProjectBadge(
    projectState,
    [threadListItem.remoteId, threadListItem.externalId, threadListItem.id],
    fallbackProjectLabel
  )

  return (
    <ThreadListItemPrimitive.Root
      className={cn(
        threadListItemClass,
        nativeBackdrop
          ? threadListItemGlassClass
          : 'hover:bg-muted focus-visible:bg-muted data-[active]:bg-muted'
      )}
    >
      <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 flex-col px-3 py-1 text-left text-sm text-foreground outline-none">
        <span className="min-w-0 flex-1 truncate">
          <ThreadListItemPrimitive.Title fallback="New Chat" />
        </span>
        <span className="truncate text-[11px] font-normal text-muted-foreground">
          {projectBadge.label}
        </span>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemActions />
    </ThreadListItemPrimitive.Root>
  )
}

function ThreadListItemActions(): React.JSX.Element {
  return (
    <ThreadListItemMorePrimitive.Root>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <button
          className="mr-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[active]:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100"
          type="button"
          aria-label="更多线程选项"
          title="更多线程选项"
        >
          <MoreHorizontalIcon className="size-3.5" />
        </button>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        align="start"
        className="z-50 min-w-32 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        side="right"
        sideOffset={6}
      >
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive">
            <TrashIcon className="size-4" />
            Delete
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  )
}
