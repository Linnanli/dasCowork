import type { ComponentProps, ReactNode } from 'react'

import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger
} from '@/components/assistant-ui/tool-group'
import type { AssistantRenderUnit } from '@/lib/assistantRenderUnits'
import type { ToolGroupDisplay } from '@/lib/toolActivityDisplay'
import { renderUnitAttributes } from './renderUnitAttributes'

type ToolActivityGroupUnit = Extract<
  AssistantRenderUnit,
  {
    type: 'entry' | 'tool-group'
  }
>

export type ToolActivityGroupShellProps = {
  unit: ToolActivityGroupUnit
  slot: string
  display: ToolGroupDisplay
  defaultOpen?: boolean
  children: ReactNode
}

export function ToolActivityGroupShell({
  unit,
  slot,
  display,
  defaultOpen = false,
  children
}: ToolActivityGroupShellProps): React.JSX.Element {
  const groupKind = unit.type === 'tool-group' ? unit.kind : undefined

  return (
    <ToolGroupRoot
      variant="ghost"
      data-slot={slot}
      data-tool-group-kind={groupKind}
      defaultOpen={defaultOpen}
      {...renderUnitAttributes(unit)}
    >
      <ToolGroupTrigger
        count={display.count}
        label={display.label}
        icon={display.icon as ComponentProps<typeof ToolGroupTrigger>['icon']}
        active={display.active}
        disabled={!display.expandable}
        aria-disabled={!display.expandable}
      />
      {display.expandable ? <ToolGroupContent>{children}</ToolGroupContent> : null}
    </ToolGroupRoot>
  )
}
