import { CheckIcon, CloudIcon, ComputerIcon } from 'lucide-react'

import type { ProjectSelection } from '../../../../shared/projects/projectTypes'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type ExecutionKind = 'local' | 'remote' | 'unknown'

export function ConversationExecutionTargetSubmenu({
  selection,
  taskStarted,
  onCurrentSelected
}: {
  selection?: ProjectSelection
  taskStarted: boolean
  onCurrentSelected?(): void
}): React.JSX.Element {
  const executionKind = selectionKind(selection)
  const unavailableReason = taskStarted
    ? '当前任务没有可切换的对应执行位置。已开始的任务暂不支持切换执行位置。'
    : '当前任务没有可切换的对应执行位置。'

  return (
    <div data-slot="conversation-execution-target-submenu" className="w-[230px] p-1">
      <p className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">继续使用</p>
      <ExecutionRow
        label="本地检出"
        active={executionKind === 'local'}
        disabled={executionKind !== 'local'}
        title={executionKind === 'local' ? '当前执行位置' : unavailableReason}
        icon={<ComputerIcon className="size-4" />}
        onSelect={onCurrentSelected}
      />
      <ExecutionRow
        label="云端"
        active={executionKind === 'remote'}
        disabled={executionKind !== 'remote'}
        title={executionKind === 'remote' ? '当前执行位置' : unavailableReason}
        icon={<CloudIcon className="size-4" />}
        onSelect={onCurrentSelected}
      />
    </div>
  )
}

function ExecutionRow({
  label,
  active,
  disabled,
  title,
  icon,
  onSelect
}: {
  label: string
  active: boolean
  disabled: boolean
  title: string
  icon: React.ReactNode
  onSelect?: () => void
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      data-slot={`conversation-execution-target-${active ? 'current' : label === '云端' ? 'remote' : 'local'}`}
      disabled={disabled}
      title={title}
      onSelect={onSelect}
      className={cn('h-9', active && 'bg-accent text-accent-foreground')}
    >
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
      {active ? <CheckIcon aria-label="当前执行位置" className="size-4" /> : null}
    </DropdownMenuItem>
  )
}

function selectionKind(selection: ProjectSelection | undefined): ExecutionKind {
  if (selection?.projectKind === 'remote') return 'remote'
  if (selection?.projectKind === 'local' || selection?.projectKind === 'path') return 'local'
  return 'unknown'
}
