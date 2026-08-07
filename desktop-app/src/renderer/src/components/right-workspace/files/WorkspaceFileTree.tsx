import { FileTree, useFileTree } from '@pierre/trees/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { GitStatusEntry } from '@pierre/trees'
import { cn } from '@/lib/utils'
import type { WorkspaceFileTreeModel } from './workspaceFileTreeModel'
import { workspacePathFromTreePath } from './workspaceFileTreeModel'

type Props = {
  autoExpandedPaths?: ReadonlySet<string>
  expandedPaths: ReadonlySet<string>
  gitStatus?: readonly GitStatusEntry[]
  model: WorkspaceFileTreeModel
  persistExpansion?: boolean
  rootId?: string
  scrollTop: number
  selectedPath: string
  workspaceId: string
  onEnsureDirectory(path: string): Promise<void>
  onExpandedPathsChange(paths: readonly string[]): void
  onOpenFile(path: string, title: string, mode: 'preview' | 'pinned'): void
  onOpenWithSystem(path: string): Promise<void>
  onScrollTopChange(scrollTop: number): void
  onError(message: string): void
}

export function WorkspaceFileTree({
  autoExpandedPaths,
  expandedPaths,
  gitStatus,
  model: treeModel,
  persistExpansion = true,
  rootId,
  scrollTop,
  selectedPath,
  workspaceId,
  onEnsureDirectory,
  onExpandedPathsChange,
  onOpenFile,
  onOpenWithSystem,
  onScrollTopChange,
  onError
}: Props): React.JSX.Element {
  const callbacksRef = useRef({
    onEnsureDirectory,
    onOpenFile,
    onOpenWithSystem,
    onError
  })
  const expandedPathsRef = useRef(autoExpandedPaths ?? expandedPaths)
  const treeModelRef = useRef(treeModel)
  const scrollTimeoutRef = useRef<number | undefined>(undefined)
  const appliedRootIdRef = useRef<string | undefined>(undefined)
  const appliedPathsRef = useRef<readonly string[] | undefined>(undefined)

  useEffect(() => {
    callbacksRef.current = { onEnsureDirectory, onOpenFile, onOpenWithSystem, onError }
  }, [onEnsureDirectory, onError, onOpenFile, onOpenWithSystem])

  useEffect(() => {
    expandedPathsRef.current = autoExpandedPaths ?? expandedPaths
  }, [autoExpandedPaths, expandedPaths])

  useEffect(() => {
    treeModelRef.current = treeModel
  }, [treeModel])

  const initialExpandedTreePaths = useMemo(
    () => [...expandedPaths].map((path) => `${path}/`),
    // The hook needs a stable initial value. Later expansion changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )
  const initialSelectedPaths = useMemo(
    () => (selectedPath ? [selectedPath] : []),
    // Selection is synchronized after construction so it can reveal newly loaded paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )
  const treeOptions = useMemo(
    () => ({
      composition: {
        contextMenu: {
          enabled: true,
          onOpen: (
            item: { kind: 'directory' | 'file'; name: string; path: string },
            context: { close(): void }
          ) => {
            context.close()
            if (item.kind !== 'file') return
            void showNativeFileMenu(item, callbacksRef)
          },
          triggerMode: 'right-click' as const
        }
      },
      fileTreeSearchMode: 'hide-non-matches' as const,
      flattenEmptyDirectories: Boolean(autoExpandedPaths),
      gitStatus,
      id: `workspace-file-tree-${safeTreeId(workspaceId)}`,
      icons: { colored: true, set: 'complete' as const },
      initialExpandedPaths: initialExpandedTreePaths,
      initialSelectedPaths,
      itemHeight: 32,
      onSelectionChange: (paths: readonly string[]) => {
        const treePath = paths.at(-1)
        if (!treePath) return
        const entry = treeModelRef.current.entriesByTreePath.get(treePath)
        if (!entry) return
        if (entry.kind === 'directory') {
          void callbacksRef.current.onEnsureDirectory(entry.path).catch(() => undefined)
          return
        }
        if (entry.kind === 'file')
          callbacksRef.current.onOpenFile(entry.path, entry.name, 'preview')
      },
      paths: treeModel.paths,
      renderRowDecoration: ({ item }) =>
        treeModelRef.current.truncatedDirectoryPaths.has(workspacePathFromTreePath(item.path) ?? '')
          ? { text: '截断', title: '此目录只加载了服务允许的前 500 项。' }
          : null,
      renaming: false,
      search: false,
      stickyFolders: true,
      unsafeCSS: fileTreeUnsafeCss
    }),
    [
      autoExpandedPaths,
      gitStatus,
      initialExpandedTreePaths,
      initialSelectedPaths,
      treeModel.paths,
      workspaceId
    ]
  )
  const { model } = useFileTree(treeOptions)

  useEffect(() => {
    const previousRootId = appliedRootIdRef.current
    const pathsChanged = !pathsEqual(appliedPathsRef.current ?? [], treeModel.paths)
    if (previousRootId === rootId && !pathsChanged) return
    appliedRootIdRef.current = rootId
    appliedPathsRef.current = treeModel.paths
    model.resetPaths(treeModel.paths, {
      initialExpandedPaths: [...expandedPathsRef.current].map((path) => `${path}/`)
    })
  }, [model, rootId, treeModel.paths])

  useEffect(() => {
    model.setGitStatus(gitStatus ?? [])
  }, [gitStatus, model])

  useEffect(() => {
    if (!persistExpansion) return
    const unsubscribe = model.subscribe(() => {
      const expanded = treeModel.paths.flatMap((treePath) => {
        const item = model.getItem(treePath)
        if (!item || !item.isDirectory()) return []
        if (!('isExpanded' in item) || !item.isExpanded()) return []
        const path = workspacePathFromTreePath(treePath)
        return path ? [path] : []
      })
      expandedPathsRef.current = new Set(expanded)
      onExpandedPathsChange(expanded)
    })
    return unsubscribe
  }, [model, onExpandedPathsChange, persistExpansion, treeModel.paths])

  useEffect(() => {
    if (!selectedPath) return
    let frame = 0
    let attempts = 0
    const revealSelectedPath = (): void => {
      const item = model.getItem(selectedPath)
      if (item) {
        item.select()
        model.scrollToPath(selectedPath, { focus: false, offset: 'nearest' })
        return
      }
      if (attempts < 60) {
        attempts += 1
        frame = window.requestAnimationFrame(revealSelectedPath)
      }
    }
    revealSelectedPath()
    return () => window.cancelAnimationFrame(frame)
  }, [model, selectedPath, treeModel.paths])

  useEffect(() => {
    let frame = 0
    let detach: (() => void) | undefined
    const attachScrollListener = (): void => {
      const scrollElement = model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLElement>('[data-file-tree-virtualized-scroll="true"]')
      if (!scrollElement) {
        frame = window.requestAnimationFrame(attachScrollListener)
        return
      }
      scrollElement.scrollTop = scrollTop
      const handleScroll = (): void => {
        if (scrollTimeoutRef.current !== undefined) window.clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = window.setTimeout(() => {
          scrollTimeoutRef.current = undefined
          onScrollTopChange(scrollElement.scrollTop)
        }, 150)
      }
      scrollElement.addEventListener('scroll', handleScroll, { passive: true })
      detach = () => scrollElement.removeEventListener('scroll', handleScroll)
    }
    attachScrollListener()
    return () => {
      window.cancelAnimationFrame(frame)
      detach?.()
      if (scrollTimeoutRef.current !== undefined) {
        window.clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = undefined
      }
    }
  }, [model, rootId, onScrollTopChange, scrollTop])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const treePath = findTreePath(event.nativeEvent)
      if (!treePath) return
      const entry = treeModel.entriesByTreePath.get(treePath)
      if (entry?.kind === 'file') onOpenFile(entry.path, entry.name, 'pinned')
    },
    [onOpenFile, treeModel.entriesByTreePath]
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <FileTree
        model={model}
        data-tab-preview-pin-exempt="true"
        className={cn('min-h-0 flex-1 text-sm')}
        onDoubleClick={handleDoubleClick}
      />
      {treeModel.truncatedDirectoryPaths.has('') ? <TruncatedNotice className="border-t" /> : null}
    </div>
  )
}

async function showNativeFileMenu(
  item: { name: string; path: string },
  callbacksRef: React.MutableRefObject<{
    onEnsureDirectory(path: string): Promise<void>
    onOpenFile(path: string, title: string, mode: 'preview' | 'pinned'): void
    onOpenWithSystem(path: string): Promise<void>
    onError(message: string): void
  }>
): Promise<void> {
  const action = await window.desktopApp.nativeContextMenu.show([
    { id: 'preview', label: '预览', type: 'action' },
    { id: 'open-pinned', label: '固定打开', type: 'action' },
    { type: 'separator' },
    { id: 'copy-relative-path', label: '复制相对路径', type: 'action' },
    { id: 'open-with-system', label: '使用系统应用打开', type: 'action' }
  ])
  switch (action) {
    case 'preview':
      callbacksRef.current.onOpenFile(item.path, item.name, 'preview')
      return
    case 'open-pinned':
      callbacksRef.current.onOpenFile(item.path, item.name, 'pinned')
      return
    case 'copy-relative-path':
      try {
        await navigator.clipboard.writeText(item.path)
      } catch {
        callbacksRef.current.onError('无法复制相对路径。')
      }
      return
    case 'open-with-system':
      try {
        await callbacksRef.current.onOpenWithSystem(item.path)
      } catch (cause) {
        callbacksRef.current.onError(
          cause instanceof Error ? cause.message : '无法使用系统应用打开文件。'
        )
      }
  }
}

function findTreePath(event: Event): string | undefined {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue
    const path = target.dataset.itemPath
    if (path) return path
  }
  return undefined
}

function safeTreeId(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9_-]/gu, '-')
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

function TruncatedNotice({ className }: { className?: string }): React.JSX.Element {
  return (
    <p className={cn('px-3 py-2 text-xs text-muted-foreground', className)} role="status">
      此目录仅显示前 500 项；请使用搜索查找其他文件。
    </p>
  )
}

export const fileTreeUnsafeCss = `
  :host {
    color-scheme: light dark;
    --trees-bg-override: var(--background);
    --trees-bg-muted-override: var(--accent);
    --trees-fg-override: var(--foreground);
    --trees-fg-muted-override: var(--muted-foreground);
    --trees-input-bg-override: var(--background);
    --trees-border-color-override: var(--border);
    --trees-selected-bg-override: var(--muted);
    --trees-selected-fg-override: var(--foreground);
    --trees-selected-focused-border-color-override: var(--ring);
    --trees-focus-ring-color-override: var(--ring);
    --trees-indent-guide-bg-override: color-mix(in srgb, var(--muted-foreground) 28%, transparent);
    --trees-scrollbar-thumb-override: color-mix(in srgb, var(--muted-foreground) 30%, transparent);
    --trees-icon-gray: var(--muted-foreground);
  }
  [data-type='item'] { border-radius: 0.375rem; }
  [data-type='item'][data-item-selected] { min-height: 2.5rem; }
`
