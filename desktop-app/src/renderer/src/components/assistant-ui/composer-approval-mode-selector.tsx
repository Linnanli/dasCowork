import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, HandIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { ApprovalModeKind } from '../../../../shared/codexIpcApi'
import { approvalModeOptions, sandboxDocumentationUrl } from './composer-approval-mode-options'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  fullAccessConfirmationStore,
  type FullAccessConfirmationStore
} from '@/runtime/FullAccessConfirmationStore'

export type ComposerApprovalModeSelectorProps = {
  approvalModeKind: ApprovalModeKind
  onApprovalModeKindChange: (approvalModeKind: ApprovalModeKind) => void
  disabled?: boolean
  confirmationStore?: FullAccessConfirmationStore
}

export function ComposerApprovalModeSelector({
  approvalModeKind,
  onApprovalModeKindChange,
  disabled = false,
  confirmationStore
}: ComposerApprovalModeSelectorProps): React.JSX.Element {
  const store = useMemo(() => confirmationStore ?? fullAccessConfirmationStore, [confirmationStore])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const selectedOption = approvalModeOptions.find((option) => option.id === approvalModeKind)
  const SelectedIcon = selectedOption?.Icon ?? HandIcon
  const warning = selectedOption?.warning === true

  const selectMode = (modeKind: ApprovalModeKind): void => {
    if (modeKind === approvalModeKind) return
    if (modeKind === 'full-access' && !store.hasConfirmed()) {
      setConfirmOpen(true)
      return
    }
    onApprovalModeKindChange(modeKind)
  }

  const confirmFullAccess = (): void => {
    store.confirm()
    onApprovalModeKindChange('full-access')
    setConfirmOpen(false)
  }

  const openDocumentation = (): void => {
    void window.desktopApp?.codex
      ?.openExternalHttpUrl?.(sandboxDocumentationUrl)
      .catch(() => undefined)
  }

  return (
    <>
      <DropdownMenu>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={`审批类型：${selectedOption?.label ?? '请求批准'}`}
                  data-slot="composer-approval-mode-selector"
                  data-mode={approvalModeKind}
                  disabled={disabled}
                  className={cn(
                    'h-7 rounded-full px-2 text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/8',
                    warning &&
                      'text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300'
                  )}
                >
                  <SelectedIcon className="size-4 stroke-[1.75px]" />
                  <span className="hidden max-w-24 truncate sm:inline">
                    {selectedOption?.label}
                  </span>
                  <ChevronDownIcon className="hidden size-3 opacity-70 sm:block" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {selectedOption?.label ?? '请求批准'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] p-2"
          data-slot="composer-approval-mode-menu"
        >
          <DropdownMenuLabel className="flex items-center justify-between gap-3 px-2.5 py-2">
            <span className="text-sm font-medium text-foreground">应如何批准 ChatGPT 操作？</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={openDocumentation}
            >
              了解更多
              <ExternalLinkIcon className="size-3" />
            </button>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {approvalModeOptions.map((option) => (
            <DropdownMenuItem
              key={option.id}
              className={cn('items-start gap-3 px-2.5 py-2.5', option.warning && 'text-orange-600')}
              data-mode={option.id}
              onSelect={() => selectMode(option.id)}
            >
              <option.Icon className="mt-0.5 size-4 stroke-[1.75px]" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-5">{option.label}</span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {option.id === approvalModeKind ? (
                <CheckIcon aria-label="已选择" className="mt-0.5 size-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-slot="full-access-confirmation-dialog">
          <DialogHeader>
            <DialogTitle>确定要开启完全访问权限吗？</DialogTitle>
            <DialogDescription>
              ChatGPT 将无需批准即可访问互联网和编辑电脑上的任意文件，可能造成数据丢失和提示注入。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={confirmFullAccess}>
              开启完全访问权限
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
