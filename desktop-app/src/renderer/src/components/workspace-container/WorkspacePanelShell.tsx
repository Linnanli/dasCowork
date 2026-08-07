import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TransitionEvent
} from 'react'
import { useDroppable } from '@dnd-kit/core'

import { cn } from '@/lib/utils'
import type { WorkspaceTabStripDndData } from './WorkspaceTabDragProvider'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'
import type { WorkspaceOpenTarget } from './workspaceOpenTargets'
import {
  RIGHT_WORKSPACE_MIN_WIDTH,
  type WorkspacePanelId,
  type WorkspacePanelState,
  type WorkspaceTabRecord
} from './workspaceTypes'

const UNMOUNT_FALLBACK_MS = 250
const BOTTOM_MIN_SIZE = 220
const MAX_PANEL_RATIO = 0.7
const MIN_CONVERSATION_WIDTH = 320
const COLLAPSE_THRESHOLD_RATIO = 0.5

type WorkspacePanelShellProps = {
  panelId: WorkspacePanelId
  panel: WorkspacePanelState
  tabs: readonly WorkspaceTabRecord[]
  className?: string
  renderTab?(tab: WorkspaceTabRecord | undefined): ReactNode
  renderLauncher?(): ReactNode
  onActivate(tabId: string): void
  onClose(tabId: string): void
  onCloseOther?(tabId: string): void
  onCloseToRight?(tabId: string): void
  onPin?(tabId: string): void
  onOpen(target: WorkspaceOpenTarget): void
  onMove?(
    sourcePanelId: WorkspacePanelId,
    destinationPanelId: WorkspacePanelId,
    tabId: string,
    insertAfterTabId?: string
  ): void
  onSetSize(size: number): void
  onSetOpen(isOpen: boolean): void
  onFocus?(panelId: WorkspacePanelId): void
  onOverlayVisibilityChange?(visible: boolean): void
}

export function WorkspacePanelShell({
  panelId,
  panel,
  tabs,
  className,
  renderTab,
  renderLauncher,
  onActivate,
  onClose,
  onCloseOther,
  onCloseToRight,
  onPin,
  onOpen,
  onMove,
  onSetSize,
  onSetOpen,
  onFocus,
  onOverlayVisibilityChange
}: WorkspacePanelShellProps): React.JSX.Element {
  const [mounted, setMounted] = useState(panel.isOpen)
  const [resizing, setResizing] = useState(false)
  const shellRef = useRef<HTMLElement | null>(null)
  const [availableSize, setAvailableSize] = useState(() => viewportSize(panelId))
  const [hasMeasuredParent, setHasMeasuredParent] = useState(false)
  const isRight = panelId === 'right'
  const maximumSize = isRight
    ? hasMeasuredParent
      ? Math.min(availableSize * MAX_PANEL_RATIO, availableSize - MIN_CONVERSATION_WIDTH)
      : availableSize * MAX_PANEL_RATIO
    : availableSize * MAX_PANEL_RATIO
  const resizeRailSize = panel.isMaximized ? 0 : 8
  const minSize = isRight
    ? Math.min(RIGHT_WORKSPACE_MIN_WIDTH, Math.max(0, maximumSize - resizeRailSize))
    : BOTTOM_MIN_SIZE
  const targetSize = Math.min(
    Math.max(minSize + resizeRailSize, panel.size + resizeRailSize),
    Math.max(0, maximumSize)
  )
  const renderedSize = panel.isOpen ? targetSize : 0
  const activeTab = tabs.find((tab) => tab.id === panel.activeTabId)
  const emptyPanelDropData = useMemo<WorkspaceTabStripDndData>(
    () => ({ kind: 'workspace-tab-strip', panelId, panelTabIds: tabs.map((tab) => tab.id) }),
    [panelId, tabs]
  )
  const { setNodeRef: setEmptyPanelDropRef } = useDroppable({
    id: `workspace-tab-panel:${panelId}`,
    data: emptyPanelDropData,
    disabled: !onMove || tabs.length > 0
  })

  useEffect(() => {
    if (panel.isOpen || resizing) {
      let active = true
      queueMicrotask(() => {
        if (active) setMounted(true)
      })
      return () => {
        active = false
      }
    }
    if (!mounted) {
      return
    }
    const timer = window.setTimeout(() => setMounted(false), UNMOUNT_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [mounted, panel.isOpen, resizing])

  const attachShell = useCallback(
    (element: HTMLElement | null): void => {
      shellRef.current = element
      const parentRect = element?.parentElement?.getBoundingClientRect()
      const next = isRight ? parentRect?.width : parentRect?.height
      if (next && next > 0) {
        setAvailableSize(next)
        setHasMeasuredParent(true)
      }
    },
    [isRight]
  )
  useEffect(() => {
    const parent = shellRef.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = isRight ? entry?.contentRect.width : entry?.contentRect.height
      if (next && next > 0) {
        setAvailableSize(next)
        setHasMeasuredParent(true)
      }
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [isRight])

  function handleTransitionEnd(event: TransitionEvent<HTMLElement>): void {
    const property = isRight ? 'width' : 'height'
    if (
      event.currentTarget === event.target &&
      event.propertyName === property &&
      !panel.isOpen &&
      !resizing
    ) {
      setMounted(false)
    }
  }

  function handleResize(rawSize: number): void {
    const requestedSize = rawSize - resizeRailSize
    if (isRight) {
      const shouldOpen = requestedSize >= minSize * COLLAPSE_THRESHOLD_RATIO
      if (shouldOpen !== panel.isOpen) {
        onSetOpen(shouldOpen)
      }
      if (!shouldOpen) {
        return
      }
    }
    onSetSize(clampSize(requestedSize, minSize, maximumSize - resizeRailSize))
  }

  const axisStyle = panel.isMaximized
    ? undefined
    : isRight
      ? { width: renderedSize, minWidth: 0 }
      : { height: renderedSize, minHeight: 0 }

  return (
    <aside
      ref={attachShell}
      data-slot={isRight ? 'right-workspace-shell' : 'bottom-workspace-shell'}
      data-workspace-panel-shell="true"
      data-workspace-drop-panel="true"
      data-workspace-panel-id={panelId}
      data-panel-id={panelId}
      aria-hidden={!panel.isOpen}
      inert={!panel.isOpen}
      onFocusCapture={() => onFocus?.(panelId)}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        'min-h-0 min-w-0 overflow-hidden bg-background text-foreground duration-200 ease-out motion-reduce:transition-none',
        isRight ? 'transition-[width]' : 'transition-[height]',
        !panel.isOpen && 'pointer-events-none',
        panel.isMaximized ? 'absolute inset-0 z-40' : 'relative shrink-0',
        className
      )}
      style={axisStyle}
    >
      {mounted ? (
        <div
          data-slot={isRight ? 'right-workspace-viewport' : 'bottom-workspace-viewport'}
          className="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
        >
          <div
            data-slot={isRight ? 'right-workspace-surface' : 'bottom-workspace-surface'}
            className={cn(
              'absolute inset-0 flex min-h-0 min-w-0 bg-background [contain:layout_paint]',
              !isRight && 'flex-col'
            )}
            style={
              panel.isMaximized
                ? { width: '100%', height: '100%', minWidth: 0, minHeight: 0 }
                : isRight
                  ? { width: targetSize, minWidth: targetSize }
                  : { height: targetSize, minHeight: targetSize }
            }
          >
            {!panel.isMaximized ? (
              <WorkspacePanelResizeHandle
                panelId={panelId}
                initialSize={targetSize}
                onSizeChange={handleResize}
                onResizingChange={setResizing}
              />
            ) : null}
            <section
              ref={tabs.length === 0 ? setEmptyPanelDropRef : undefined}
              className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
              aria-label={`${isRight ? 'Right' : 'Bottom'} workspace`}
            >
              {tabs.length ? (
                <div className="flex h-14 min-h-14 items-center border-b border-border/70">
                  <WorkspaceTabStrip
                    panelId={panelId}
                    className={cn('min-w-0 flex-1', isRight ? 'pr-30' : 'pr-22')}
                    tabs={tabs}
                    activeTabId={activeTab?.id}
                    onActivate={onActivate}
                    onClose={onClose}
                    onCloseOther={onCloseOther}
                    onCloseToRight={onCloseToRight}
                    onPin={onPin}
                    onOpen={onOpen}
                    onMove={onMove}
                    onMenuVisibilityChange={onOverlayVisibilityChange}
                  />
                </div>
              ) : null}
              <div
                className={cn('min-h-0 flex-1', tabs.length ? 'overflow-hidden' : 'overflow-auto')}
                role="tabpanel"
                id={`${isRight ? 'right-workspace' : 'bottom-workspace'}-tab-panel`}
                aria-labelledby={
                  panel.activeTabId
                    ? `${isRight ? 'right-workspace' : 'bottom-workspace'}-tab-${panel.activeTabId}`
                    : undefined
                }
              >
                {renderTab?.(activeTab) ?? renderLauncher?.()}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function WorkspacePanelResizeHandle({
  panelId,
  initialSize,
  onSizeChange,
  onResizingChange
}: {
  panelId: WorkspacePanelId
  initialSize: number
  onSizeChange(size: number): void
  onResizingChange(resizing: boolean): void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const startPosition = useRef(0)
  const startSize = useRef(initialSize)
  const isRight = panelId === 'right'

  useEffect(() => {
    if (!dragging) {
      startSize.current = initialSize
    }
  }, [dragging, initialSize])

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const delta = isRight
        ? startPosition.current - event.clientX
        : startPosition.current - event.clientY
      onSizeChange(startSize.current + delta)
    }
    const end = (): void => {
      setDragging(false)
      onResizingChange(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, isRight, onSizeChange, onResizingChange])

  return (
    <button
      type="button"
      aria-label={panelId === 'right' ? 'Resize workspace' : 'Resize bottom workspace'}
      className={cn(
        'group relative shrink-0 border-0 bg-transparent p-0 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50',
        isRight ? '-ml-1 w-2 cursor-col-resize' : '-mt-1 h-2 cursor-row-resize'
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        startPosition.current = isRight ? event.clientX : event.clientY
        startSize.current = initialSize
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        onResizingChange(true)
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bg-border/70 transition-colors group-hover:bg-foreground/40',
          isRight
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
            : 'top-1/2 inset-x-0 h-px -translate-y-1/2',
          dragging && 'bg-foreground/60'
        )}
      />
    </button>
  )
}

function clampSize(size: number, min: number, max: number): number {
  return Math.min(Math.max(min, max), Math.max(min, Math.round(size)))
}

function viewportSize(panelId: WorkspacePanelId): number {
  if (typeof window === 'undefined') return panelId === 'right' ? 1_000 : 800
  return panelId === 'right' ? window.innerWidth : window.innerHeight
}
