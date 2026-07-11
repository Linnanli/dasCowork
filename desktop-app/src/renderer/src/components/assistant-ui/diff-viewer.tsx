'use client'

/* eslint-disable react-refresh/only-export-components */

import { type ComponentProps, useMemo } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { diffLines } from 'diff'
import parseDiff from 'parse-diff'

import { FilePath } from '@/components/ui/file-path'
import { cn } from '@/lib/utils'

type DiffLineType = 'add' | 'del' | 'normal' | 'empty'

export type ParsedLine = {
  type: Exclude<DiffLineType, 'empty'>
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export type ParsedFile = {
  oldName?: string
  newName?: string
  lines: ParsedLine[]
  additions: number
  deletions: number
}

export type SplitLinePair = {
  left: ParsedLine | null
  right: ParsedLine | null
}

export const diffViewerVariants = cva('overflow-hidden rounded-md border border-border/50', {
  variants: {
    variant: {
      default: 'bg-background',
      ghost: 'border-transparent bg-transparent',
      muted: 'bg-muted/30'
    },
    size: {
      sm: 'text-[11px]',
      default: 'text-xs',
      lg: 'text-sm'
    }
  },
  defaultVariants: {
    variant: 'default',
    size: 'default'
  }
})

const diffLineVariants = cva('flex min-w-max font-mono leading-5', {
  variants: {
    type: {
      add: 'bg-emerald-500/10',
      del: 'bg-red-500/10',
      normal: 'bg-transparent',
      empty: 'bg-muted/20'
    }
  },
  defaultVariants: {
    type: 'normal'
  }
})

const diffLineTextVariants = cva('', {
  variants: {
    type: {
      add: 'text-emerald-700 dark:text-emerald-300',
      del: 'text-red-700 dark:text-red-300',
      normal: 'text-foreground/90',
      empty: 'text-muted-foreground'
    }
  },
  defaultVariants: {
    type: 'normal'
  }
})

export function parsePatch(patch: string): ParsedFile[] {
  return parseDiff(patch).map((file) => {
    const lines: ParsedLine[] = []
    let additions = 0
    let deletions = 0

    for (const chunk of file.chunks) {
      let oldLine = chunk.oldStart
      let newLine = chunk.newStart

      for (const change of chunk.changes) {
        const content = change.content.slice(1)
        if (change.type === 'add') {
          additions += 1
          lines.push({ type: 'add', content, newLineNumber: newLine++ })
        } else if (change.type === 'del') {
          deletions += 1
          lines.push({ type: 'del', content, oldLineNumber: oldLine++ })
        } else {
          lines.push({
            type: 'normal',
            content,
            oldLineNumber: oldLine++,
            newLineNumber: newLine++
          })
        }
      }
    }

    return {
      oldName: file.from,
      newName: file.to,
      lines,
      additions,
      deletions
    }
  })
}

export function computeDiff(
  oldContent: string,
  newContent: string
): Omit<ParsedFile, 'oldName' | 'newName'> {
  const lines: ParsedLine[] = []
  let oldLine = 1
  let newLine = 1
  let additions = 0
  let deletions = 0

  for (const change of diffLines(oldContent, newContent)) {
    const content = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value
    if (content.length === 0) continue

    for (const line of content.split('\n')) {
      if (change.added) {
        additions += 1
        lines.push({ type: 'add', content: line, newLineNumber: newLine++ })
      } else if (change.removed) {
        deletions += 1
        lines.push({ type: 'del', content: line, oldLineNumber: oldLine++ })
      } else {
        lines.push({
          type: 'normal',
          content: line,
          oldLineNumber: oldLine++,
          newLineNumber: newLine++
        })
      }
    }
  }

  return { lines, additions, deletions }
}

export function pairLinesForSplit(lines: readonly ParsedLine[]): SplitLinePair[] {
  const pairs: SplitLinePair[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line) break

    if (line.type === 'del') {
      const deletions: ParsedLine[] = []
      const additions: ParsedLine[] = []
      while (lines[index]?.type === 'del') deletions.push(lines[index++] as ParsedLine)
      while (lines[index]?.type === 'add') additions.push(lines[index++] as ParsedLine)

      const count = Math.max(deletions.length, additions.length)
      for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
        pairs.push({ left: deletions[pairIndex] ?? null, right: additions[pairIndex] ?? null })
      }
      continue
    }

    if (line.type === 'add') {
      pairs.push({ left: null, right: line })
    } else {
      pairs.push({ left: line, right: line })
    }
    index += 1
  }

  return pairs
}

export type DiffViewerProps = VariantProps<typeof diffViewerVariants> & {
  patch?: string
  code?: string
  oldFile?: { content: string; name?: string }
  newFile?: { content: string; name?: string }
  viewMode?: 'split' | 'unified'
  showLineNumbers?: boolean
  showIcon?: boolean
  showStats?: boolean
  className?: string
}

export function DiffViewer({
  patch,
  code,
  oldFile,
  newFile,
  viewMode = 'unified',
  showLineNumbers = true,
  showIcon = true,
  showStats = true,
  variant,
  size,
  className
}: DiffViewerProps): React.JSX.Element {
  const files = useMemo(() => {
    const diffPatch = patch ?? code
    if (diffPatch) return parsePatch(diffPatch)
    if (!oldFile || !newFile) return []

    return [
      {
        oldName: oldFile.name,
        newName: newFile.name,
        ...computeDiff(oldFile.content, newFile.content)
      }
    ]
  }, [code, newFile, oldFile, patch])

  if (files.length === 0) {
    return (
      <pre
        data-slot="diff-viewer"
        className={cn('rounded-md bg-muted/40 p-3 text-xs text-muted-foreground', className)}
      >
        暂无可展示的文件差异
      </pre>
    )
  }

  return (
    <div
      data-slot="diff-viewer"
      data-view-mode={viewMode}
      data-variant={variant ?? 'default'}
      data-size={size ?? 'default'}
      className={cn(diffViewerVariants({ variant, size }), className)}
    >
      {files.map((file, index) => (
        <div
          key={`${file.oldName ?? ''}:${file.newName ?? ''}:${index}`}
          data-slot="diff-viewer-file"
        >
          <DiffViewerHeader
            oldName={file.oldName}
            newName={file.newName}
            additions={file.additions}
            deletions={file.deletions}
            showIcon={showIcon}
            showStats={showStats}
          />
          <DiffViewerContent>
            {viewMode === 'split'
              ? pairLinesForSplit(file.lines).map((pair, lineIndex) => (
                  <DiffViewerSplitLine
                    key={lineIndex}
                    pair={pair}
                    showLineNumbers={showLineNumbers}
                  />
                ))
              : file.lines.map((line, lineIndex) => (
                  <DiffViewerLine key={lineIndex} line={line} showLineNumbers={showLineNumbers} />
                ))}
          </DiffViewerContent>
        </div>
      ))}
    </div>
  )
}

export function DiffViewerFile({ className, ...props }: ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="diff-viewer-file" className={cn(className)} {...props} />
}

export function DiffViewerContent({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div data-slot="diff-viewer-content" className={cn('overflow-x-auto', className)} {...props} />
  )
}

export function DiffViewerHeader({
  oldName,
  newName,
  additions = 0,
  deletions = 0,
  showIcon = true,
  showStats = true,
  className,
  ...props
}: ComponentProps<'div'> & {
  oldName?: string
  newName?: string
  additions?: number
  deletions?: number
  showIcon?: boolean
  showStats?: boolean
}): React.JSX.Element | null {
  const displayName = newName ?? oldName
  if (!displayName) return null

  return (
    <div
      data-slot="diff-viewer-header"
      className={cn(
        'flex items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
        className
      )}
      {...props}
    >
      {showIcon ? <DiffViewerFileBadge filename={displayName} /> : null}
      <span className="min-w-0 flex-1 truncate">
        {oldName && newName && oldName !== newName ? (
          <>
            <FilePath path={oldName} className="max-w-40 text-red-700 dark:text-red-300" />
            {' → '}
            <FilePath path={newName} className="max-w-40 text-emerald-700 dark:text-emerald-300" />
          </>
        ) : (
          <FilePath path={displayName} className="max-w-full" />
        )}
      </span>
      {showStats && (additions > 0 || deletions > 0) ? (
        <DiffViewerStats additions={additions} deletions={deletions} />
      ) : null}
    </div>
  )
}

export function DiffViewerLine({
  line,
  showLineNumbers = true,
  className,
  ...props
}: ComponentProps<'div'> & {
  line: ParsedLine
  showLineNumbers?: boolean
}): React.JSX.Element {
  const indicator = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
  const lineNumber = line.type === 'add' ? line.newLineNumber : line.oldLineNumber

  return (
    <div
      data-slot="diff-viewer-line"
      data-type={line.type}
      className={cn(diffLineVariants({ type: line.type }), className)}
      {...props}
    >
      {showLineNumbers ? <DiffViewerLineNumber>{lineNumber}</DiffViewerLineNumber> : null}
      <DiffViewerLineIndicator type={line.type}>{indicator}</DiffViewerLineIndicator>
      <span className={cn('flex-1 whitespace-pre-wrap', diffLineTextVariants({ type: line.type }))}>
        {line.content}
      </span>
    </div>
  )
}

export function DiffViewerSplitLine({
  pair,
  showLineNumbers = true,
  className,
  ...props
}: ComponentProps<'div'> & {
  pair: SplitLinePair
  showLineNumbers?: boolean
}): React.JSX.Element {
  return (
    <div data-slot="diff-viewer-split-line" className={cn('flex min-w-max', className)} {...props}>
      <DiffViewerSplitSide
        line={pair.left}
        side="left"
        showLineNumbers={showLineNumbers}
        className="border-e border-border/50"
      />
      <DiffViewerSplitSide line={pair.right} side="right" showLineNumbers={showLineNumbers} />
    </div>
  )
}

function DiffViewerSplitSide({
  line,
  side,
  showLineNumbers,
  className
}: {
  line: ParsedLine | null
  side: 'left' | 'right'
  showLineNumbers: boolean
  className?: string
}): React.JSX.Element {
  const type = line?.type ?? 'empty'
  const indicator = !line
    ? ''
    : side === 'left' && type === 'del'
      ? '-'
      : side === 'right' && type === 'add'
        ? '+'
        : ' '
  const lineNumber = side === 'left' ? line?.oldLineNumber : line?.newLineNumber

  return (
    <div
      data-slot={`diff-viewer-split-${side}`}
      data-type={type}
      className={cn(diffLineVariants({ type }), 'flex w-1/2 min-w-0', className)}
    >
      {showLineNumbers ? <DiffViewerLineNumber>{lineNumber}</DiffViewerLineNumber> : null}
      <DiffViewerLineIndicator type={type}>{indicator}</DiffViewerLineIndicator>
      <span className={cn('flex-1 whitespace-pre-wrap', diffLineTextVariants({ type }))}>
        {line?.content ?? ''}
      </span>
    </div>
  )
}

function DiffViewerLineNumber({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="w-11 shrink-0 select-none px-2 text-end text-muted-foreground">
      {children ?? ''}
    </span>
  )
}

function DiffViewerLineIndicator({
  type,
  children
}: {
  type: DiffLineType
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={cn('w-4 shrink-0 select-none text-center', diffLineTextVariants({ type }))}>
      {children}
    </span>
  )
}

export function DiffViewerFileBadge({ filename }: { filename?: string }): React.JSX.Element | null {
  const extension = filename?.split('.').pop()?.toUpperCase()
  if (!extension || extension === filename) return null

  return (
    <span className="inline-flex size-5 shrink-0 items-end justify-end rounded-sm border border-border/60 bg-background text-[8px] leading-none text-foreground">
      <span className="p-0.5">{extension}</span>
    </span>
  )
}

export function DiffViewerStats({
  additions,
  deletions
}: {
  additions: number
  deletions: number
}): React.JSX.Element {
  return (
    <span data-slot="diff-viewer-stats" className="flex shrink-0 gap-2">
      <span className="text-emerald-700 dark:text-emerald-300">+{additions}</span>
      <span className="text-red-700 dark:text-red-300">-{deletions}</span>
    </span>
  )
}
