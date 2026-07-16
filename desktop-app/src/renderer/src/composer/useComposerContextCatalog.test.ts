// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'

import type {
  ComposerContextCatalogChangeEvent,
  ComposerContextCatalogResult,
  ComposerContextReference
} from '../../../shared/codexIpcApi'
import {
  composerContextChangeMatchesRequest,
  composerContextReferenceToTriggerItem,
  useComposerContextCatalog
} from './useComposerContextCatalog'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = undefined
  }
  vi.unstubAllGlobals()
})

describe('composerContextReferenceToTriggerItem', () => {
  it.each([
    [
      {
        version: 1,
        kind: 'file',
        canonicalId: 'file:/repo/src/App.tsx',
        label: 'App.tsx',
        presentation: 'mention',
        path: '/repo/src/App.tsx',
        root: '/repo'
      },
      { type: 'file', id: '/repo/src/App.tsx', description: 'src/App.tsx' }
    ],
    [
      {
        version: 1,
        kind: 'folder',
        canonicalId: 'folder:/repo/src',
        label: 'src',
        presentation: 'mention',
        path: '/repo/src',
        root: '/repo'
      },
      { type: 'folder', id: '/repo/src', description: 'src' }
    ],
    [
      {
        version: 1,
        kind: 'chat',
        canonicalId: 'chat:thread-1',
        label: 'Prior chat',
        presentation: 'mention',
        threadId: 'thread-1',
        uri: 'thread://thread-1'
      },
      { type: 'chat', id: 'thread://thread-1' }
    ],
    [
      {
        version: 1,
        kind: 'liveAgent',
        canonicalId: 'agent:child-1',
        label: 'Explorer',
        presentation: 'mention',
        threadId: 'child-1',
        parentThreadId: 'thread-1',
        uri: 'agent://child-1',
        status: 'completed'
      },
      { type: 'agent', id: 'agent://child-1', description: '已完成' }
    ],
    [
      {
        version: 1,
        kind: 'configuredAgent',
        canonicalId: 'configured-agent:reviewer',
        label: 'reviewer',
        presentation: 'mention',
        roleName: 'reviewer',
        uri: 'subagent://reviewer'
      },
      { type: 'agentRole', id: 'subagent://reviewer' }
    ],
    [
      {
        version: 1,
        kind: 'skill',
        canonicalId: 'skill:/skills/review/SKILL.md',
        label: 'review',
        presentation: 'mention',
        name: 'review',
        path: '/skills/review/SKILL.md'
      },
      { type: 'skill', id: '/skills/review/SKILL.md' }
    ],
    [
      {
        version: 1,
        kind: 'plugin',
        canonicalId: 'plugin:github',
        label: 'GitHub',
        presentation: 'mention',
        pluginId: 'github',
        uri: 'plugin://github',
        mentionName: 'github'
      },
      { type: 'plugin', id: 'plugin://github' }
    ],
    [
      {
        version: 1,
        kind: 'app',
        canonicalId: 'app:slack',
        label: 'Slack',
        presentation: 'mention',
        appId: 'slack',
        uri: 'app://slack',
        mentionName: 'slack'
      },
      { type: 'app', id: 'app://slack' }
    ]
  ] as const)('maps %s to its directive identity', (reference, expected) => {
    expect(
      composerContextReferenceToTriggerItem(reference as ComposerContextReference)
    ).toMatchObject(expected)
  })

  it('carries canonical mentionName in app/plugin trigger metadata', () => {
    expect(
      composerContextReferenceToTriggerItem({
        version: 1,
        kind: 'app',
        canonicalId: 'app:slack',
        label: 'Slack Workspace',
        presentation: 'mention',
        appId: 'slack',
        uri: 'app://slack',
        mentionName: 'slack'
      })
    ).toMatchObject({
      id: 'app://slack',
      label: 'Slack Workspace',
      metadata: { mentionName: 'slack' }
    })
  })
})

describe('composerContextChangeMatchesRequest', () => {
  const request = {
    version: 1 as const,
    cwd: '/repo',
    threadId: 'thread-1',
    projectSelection: { projectKind: 'path' as const, path: '/repo' }
  }

  it('accepts global and matching local changes', () => {
    expect(
      composerContextChangeMatchesRequest({ version: 1, sectionIds: ['chats'] }, request)
    ).toBe(true)
    expect(
      composerContextChangeMatchesRequest(
        {
          version: 1,
          sectionIds: ['agents'],
          scope: { hostId: 'local', cwd: '/repo', threadId: 'thread-1' }
        },
        request
      )
    ).toBe(true)
  })

  it('rejects changes for another host, cwd or thread', () => {
    expect(
      composerContextChangeMatchesRequest(
        { version: 1, sectionIds: ['agents'], scope: { threadId: 'thread-2' } },
        request
      )
    ).toBe(false)
    expect(
      composerContextChangeMatchesRequest(
        { version: 1, sectionIds: ['skills'], scope: { cwd: '/other' } },
        request
      )
    ).toBe(false)
    expect(
      composerContextChangeMatchesRequest(
        { version: 1, sectionIds: ['apps'], scope: { hostId: 'remote-a' } },
        request
      )
    ).toBe(false)
  })
})

describe('useComposerContextCatalog', () => {
  it('keeps discovered app/plugin identities when a later query narrows the visible catalog', async () => {
    const sections = (items: {
      apps?: ComposerContextReference[]
      plugins?: ComposerContextReference[]
    }): ComposerContextCatalogResult['sections'] =>
      (['files', 'chats', 'agents', 'skills', 'plugins', 'apps'] as const).map((id) => {
        let sectionItems: ComposerContextReference[] = []
        if (id === 'apps') {
          sectionItems = items.apps ?? []
        } else if (id === 'plugins') {
          sectionItems = items.plugins ?? []
        }
        return {
          id,
          status: 'ready' as const,
          items: sectionItems
        }
      })
    const first = {
      version: 1 as const,
      generatedAt: '2026-07-15T00:00:00.000Z',
      sections: sections({
        apps: [
          {
            version: 1,
            kind: 'app',
            canonicalId: 'app:slack',
            label: 'Slack Workspace',
            presentation: 'mention',
            appId: 'slack',
            uri: 'app://slack',
            mentionName: 'slack'
          }
        ]
      })
    }
    const narrowed = {
      ...first,
      generatedAt: '2026-07-15T00:00:01.000Z',
      sections: sections({
        plugins: [
          {
            version: 1,
            kind: 'plugin',
            canonicalId: 'plugin:github',
            label: 'GitHub',
            presentation: 'mention',
            pluginId: 'github',
            uri: 'plugin://github',
            mentionName: 'github'
          }
        ]
      })
    }
    const list = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(narrowed)
    vi.stubGlobal('desktopApp', {
      composerContext: {
        list,
        refresh: vi.fn(),
        onDidChange: vi.fn(() => () => undefined)
      }
    })
    let catalog: ReturnType<typeof useComposerContextCatalog> | undefined
    const projectSelection = { projectKind: 'path' as const, path: '/repo' }
    function Harness(): null {
      catalog = useComposerContextCatalog({
        cwd: '/repo',
        enabled: true,
        projectSelection,
        threadId: 'thread-1'
      })
      return null
    }

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(createElement(Harness)))
    expect(catalog?.identityIndex.get('app://slack')?.displayLabel).toBe('Slack Workspace')

    await act(async () => catalog?.setQuery('github'))

    expect(list).toHaveBeenCalledTimes(2)
    expect(catalog?.identityIndex.get('app://slack')?.mentionName).toBe('slack')
    expect(catalog?.identityIndex.get('plugin://github')?.displayLabel).toBe('GitHub')
  })

  it('reloads matching change events and uses targeted refresh for a section retry', async () => {
    const result = {
      version: 1 as const,
      generatedAt: '2026-07-15T00:00:00.000Z',
      sections: (['files', 'chats', 'agents', 'skills', 'plugins', 'apps'] as const).map((id) => ({
        id,
        status: 'ready' as const,
        items: []
      }))
    }
    const list = vi.fn(async () => result)
    const refresh = vi.fn(async () => result)
    let notify: ((event: ComposerContextCatalogChangeEvent) => void) | undefined
    const removeListener = vi.fn()
    vi.stubGlobal('desktopApp', {
      composerContext: {
        list,
        refresh,
        onDidChange: vi.fn((callback) => {
          notify = callback
          return removeListener
        })
      }
    })
    let catalog: ReturnType<typeof useComposerContextCatalog> | undefined
    const projectSelection = { projectKind: 'path' as const, path: '/repo' }
    function Harness(): null {
      catalog = useComposerContextCatalog({
        cwd: '/repo',
        enabled: true,
        projectSelection,
        threadId: 'thread-1'
      })
      return null
    }

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(createElement(Harness)))
    expect(list).toHaveBeenCalledOnce()

    await act(async () =>
      notify?.({ version: 1, sectionIds: ['agents'], scope: { threadId: 'thread-2' } })
    )
    expect(list).toHaveBeenCalledOnce()
    await act(async () =>
      notify?.({ version: 1, sectionIds: ['agents'], scope: { threadId: 'thread-1' } })
    )
    expect(list).toHaveBeenCalledTimes(2)

    await act(async () => catalog?.refresh('skills'))
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo', threadId: 'thread-1' }),
      { sectionIds: ['skills'] }
    )

    act(() => root?.unmount())
    root = undefined
    expect(removeListener).toHaveBeenCalledOnce()
  })
})
