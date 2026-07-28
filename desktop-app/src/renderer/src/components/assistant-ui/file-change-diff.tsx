'use client'

import type { ComponentProps } from 'react'

import { DiffViewer } from './diff-viewer'
import {
  fileChangeHasRenderableDiff,
  fileChangePatch,
  type FileChangeDiffEntry
} from './file-change-diff-utils'
import { cn } from '@/lib/utils'

export type { FileChangeDiffEntry } from './file-change-diff-utils'

export function FileChangeDiffList({
  files,
  className,
  ...props
}: ComponentProps<'div'> & {
  files: readonly FileChangeDiffEntry[]
}): React.JSX.Element {
  const renderableFiles = files.filter(fileChangeHasRenderableDiff)

  if (renderableFiles.length === 0) {
    return (
      <p
        data-slot="file-change-diff"
        className={cn(
          'rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground',
          className
        )}
        {...props}
      >
        {files.length === 0 ? '正在等待文件差异' : '文件变更未提供可展示的差异'}
      </p>
    )
  }

  return (
    <div
      data-slot="file-change-diff"
      className={cn('max-h-96 space-y-2 overflow-y-auto pe-1', className)}
      {...props}
    >
      {renderableFiles.map((file, index) => (
        <FileChangeDiffViewer key={`${file.path}:${index}`} {...file} />
      ))}
    </div>
  )
}

export function FileChangeDiffViewer({
  path,
  kind,
  patch
}: FileChangeDiffEntry): React.JSX.Element {
  if (kind === 'add') {
    return (
      <DiffViewer
        oldFile={{ content: '', name: path }}
        newFile={{ content: patch ?? '', name: path }}
        size="sm"
      />
    )
  }
  if (kind === 'delete') {
    return (
      <DiffViewer
        oldFile={{ content: patch ?? '', name: path }}
        newFile={{ content: '', name: path }}
        size="sm"
      />
    )
  }

  return <DiffViewer patch={fileChangePatch(path, patch)} size="sm" />
}
