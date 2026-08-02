// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerSuggestionSurface } from './composer-suggestion-surface'
import {
  ComposerSuggestionProvider,
  ComposerSuggestionStore,
  useComposerSuggestion
} from '@/composer/composerSuggestionController'
import { ComposerCommandRegistryProvider } from '@/composer/commands/composerCommandRegistry'
import { selectComposerSuggestionSections } from '@/composer/composerSuggestionSubmenus'
import type { ComposerSuggestionSection } from '@/composer/composerSuggestionTypes'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const childSections: readonly ComposerSuggestionSection[] = [
  {
    id: 'child',
    items: [
      {
        id: 'child-action',
        kind: 'command',
        label: 'Child action',
        selection: { type: 'action', run: () => undefined }
      }
    ]
  }
]

const rootSections: readonly ComposerSuggestionSection[] = [
  {
    id: 'root',
    items: [
      {
        id: 'parent',
        kind: 'submenu',
        label: 'Parent',
        selection: { type: 'submenu', submenuId: 'child-menu' },
        submenus: [{ id: 'child-menu', sections: childSections }]
      }
    ]
  }
]

describe('selectComposerSuggestionSections', () => {
  it('returns the child sections for the selected submenu', () => {
    expect(
      selectComposerSuggestionSections(rootSections, {
        type: 'submenu',
        id: 'child-menu',
        parentId: 'parent'
      })
    ).toBe(childSections)
  })

  it('returns the root sections for a list view and missing submenu', () => {
    expect(selectComposerSuggestionSections(rootSections, { type: 'list' })).toBe(rootSections)
    expect(
      selectComposerSuggestionSections(rootSections, {
        type: 'submenu',
        id: 'missing',
        parentId: 'parent'
      })
    ).toEqual([])
  })
})

describe('ComposerSuggestionSurface', () => {
  let container: HTMLDivElement
  let root: Root
  let controller: ComposerSuggestionStore | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    window.desktopApp = {
      codex: {
        listMcpServers: vi.fn(async () => ({
          version: 1,
          generatedAt: '2026-08-01T00:00:00.000Z',
          servers: []
        }))
      },
      git: {
        listBranches: vi.fn(async () => ({
          current: 'feature',
          defaultBase: 'main',
          local: ['main'],
          recent: [],
          uncommittedFileCount: 1
        }))
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('closes secondary command content when focus moves outside the composer', async () => {
    await act(async () => {
      root.render(
        <ComposerCommandRegistryProvider>
          <ComposerSuggestionProvider>
            <ComposerControllerCapture
              onReady={(value) => {
                controller = value
              }}
            />
            <ComposerSuggestionSurface
              codeReview={{ onSubmit: vi.fn() }}
              commandContext={{
                draftText: '',
                hasAttachments: false,
                isRunning: false,
                isEditing: false,
                activeContentId: 'mcp',
                hasProject: true,
                hasGitReviewTarget: true
              }}
              contextSections={[]}
              localPickerEnabled={false}
              onContextOpenChange={vi.fn()}
              onContextQueryChange={vi.fn()}
              onOpenContent={vi.fn()}
              pickLocalContext={async () => false}
            />
          </ComposerSuggestionProvider>
        </ComposerCommandRegistryProvider>
      )
      await Promise.resolve()
    })

    await act(async () => {
      controller?.updateSession({
        open: true,
        trigger: '/',
        source: 'typed-slash',
        query: '',
        range: null,
        highlightedId: null,
        view: { type: 'content', id: 'mcp', placement: 'panel' }
      })
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="composer-suggestion-panel"]')).not.toBeNull()

    const composerInput = document.createElement('input')
    composerInput.className = 'aui-lexical-input'
    document.body.appendChild(composerInput)
    await act(async () => {
      composerInput.focus()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="composer-suggestion-panel"]')).toBeNull()
    composerInput.remove()
  })

  it('closes code review content after its review request is accepted', async () => {
    let acceptReview: (() => void) | undefined
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acceptReview = resolve
        })
    )

    await act(async () => {
      root.render(
        <ComposerCommandRegistryProvider>
          <ComposerSuggestionProvider>
            <ComposerControllerCapture
              onReady={(value) => {
                controller = value
              }}
            />
            <ComposerSuggestionSurface
              codeReview={{
                onSubmit,
                target: {
                  conversationId: 'conversation',
                  threadId: 'thread',
                  hostId: 'local',
                  cwd: '/repo',
                  gitRoot: '/repo'
                }
              }}
              commandContext={{
                draftText: '',
                hasAttachments: false,
                isRunning: false,
                isEditing: false,
                activeContentId: 'code-review',
                hasProject: true,
                hasGitReviewTarget: true
              }}
              contextSections={[]}
              localPickerEnabled={false}
              onContextOpenChange={vi.fn()}
              onContextQueryChange={vi.fn()}
              onOpenContent={vi.fn()}
              pickLocalContext={async () => false}
            />
          </ComposerSuggestionProvider>
        </ComposerCommandRegistryProvider>
      )
      await Promise.resolve()
    })

    await act(async () => {
      controller?.updateSession({
        open: true,
        trigger: '/',
        source: 'typed-slash',
        query: '',
        range: null,
        highlightedId: null,
        view: { type: 'content', id: 'code-review', placement: 'panel' }
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    const reviewButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('审查未提交的更改')
    )
    expect(reviewButton).toBeDefined()

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(onSubmit).toHaveBeenCalledWith({ type: 'uncommitted' })
    expect(
      container.querySelector('[data-slot="composer-code-review-command-content"]')
    ).not.toBeNull()

    await act(async () => {
      acceptReview?.()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-slot="composer-code-review-command-content"]')).toBeNull()
  })
})

function ComposerControllerCapture({
  onReady
}: {
  onReady(controller: ComposerSuggestionStore): void
}): React.JSX.Element | null {
  const { controller } = useComposerSuggestion()
  useEffect(() => onReady(controller), [controller, onReady])
  return null
}
