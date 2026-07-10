'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type FilePathProps = {
  path: string
  className?: string
}

export function FilePath({ path, className }: FilePathProps): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="file-path"
            title={path}
            className={cn('inline-block min-w-0 truncate align-bottom', className)}
          >
            {fileName(path)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="max-w-sm break-all">
          {path}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function fileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const separator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return normalized.slice(separator + 1) || path
}
