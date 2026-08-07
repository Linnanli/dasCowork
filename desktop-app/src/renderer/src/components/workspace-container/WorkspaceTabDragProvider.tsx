/* eslint-disable react-refresh/only-export-components -- context and provider form one drag boundary. */
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier
} from '@dnd-kit/core'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import type { WorkspacePanelId, WorkspaceTabRecord } from './workspaceTypes'

export type WorkspaceTabInsertionPlacement = 'before' | 'after'

type WorkspaceTabMove = (
  sourcePanelId: WorkspacePanelId,
  destinationPanelId: WorkspacePanelId,
  tabId: string,
  insertAfterTabId?: string
) => void

export type WorkspaceTabDndData = {
  kind: 'workspace-tab'
  panelId: WorkspacePanelId
  panelTabIds: readonly string[]
  tab: WorkspaceTabRecord
  overlay: ReactNode
  onMove: WorkspaceTabMove
  onDragComplete(tabId: string): void
}

export type WorkspaceTabStripDndData = {
  kind: 'workspace-tab-strip'
  panelId: WorkspacePanelId
  panelTabIds: readonly string[]
}

type WorkspaceDndData = WorkspaceTabDndData | WorkspaceTabStripDndData

export type ActiveWorkspaceTabDrag = {
  tab: WorkspaceTabRecord
  overlay: ReactNode
  sourcePanelId: WorkspacePanelId
  sourceTabIds: readonly string[]
  destinationPanelId: WorkspacePanelId
  destinationTabIds: readonly string[]
  overTabId?: string
  insertionPlacement: WorkspaceTabInsertionPlacement
  onMove: WorkspaceTabMove
  onDragComplete(tabId: string): void
}

type WorkspaceTabDragContextValue = {
  activeDrag?: ActiveWorkspaceTabDrag
}

const WorkspaceTabDragContext = createContext<WorkspaceTabDragContextValue | null>(null)

export function WorkspaceTabDragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const activeDragRef = useRef<ActiveWorkspaceTabDrag | undefined>(undefined)
  const [activeDrag, setActiveDrag] = useState<ActiveWorkspaceTabDrag | undefined>(undefined)

  const updateActiveDrag = useCallback((next: ActiveWorkspaceTabDrag | undefined): void => {
    activeDragRef.current = next
    setActiveDrag(next)
  }, [])

  const finishDrag = useCallback(
    (commit: boolean): void => {
      const drag = activeDragRef.current
      updateActiveDrag(undefined)
      if (!drag) return
      drag.onDragComplete(drag.tab.id)
      if (!commit) return

      const previewTabIds = workspaceTabPreviewIds(
        drag.destinationTabIds,
        drag.tab.id,
        drag.overTabId,
        drag.insertionPlacement
      )
      if (
        drag.destinationPanelId === drag.sourcePanelId &&
        sameStringArray(previewTabIds, drag.sourceTabIds)
      ) {
        return
      }
      const destinationIndex = previewTabIds.indexOf(drag.tab.id)
      const insertAfterTabId =
        destinationIndex > 0 ? previewTabIds[destinationIndex - 1] : undefined
      drag.onMove(drag.sourcePanelId, drag.destinationPanelId, drag.tab.id, insertAfterTabId)
    },
    [updateActiveDrag]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const data = workspaceDndData(event.active.data.current)
      if (data?.kind !== 'workspace-tab') return
      updateActiveDrag({
        tab: data.tab,
        overlay: data.overlay,
        sourcePanelId: data.panelId,
        sourceTabIds: data.panelTabIds,
        destinationPanelId: data.panelId,
        destinationTabIds: data.panelTabIds,
        overTabId: data.tab.id,
        insertionPlacement: 'before',
        onMove: data.onMove,
        onDragComplete: data.onDragComplete
      })
    },
    [updateActiveDrag]
  )

  const updateDragTarget = useCallback(
    (event: DragMoveEvent | DragOverEvent): void => {
      const drag = activeDragRef.current
      if (!drag || !event.over) return
      const target = workspaceDndData(event.over.data.current)
      if (!target) return
      if (target.kind === 'workspace-tab' && target.tab.id === drag.tab.id) return
      updateActiveDrag({
        ...drag,
        destinationPanelId: target.panelId,
        destinationTabIds: target.panelTabIds,
        overTabId: target.kind === 'workspace-tab' ? target.tab.id : undefined,
        insertionPlacement:
          target.kind === 'workspace-tab' ? collisionInsertionPlacement(event) : 'before'
      })
    },
    [updateActiveDrag]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => finishDrag(event.over != null),
    [finishDrag]
  )
  const handleDragCancel = useCallback((): void => finishDrag(false), [finishDrag])

  useEffect(() => {
    if (!activeDrag) return
    const cancelWithEscape = (): void => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Escape',
          key: 'Escape'
        })
      )
    }
    const cancelWhenHidden = (): void => {
      if (document.visibilityState !== 'visible') cancelWithEscape()
    }

    window.addEventListener('blur', cancelWithEscape)
    document.addEventListener('lostpointercapture', cancelWithEscape, true)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    document.documentElement.addEventListener('pointerleave', cancelWithEscape)
    return () => {
      window.removeEventListener('blur', cancelWithEscape)
      document.removeEventListener('lostpointercapture', cancelWithEscape, true)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
      document.documentElement.removeEventListener('pointerleave', cancelWithEscape)
    }
  }, [activeDrag])

  const value = useMemo<WorkspaceTabDragContextValue>(() => ({ activeDrag }), [activeDrag])

  return (
    <WorkspaceTabDragContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        collisionDetection={workspaceTabCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={updateDragTarget}
        onDragOver={updateDragTarget}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        {activeDrag && typeof document !== 'undefined'
          ? createPortal(
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed inset-0 z-50 cursor-grabbing"
                />
                <DragOverlay adjustScale={false} zIndex={51}>
                  {activeDrag.overlay}
                </DragOverlay>
              </>,
              document.body
            )
          : null}
      </DndContext>
    </WorkspaceTabDragContext.Provider>
  )
}

export function useOptionalWorkspaceTabDrag(): WorkspaceTabDragContextValue | null {
  return useContext(WorkspaceTabDragContext)
}

export function useWorkspaceTabDrag(): WorkspaceTabDragContextValue {
  const context = useContext(WorkspaceTabDragContext)
  if (!context) throw new Error('useWorkspaceTabDrag must be used within WorkspaceTabDragProvider')
  return context
}

export function workspaceTabPreviewIds(
  panelTabIds: readonly string[],
  draggedTabId: string,
  overTabId: string | undefined,
  placement: WorkspaceTabInsertionPlacement
): readonly string[] {
  if (overTabId === draggedTabId) return panelTabIds
  const withoutDraggedTab = panelTabIds.filter((tabId) => tabId !== draggedTabId)
  if (!overTabId) return [draggedTabId, ...withoutDraggedTab]
  const targetIndex = withoutDraggedTab.indexOf(overTabId)
  if (targetIndex === -1) return [...withoutDraggedTab, draggedTabId]
  const insertionIndex = targetIndex + (placement === 'after' ? 1 : 0)
  return [
    ...withoutDraggedTab.slice(0, insertionIndex),
    draggedTabId,
    ...withoutDraggedTab.slice(insertionIndex)
  ]
}

function workspaceTabCollisionDetection(
  args: Parameters<CollisionDetection>[0]
): ReturnType<CollisionDetection> {
  const pointerCollisions = pointerWithin(args)
  const tabCollisions = pointerCollisions.filter(
    (collision) => workspaceCollisionData(collision)?.kind === 'workspace-tab'
  )
  if (tabCollisions.length > 0) return withInsertionPlacement(tabCollisions, args)

  const stripCollision = pointerCollisions.find(
    (collision) => workspaceCollisionData(collision)?.kind === 'workspace-tab-strip'
  )
  const stripData = stripCollision ? workspaceCollisionData(stripCollision) : undefined
  if (stripCollision && stripData?.kind === 'workspace-tab-strip') {
    const panelTabs = args.droppableContainers.filter((container) => {
      const data = workspaceDndData(container.data.current)
      return data?.kind === 'workspace-tab' && data.panelId === stripData.panelId
    })
    if (panelTabs.length === 0) return [stripCollision]
    return withInsertionPlacement(closestCenter({ ...args, droppableContainers: panelTabs }), args)
  }

  return withInsertionPlacement(closestCenter(args), args)
}

function withInsertionPlacement(
  collisions: Collision[],
  args: Parameters<CollisionDetection>[0]
): Collision[] {
  return collisions.map((collision) => {
    const data = workspaceCollisionData(collision)
    const rect = args.droppableRects.get(collision.id)
    if (data?.kind !== 'workspace-tab' || !rect) return collision
    const pointerX = args.pointerCoordinates?.x
    const placement: WorkspaceTabInsertionPlacement =
      pointerX != null && pointerX >= rect.left + rect.width / 2 ? 'after' : 'before'
    return {
      ...collision,
      data: {
        ...collision.data,
        workspaceTabInsertionPlacement: placement
      }
    }
  })
}

function workspaceCollisionData(collision: Collision): WorkspaceDndData | null {
  return workspaceDndData(collision.data?.droppableContainer.data.current)
}

function workspaceDndData(data: unknown): WorkspaceDndData | null {
  if (typeof data !== 'object' || !data) return null
  const kind = Reflect.get(data, 'kind')
  if (kind !== 'workspace-tab' && kind !== 'workspace-tab-strip') return null
  return data as WorkspaceDndData
}

function collisionInsertionPlacement(
  event: Pick<DragMoveEvent, 'collisions' | 'over'>
): WorkspaceTabInsertionPlacement {
  const overId: UniqueIdentifier | undefined = event.over?.id
  const collision = event.collisions?.find((candidate) => candidate.id === overId)
  return collision?.data?.workspaceTabInsertionPlacement === 'after' ? 'after' : 'before'
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
