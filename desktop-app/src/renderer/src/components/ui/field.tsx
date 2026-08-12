import * as React from 'react'

import { cn } from '@/lib/utils'

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>): React.JSX.Element {
  return (
    <fieldset data-slot="field-set" className={cn('flex flex-col gap-3', className)} {...props} />
  )
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'>): React.JSX.Element {
  return (
    <legend
      data-slot="field-legend"
      className={cn('text-sm font-normal text-foreground', className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="field-group" className={cn('flex flex-col gap-3', className)} {...props} />
}

function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' }): React.JSX.Element {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(
        'flex gap-2',
        orientation === 'horizontal' ? 'flex-row items-start' : 'flex-col',
        className
      )}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="field-content" className={cn('grid gap-1', className)} {...props} />
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>): React.JSX.Element {
  return (
    <label
      data-slot="field-label"
      className={cn('text-sm font-normal leading-none text-foreground', className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p data-slot="field-error" className={cn('text-sm text-destructive', className)} {...props} />
  )
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
}
