import { useLayoutEffect, useState, type RefObject } from 'react'

/** Keeps every composer suggestion layer inside the available space above the composer. */
export function useComposerSuggestionPanelMaxHeight(
  panelRef: RefObject<HTMLElement | null>
): number {
  const [panelMaxHeight, setPanelMaxHeight] = useState(320)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const updatePanelLayout = (): void => {
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
      const availableHeight = Math.floor(panel.getBoundingClientRect().bottom - headerBottom - 8)
      setPanelMaxHeight(Math.min(320, Math.max(96, availableHeight)))
    }
    updatePanelLayout()
    window.addEventListener('resize', updatePanelLayout)
    return () => window.removeEventListener('resize', updatePanelLayout)
  }, [panelRef])

  return panelMaxHeight
}
