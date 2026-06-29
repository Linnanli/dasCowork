import {
  FolderOpenIcon,
  LaptopIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  SparklesIcon
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CreateLocalProjectDialog } from './CreateLocalProjectDialog'
import type { ProjectStateController } from './useProjectState'

export function ProjectSwitcher({
  compact = false,
  projectState
}: {
  compact?: boolean
  projectState: ProjectStateController
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const state = projectState.state

  return (
    <div className="relative" data-slot="project-switcher">
      <button
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted',
          compact ? 'size-8 justify-center p-0' : 'max-w-60'
        )}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
        {compact ? null : (
          <span className="min-w-0 truncate">
            {projectState.currentLabel}
            {projectState.currentDetail ? (
              <span className="ml-1 text-muted-foreground">/ {projectState.currentDetail}</span>
            ) : null}
          </span>
        )}
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-40 mt-2 w-72 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
          <ProjectMenuSection title="Current">
            <ProjectMenuRow label={projectState.currentLabel} detail={projectState.currentDetail} />
          </ProjectMenuSection>
          {state ? (
            <>
              <ProjectMenuSection title="Pinned">
                {state.pinnedProjectIds.length === 0 ? (
                  <ProjectMenuEmpty label="No pinned projects" />
                ) : (
                  state.pinnedProjectIds.map((projectId) => {
                    const project = state.localProjects[projectId]
                    if (!project) return null
                    return (
                      <ProjectMenuAction
                        key={project.id}
                        icon={<PinIcon className="size-3.5" />}
                        label={project.name}
                        detail={project.writableRoots[0]}
                        onClick={() => {
                          setOpen(false)
                          void projectState.selectProject({
                            projectKind: 'local',
                            projectId: project.id
                          })
                        }}
                      />
                    )
                  })
                )}
              </ProjectMenuSection>
              <ProjectMenuSection title="Local projects">
                {state.projectOrder.map((projectId) => {
                  const project = state.localProjects[projectId]
                  if (!project) return null
                  return (
                    <ProjectMenuAction
                      key={project.id}
                      label={project.name}
                      detail={
                        project.writableRoots.length === 1
                          ? project.writableRoots[0]
                          : `${project.writableRoots.length} roots`
                      }
                      onClick={() => {
                        setOpen(false)
                        void projectState.selectProject({
                          projectKind: 'local',
                          projectId: project.id
                        })
                      }}
                    />
                  )
                })}
                <CreateLocalProjectDialog projectState={projectState}>
                  <Button className="mt-1 w-full justify-start" size="sm" variant="ghost">
                    <PlusIcon className="size-4" />
                    Create local project
                  </Button>
                </CreateLocalProjectDialog>
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false)
                    void projectState.pickWorkspaceRoot()
                  }}
                >
                  <FolderOpenIcon className="size-4" />
                  Open folder
                </Button>
              </ProjectMenuSection>
              <ProjectMenuSection title="Remote projects">
                {state.remoteProjects.length === 0 ? (
                  <ProjectMenuEmpty label="No remote projects" />
                ) : (
                  state.remoteProjects.map((project) => (
                    <ProjectMenuAction
                      key={project.id}
                      label={project.label}
                      detail={`${project.hostId}:${project.remotePath}`}
                      onClick={() => {
                        setOpen(false)
                        void projectState.selectProject({
                          projectKind: 'remote',
                          projectId: project.id,
                          hostId: project.hostId
                        })
                      }}
                    />
                  ))
                )}
              </ProjectMenuSection>
            </>
          ) : null}
          <ProjectMenuSection title="Other">
            <ProjectMenuAction
              icon={<SparklesIcon className="size-3.5" />}
              label="Start projectless thread"
              onClick={() => {
                setOpen(false)
                void projectState.selectProject({ projectKind: 'projectless' })
              }}
            />
            <ProjectMenuAction
              icon={<MoreHorizontalIcon className="size-3.5" />}
              label="More project actions"
              disabled
            />
          </ProjectMenuSection>
        </div>
      ) : null}
    </div>
  )
}

function ProjectMenuSection({
  children,
  title
}: {
  children: ReactNode
  title: string
}): React.JSX.Element {
  return (
    <div className="py-1">
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function ProjectMenuRow({
  detail,
  label
}: {
  detail?: string | null
  label: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 px-2 py-1.5 text-sm">
      <div className="truncate font-medium">{label}</div>
      {detail ? <div className="truncate text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

function ProjectMenuAction({
  detail,
  disabled,
  icon,
  label,
  onClick
}: {
  detail?: string
  disabled?: boolean
  icon?: ReactNode
  label: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {detail ? (
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </button>
  )
}

function ProjectMenuEmpty({ label }: { label: string }): React.JSX.Element {
  return <div className="px-2 py-1 text-xs text-muted-foreground">{label}</div>
}
