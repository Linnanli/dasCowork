import { FolderOpenIcon, PlusIcon, SparklesIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CreateLocalProjectDialog } from './CreateLocalProjectDialog'
import type { ProjectStateController } from './useProjectState'

export function ProjectGate({
  className,
  projectState
}: {
  className?: string
  projectState: ProjectStateController
}): React.JSX.Element {
  return (
    <section
      className={cn(
        'mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-5 px-4',
        className
      )}
      data-slot="project-gate"
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Choose where Codex should work</h1>
        <p className="text-sm text-muted-foreground">
          Start from a trusted folder, a saved project, or a projectless thread.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          className="h-20 flex-col items-start justify-between p-3 text-left"
          variant="outline"
          onClick={() => void projectState.pickWorkspaceRoot()}
        >
          <FolderOpenIcon className="size-4" />
          <span>Open Project Folder</span>
        </Button>
        <CreateLocalProjectDialog projectState={projectState}>
          <Button
            className="h-20 flex-col items-start justify-between p-3 text-left"
            variant="outline"
          >
            <PlusIcon className="size-4" />
            <span>Create Local Project</span>
          </Button>
        </CreateLocalProjectDialog>
        <Button
          className="h-20 flex-col items-start justify-between p-3 text-left"
          variant="outline"
          onClick={() => void projectState.selectProject({ projectKind: 'projectless' })}
        >
          <SparklesIcon className="size-4" />
          <span>Start Projectless Thread</span>
        </Button>
      </div>
      <ProjectGateList projectState={projectState} />
    </section>
  )
}

function ProjectGateList({
  projectState
}: {
  projectState: ProjectStateController
}): React.JSX.Element | null {
  const state = projectState.state
  if (!state) return null
  const localProjects = state.projectOrder
    .map((projectId) => state.localProjects[projectId])
    .filter((project) => Boolean(project))
  const recentRoots = state.workspaceRootOptions.slice(0, 4)

  if (localProjects.length === 0 && recentRoots.length === 0 && state.remoteProjects.length === 0) {
    return null
  }

  return (
    <div className="grid gap-4 text-sm sm:grid-cols-3">
      <ProjectGateColumn title="Recent projects">
        {localProjects.map((project) => (
          <ProjectGateOption
            key={project.id}
            label={project.name}
            detail={project.writableRoots[0]}
            onClick={() =>
              void projectState.selectProject({ projectKind: 'local', projectId: project.id })
            }
          />
        ))}
        {recentRoots.map((option) => (
          <ProjectGateOption
            key={option.root}
            label={option.label ?? option.root}
            detail={option.root}
            onClick={() =>
              void projectState.selectProject({ projectKind: 'path', path: option.root })
            }
          />
        ))}
      </ProjectGateColumn>
      <ProjectGateColumn title="Remote projects">
        {state.remoteProjects.map((project) => (
          <ProjectGateOption
            key={project.id}
            label={project.label}
            detail={`${project.hostId}:${project.remotePath}`}
            onClick={() =>
              void projectState.selectProject({
                projectKind: 'remote',
                projectId: project.id,
                hostId: project.hostId
              })
            }
          />
        ))}
      </ProjectGateColumn>
    </div>
  )
}

function ProjectGateColumn({
  children,
  title
}: {
  children: ReactNode
  title: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <div className="px-1 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function ProjectGateOption({
  detail,
  label,
  onClick
}: {
  detail?: string
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
      type="button"
      onClick={onClick}
    >
      <span className="truncate font-medium">{label}</span>
      {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
    </button>
  )
}
