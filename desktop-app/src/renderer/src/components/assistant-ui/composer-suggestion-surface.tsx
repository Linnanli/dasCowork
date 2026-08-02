import { FolderOpenIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'

import type { ComposerContextMenuSection } from './composer-add-context-popover'
import { ComposerCommandContentHost } from './composer-command-content-host'
import {
  ComposerCodeReviewCommandContent,
  type ComposerReviewSelection
} from './composer-code-review-command-content'
import { ComposerMcpCommandContent } from './composer-mcp-command-content'
import { ComposerSuggestionPanel } from './composer-suggestion-panel'
import type { ComposerCommandContext } from '@/composer/commands/composerCommandTypes'
import { useComposerCommandSections } from '@/composer/commands/useComposerCommandSections'
import { toContextSuggestionSections } from '@/composer/contextSuggestionProvider'
import { useComposerSuggestion } from '@/composer/composerSuggestionController'
import { dispatchComposerSuggestionSelection } from '@/composer/composerSuggestionSelection'
import { selectComposerSuggestionSections } from '@/composer/composerSuggestionSubmenus'
import type {
  ComposerSuggestionItem,
  ComposerSuggestionSection
} from '@/composer/composerSuggestionTypes'

import type { LocalContextPickerKind } from '../../../../shared/codexIpcApi'
import type { LocalGitTarget } from '../../../../shared/localGitApi'

export type ComposerSuggestionSurfaceProps = {
  codeReview: {
    disabled?: boolean
    target?: LocalGitTarget
    onSubmit(selection: ComposerReviewSelection): void | Promise<void>
  }
  commandContext: ComposerCommandContext
  contextSections: readonly ComposerContextMenuSection[]
  localPickerEnabled: boolean
  onContextOpenChange: (open: boolean) => void
  onContextQueryChange: (query: string) => void
  onOpenContent: (contentId: string) => void
  pickLocalContext: (kind: LocalContextPickerKind) => Promise<boolean>
  threadId?: string
}

/**
 * Selects one business-data provider (@/+ or /) for the single active
 * suggestion session, then renders the one shared panel shell.
 */
export function ComposerSuggestionSurface({
  codeReview,
  commandContext,
  contextSections,
  localPickerEnabled,
  onContextOpenChange,
  onContextQueryChange,
  onOpenContent,
  pickLocalContext,
  threadId
}: ComposerSuggestionSurfaceProps): React.JSX.Element | null {
  const { controller, state } = useComposerSuggestion()
  const query = state.open ? state.query : ''
  const commandSections = useComposerCommandSections({
    context: commandContext,
    query: state.open && state.trigger === '/' ? query : ''
  })
  const contextSuggestionSections = useMemo(() => {
    const sections = toContextSuggestionSections(
      contextSections,
      controller.insertTriggerItem.bind(controller)
    )
    if (!localPickerEnabled || query.trim()) return sections
    const picker: ComposerSuggestionItem = {
      id: 'context:files-and-folders',
      kind: 'context',
      label: 'Files and folders',
      icon: <FolderOpenIcon className="size-4" />,
      selection: {
        type: 'action',
        run: async () => {
          await pickLocalContext('filesAndFolders')
        }
      }
    }
    return [
      {
        id: 'context:add',
        label: '添加',
        items: [picker]
      },
      ...sections
    ] satisfies ComposerSuggestionSection[]
  }, [contextSections, controller, localPickerEnabled, pickLocalContext, query])
  const rootSections = useMemo(() => {
    if (state.open && (state.trigger === '@' || state.trigger === '+')) {
      return contextSuggestionSections
    }
    if (state.open && state.trigger === '/') return commandSections
    return []
  }, [commandSections, contextSuggestionSections, state])
  const activeSections = useMemo(
    () =>
      selectComposerSuggestionSections(rootSections, state.open ? state.view : { type: 'list' }),
    [rootSections, state]
  )

  useEffect(() => {
    controller.setSections(activeSections)
  }, [activeSections, controller])

  useEffect(() => {
    const contextOpen = state.open && (state.trigger === '@' || state.trigger === '+')
    onContextOpenChange(contextOpen)
    onContextQueryChange(contextOpen ? state.query : '')
  }, [onContextOpenChange, onContextQueryChange, state])

  useEffect(() => {
    if (!state.open || state.view.type !== 'content') return undefined
    const dismissWhenOutside = (target: EventTarget | null): void => {
      if (!(target instanceof Element)) return
      if (target.closest('[data-composer-suggestion-keep-open]')) return
      controller.close()
    }
    const onPointerDown = (event: PointerEvent): void => dismissWhenOutside(event.target)
    const onFocusIn = (event: FocusEvent): void => dismissWhenOutside(event.target)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [controller, state])

  const select = useCallback(
    (item: ComposerSuggestionItem, session: Extract<typeof state, { open: true }>): void => {
      void dispatchComposerSuggestionSelection({
        session,
        item,
        closeSession: () => controller.close(),
        updateSession: (next) => controller.updateSession(next),
        rangeMatches: (range, expectedText) => controller.rangeMatches(range, expectedText),
        replaceRange: (range, replacement) => controller.replaceRange(range, replacement),
        insertContext: (reference, range) => controller.insertContext(reference, range),
        openContent: ({ contentId }) => onOpenContent(contentId),
        onError: () => controller.close()
      })
    },
    [controller, onOpenContent]
  )

  useEffect(() => controller.registerSelectionHandler(select), [controller, select])

  if (!state.open) return null
  if (state.view.type === 'content') {
    const returnToCommandList = (): void => {
      controller.updateSession({
        ...state,
        view: { type: 'list' },
        highlightedId: null
      })
    }
    if (state.view.id === 'code-review') {
      return (
        <ComposerCommandContentHost onBack={returnToCommandList} onClose={() => controller.close()}>
          {({ close }) => (
            <ComposerCodeReviewCommandContent
              disabled={codeReview.disabled}
              target={codeReview.target}
              onSubmit={async (selection) => {
                await codeReview.onSubmit(selection)
                close()
              }}
            />
          )}
        </ComposerCommandContentHost>
      )
    }
    if (state.view.id === 'mcp') {
      return (
        <ComposerCommandContentHost onBack={returnToCommandList} onClose={() => controller.close()}>
          {({ back, close }) => (
            <ComposerMcpCommandContent threadId={threadId} onBack={back} onClose={close} />
          )}
        </ComposerCommandContentHost>
      )
    }
    return null
  }

  return (
    <ComposerSuggestionPanel
      ariaLabel={state.trigger === '/' ? '命令' : '添加上下文'}
      emptyLabel={state.trigger === '/' ? '没有匹配命令' : '没有可引用的上下文'}
      highlightedId={state.highlightedId}
      sections={activeSections}
      onDismiss={() => controller.dismiss()}
      onHighlight={controller.highlight.bind(controller)}
      onSelect={(item) => controller.selectItem(item)}
    />
  )
}
