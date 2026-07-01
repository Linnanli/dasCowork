import { PlusIcon } from 'lucide-react'

import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'

export function SidebarPrimaryActions({
  nativeBackdrop,
  onNewChat
}: {
  nativeBackdrop: boolean
  onNewChat: () => void
}): React.JSX.Element {
  const hoverClass = nativeBackdrop
    ? 'hover:bg-background/40 dark:hover:bg-foreground/8'
    : 'hover:bg-muted'
  return (
    <div className="min-w-0 shrink-0 space-y-1 px-2">
      <Button
        className={cn('w-full min-w-0 justify-start gap-2 font-normal text-foreground', hoverClass)}
        size="sm"
        type="button"
        variant="ghost"
        onClick={onNewChat}
      >
        <PlusIcon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">新对话</span>
      </Button>
    </div>
  )
}
