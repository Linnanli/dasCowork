import { useCallback } from 'react'

export type ComposerCommandContentPlacement = 'panel' | 'composer'

export type ComposerCommandContentHostApi = {
  back: () => void
  close: () => void
  reportError: (message: string) => void
  restoreFocus: () => void
}

export type ComposerCommandContentHostProps = {
  children: (api: ComposerCommandContentHostApi) => React.ReactNode
  onBack?: () => void
  onClose: () => void
  onError?: (message: string) => void
}

/**
 * Gives command content a narrow lifecycle API. Content never manipulates the
 * suggestion store directly, which keeps close/focus behavior consistent.
 */
export function ComposerCommandContentHost({
  children,
  onBack,
  onClose,
  onError
}: ComposerCommandContentHostProps): React.JSX.Element {
  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.aui-lexical-input')?.focus()
    )
  }, [])
  const close = useCallback(() => {
    onClose()
    restoreFocus()
  }, [onClose, restoreFocus])
  const back = useCallback(() => {
    onBack?.()
    restoreFocus()
  }, [onBack, restoreFocus])
  const reportError = useCallback((message: string) => onError?.(message), [onError])

  return <>{children({ back, close, reportError, restoreFocus })}</>
}
