import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useRightWorkspace } from './RightWorkspaceProvider'

export function RightWorkspaceResizeHandle({
  className
}: {
  className?: string
}): React.JSX.Element {
  const { setPanelWidth, state } = useRightWorkspace()
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(state.panelWidth)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      startXRef.current = event.clientX
      startWidthRef.current = state.panelWidth
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    },
    [state.panelWidth]
  )

  useEffect(() => {
    if (!dragging) return
    const onPointerMove = (event: PointerEvent): void => {
      setPanelWidth(startWidthRef.current + startXRef.current - event.clientX)
    }
    const onPointerUp = (): void => setDragging(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [dragging, setPanelWidth])

  return (
    <button
      type="button"
      aria-label="Resize workspace"
      className={cn(
        'group relative -ml-1 w-2 shrink-0 cursor-col-resize border-0 bg-transparent p-0 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      onPointerDown={onPointerDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-foreground/40',
          dragging && 'bg-foreground/60'
        )}
      />
    </button>
  )
}
