import * as React from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type ComboboxOption = {
  label: string
  value: string
}

function Combobox({
  className,
  disabled = false,
  emptyText = '没有匹配项。',
  id,
  onValueChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索选项…',
  value
}: {
  className?: string
  disabled?: boolean
  emptyText?: string
  id?: string
  onValueChange: (value: string) => void
  options: readonly ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  value: string
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-expanded={open}
          className={cn(
            'h-10 w-full justify-between rounded-lg border-input bg-background px-3 font-normal text-foreground hover:bg-background',
            !selected && 'text-muted-foreground',
            className
          )}
          disabled={disabled}
          id={id}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList id={id ? `${id}-listbox` : undefined}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() => {
                  onValueChange(option.value)
                  setOpen(false)
                }}
                value={option.label}
              >
                <CheckIcon
                  className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')}
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
export type { ComboboxOption }
