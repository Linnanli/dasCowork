import type { LucideIcon } from 'lucide-react'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export type ComposerModePresentation = {
  id: 'goal' | 'plan'
  label: string
  tooltip: string
  dismissLabel: string
  Icon: LucideIcon
  onDismiss: () => void | Promise<void>
  busy?: boolean
}

export function ComposerModeIndicator({
  presentation
}: {
  presentation: ComposerModePresentation
}): React.JSX.Element {
  const Icon = presentation.Icon
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={presentation.dismissLabel}
            className="group"
            data-slot="composer-mode-indicator"
            data-mode={presentation.id}
            disabled={presentation.busy}
            size="xs"
            title={presentation.tooltip}
            type="button"
            variant="ghost"
            onClick={() => void presentation.onDismiss()}
          >
            <span className="relative size-3" aria-hidden="true">
              <Icon className="absolute inset-0 size-3 group-hover:hidden group-focus-visible:hidden" />
              <XIcon className="absolute inset-0 hidden size-3 group-hover:block group-focus-visible:block" />
            </span>
            <span>{presentation.label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {presentation.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function ComposerModeIndicatorBar({
  presentations
}: {
  presentations: readonly ComposerModePresentation[]
}): React.JSX.Element | null {
  if (presentations.length === 0) return null
  return (
    <div data-slot="composer-mode-indicator-bar" className="flex shrink-0 items-center gap-1">
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border/70" />
      {presentations.map((presentation) => (
        <ComposerModeIndicator key={presentation.id} presentation={presentation} />
      ))}
    </div>
  )
}
