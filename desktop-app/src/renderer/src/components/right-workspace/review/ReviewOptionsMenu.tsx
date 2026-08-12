import { CheckIcon, SlidersHorizontalIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ReviewWorkspaceController } from './reviewWorkspaceTypes'

type Props = {
  controller: ReviewWorkspaceController
  richPreviewAvailable: boolean
}

/** Options which only change rendering stay in the renderer; unsupported Git-level options are absent. */
export function ReviewOptionsMenu({ controller, richPreviewAvailable }: Props): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="审阅选项" title="审阅选项">
          <SlidersHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1 text-[11px] text-muted-foreground">差异显示</div>
        <OptionItem
          checked={controller.preferences.lineDiffType === 'word'}
          onSelect={() => controller.setLineDiffType('word')}
        >
          按词高亮
        </OptionItem>
        <OptionItem
          checked={controller.preferences.lineDiffType === 'char'}
          onSelect={() => controller.setLineDiffType('char')}
        >
          按字符高亮
        </OptionItem>
        <OptionItem
          checked={controller.preferences.lineDiffType === 'none'}
          onSelect={() => controller.setLineDiffType('none')}
        >
          不高亮行内差异
        </OptionItem>
        <DropdownMenuSeparator />
        <OptionItem
          checked={controller.preferences.wrap}
          onSelect={() => controller.setWrap(!controller.preferences.wrap)}
        >
          自动换行
        </OptionItem>
        <OptionItem
          checked={controller.preferences.ignoreWhitespace}
          onSelect={() => controller.setIgnoreWhitespace(!controller.preferences.ignoreWhitespace)}
        >
          忽略空白差异
        </OptionItem>
        <OptionItem
          checked={controller.preferences.fullFiles}
          onSelect={() => controller.setFullFiles(!controller.preferences.fullFiles)}
        >
          显示完整文件上下文
        </OptionItem>
        <OptionItem
          checked={controller.preferences.richPreview}
          disabled={!richPreviewAvailable}
          onSelect={() => controller.setRichPreview(!controller.preferences.richPreview)}
        >
          富预览（Markdown、图片和 PDF）
        </OptionItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!controller.canCopyApplyCommand}
          title={
            controller.canCopyApplyCommand
              ? '复制当前稳定快照的完整应用命令'
              : '当前来源没有可导出的稳定 patch'
          }
          onSelect={() => controller.copyReviewApplyCommand()}
        >
          <CheckIcon className="opacity-0" />
          复制 git apply 命令
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionItem({
  checked,
  children,
  disabled,
  onSelect
}: {
  checked: boolean
  children: React.ReactNode
  disabled?: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <CheckIcon className={checked ? undefined : 'opacity-0'} />
      {children}
    </DropdownMenuItem>
  )
}
