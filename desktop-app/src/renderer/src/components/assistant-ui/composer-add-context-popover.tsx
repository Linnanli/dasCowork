import { PlusIcon } from 'lucide-react'
import type { Unstable_TriggerItem } from '@assistant-ui/react'

import { useComposerSuggestion } from '@/composer/composerSuggestionController'

/** Legacy data shape retained for catalog/search producers during the migration. */
export type ComposerContextMenuSection = {
  id: string
  label: string
  items: readonly Unstable_TriggerItem[]
  error?: string | null
  loading?: boolean
  onRetry?: () => void
  preFiltered?: boolean
  showTitle?: boolean
  placeholder?: string
}

/**
 * The context button only opens the shared suggestion session. Rendering the
 * result list is intentionally centralized in ComposerSuggestionSurface so
 * typed @, typed /, and + can never create competing popovers.
 */
export function ComposerAddContextPopover({
  disabled = false
}: {
  disabled?: boolean
}): React.JSX.Element {
  const { controller, state } = useComposerSuggestion()
  const contextOpen = state.open && (state.trigger === '@' || state.trigger === '+')

  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={contextOpen}
      aria-haspopup="listbox"
      aria-label="添加文件和更多"
      title="添加文件和更多（@）"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => controller.togglePlus()}
      data-state={contextOpen ? 'open' : 'closed'}
      className="aui-composer-add-context inline-grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-foreground/8 data-[state=open]:bg-foreground/5 dark:data-[state=open]:bg-foreground/8"
    >
      <PlusIcon className="size-4.5 stroke-[1.75px]" />
    </button>
  )
}
