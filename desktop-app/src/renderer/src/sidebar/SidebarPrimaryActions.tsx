import { PlusIcon } from 'lucide-react'

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
    <div className="space-y-1">
      <button
        className={cn(
          'inline-flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors',
          hoverClass
        )}
        type="button"
        onClick={onNewChat}
      >
        <PlusIcon className="size-4" />
        New chat
      </button>
    </div>
  )
}
