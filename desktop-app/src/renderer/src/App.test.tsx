// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import type { CodexApprovalRequest, DesktopProjectsApi } from '../../shared/codexIpcApi'

type MockThreadMessageState = {
  message: {
    composer: {
      isEditing: boolean
    }
    content: Array<{ type: 'reasoning' | 'text'; text: string }>
    role: 'assistant' | 'user'
    status: { type: 'complete' } | { type: 'running' }
  }
}

const threadMessageState = vi.hoisted<MockThreadMessageState>(() => ({
  message: {
    composer: {
      isEditing: false
    },
    content: [{ type: 'text', text: '正在思考' }],
    role: 'user',
    status: { type: 'complete' }
  }
}))

const streamdownPropsState = vi.hoisted<{
  lastProps: Record<string, unknown> | null
}>(() => ({
  lastProps: null
}))

const runtimeState = vi.hoisted<{
  rejectServerRequest: ReturnType<typeof vi.fn>
  respondToServerRequest: ReturnType<typeof vi.fn>
  serverRequests: CodexApprovalRequest[]
  selectedModelId: string | undefined
  setSelectedModelId: ReturnType<typeof vi.fn>
  startNewConversation: ReturnType<typeof vi.fn>
  openConversation: ReturnType<typeof vi.fn>
}>(() => ({
  rejectServerRequest: vi.fn(),
  respondToServerRequest: vi.fn(),
  serverRequests: [],
  selectedModelId: 'gpt-5-codex',
  setSelectedModelId: vi.fn(),
  startNewConversation: vi.fn(),
  openConversation: vi.fn()
}))

const mentionAdapterState = vi.hoisted<{
  calls: unknown[]
}>(() => ({
  calls: []
}))

const projectHookState = vi.hoisted(() => ({
  controller: {
    state: {
      activeProjectSelection: { projectKind: 'path', path: '/repo' },
      activeWorkspaceRoots: ['/repo'],
      workspaceRootOptions: [],
      localProjects: {},
      remoteProjects: [
        {
          id: 'remote',
          kind: 'remote',
          hostId: 'ssh-dev',
          label: 'Remote App',
          remotePath: '/srv/app',
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z'
        }
      ],
      projectOrder: [],
      pinnedProjectIds: [],
      projectWritableRoots: {},
      threadProjectAssignments: {},
      threadWritableRoots: {},
      threadWorkspaceRootHints: {},
      threadProjectlessOutputDirectories: {},
      projectlessThreadIds: [],
      projectlessHints: {}
    },
    hasSelection: true,
    currentLabel: 'repo',
    currentDetail: '/repo',
    pickWorkspaceRoot: vi.fn(),
    createLocalProject: vi.fn(),
    selectProject: vi.fn(),
    renameProject: vi.fn(),
    removeProject: vi.fn()
  }
}))

function resetThreadMessageState(): void {
  threadMessageState.message.composer.isEditing = false
  threadMessageState.message.content = [{ type: 'text', text: '正在思考' }]
  threadMessageState.message.role = 'user'
  threadMessageState.message.status = { type: 'complete' }
  streamdownPropsState.lastProps = null
  runtimeState.rejectServerRequest.mockReset()
  runtimeState.rejectServerRequest.mockResolvedValue(undefined)
  runtimeState.respondToServerRequest.mockReset()
  runtimeState.respondToServerRequest.mockResolvedValue(undefined)
  runtimeState.selectedModelId = 'gpt-5-codex'
  runtimeState.setSelectedModelId.mockReset()
  runtimeState.setSelectedModelId.mockResolvedValue(undefined)
  runtimeState.startNewConversation.mockReset()
  runtimeState.openConversation.mockReset()
  runtimeState.openConversation.mockResolvedValue(undefined)
  runtimeState.serverRequests = []
  mentionAdapterState.calls = []
}

function setDesktopPlatform(platform: NodeJS.Platform): void {
  window.desktopApp = {
    ...window.desktopApp,
    electron: {
      process: {
        platform
      }
    } as typeof window.desktopApp.electron
  }
}

function installDesktopApp(projects?: Partial<DesktopProjectsApi>): void {
  vi.stubGlobal('desktopApp', {
    electron: {
      process: {
        platform: 'darwin'
      }
    },
    codex: {},
    chat: {},
    projects: {
      getState: vi.fn(),
      pickWorkspaceRoot: vi.fn(),
      createLocalProject: vi.fn(),
      createRemoteProject: vi.fn(),
      selectProject: vi.fn(),
      removeProject: vi.fn(),
      renameProject: vi.fn(),
      createFuzzyFileSearchSession: vi.fn(async () => ({ results: [] })),
      onStateChange: vi.fn(() => vi.fn()),
      ...projects
    } satisfies DesktopProjectsApi,
    conversations: {
      getConversationList: vi.fn(async () => ({
        conversations: [],
        archivedConversationIds: [],
        loaded: true
      })),
      refreshConversationList: vi.fn(async () => ({
        conversations: [],
        archivedConversationIds: [],
        loaded: true
      })),
      openConversation: vi.fn(async () => ({
        conversationId: 'thread-1',
        threadId: 'thread-1',
        title: 'Thread',
        messages: []
      })),
      archiveConversation: vi.fn(async () => ({
        conversations: [],
        archivedConversationIds: [],
        loaded: true
      })),
      unarchiveConversation: vi.fn(async () => ({
        conversations: [],
        archivedConversationIds: [],
        loaded: true
      })),
      renameConversation: vi.fn(async () => ({
        conversations: [],
        archivedConversationIds: [],
        loaded: true
      })),
      interruptConversation: vi.fn(async () => undefined),
      getPreferences: vi.fn(async () => ({
        organizeMode: 'project',
        sortKey: 'updated_at',
        collapsedSectionIds: [],
        collapsedGroupIds: []
      })),
      setPreferences: vi.fn(async (input) => ({
        organizeMode: input.organizeMode ?? 'project',
        sortKey: input.sortKey ?? 'updated_at',
        collapsedSectionIds: input.collapsedSectionIds ?? [],
        collapsedGroupIds: input.collapsedGroupIds ?? []
      })),
      onConversationListChange: vi.fn(() => () => undefined)
    }
  })
}

function noopResizeObserverMethod(): void {
  return undefined
}

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {
    noopResizeObserverMethod()
  }

  observe(): void {
    noopResizeObserverMethod()
  }

  unobserve(): void {
    noopResizeObserverMethod()
  }
}

type PrimitiveProps = {
  children?: ReactNode | ((value: unknown) => ReactNode)
  asChild?: boolean
  components?: Record<string, unknown>
  condition?: ((state: unknown) => boolean) | boolean
  char?: string
  placeholder?: string
  directiveChip?: unknown
  className?: string
}

function messagePartComponentFor(
  part: { type: 'reasoning' | 'text' },
  components: Record<string, unknown> | undefined
): React.ComponentType<{ text: string }> | undefined {
  if (part.type === 'reasoning' && typeof components?.Reasoning === 'function') {
    return components.Reasoning as React.ComponentType<{ text: string }>
  }
  if (part.type === 'text' && typeof components?.Text === 'function') {
    return components.Text as React.ComponentType<{ text: string }>
  }
  return undefined
}

vi.mock('./hooks/useCodexIpcAssistantRuntime', () => {
  return {
    useCodexIpcAssistantRuntime: () => ({
      runtime: {},
      serverRequests: runtimeState.serverRequests,
      respondToServerRequest: runtimeState.respondToServerRequest,
      rejectServerRequest: runtimeState.rejectServerRequest,
      models: [
        {
          id: 'gpt-5-codex',
          name: 'GPT-5 Codex'
        },
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5'
        }
      ],
      selectedModelId: runtimeState.selectedModelId,
      activeConversation: undefined,
      startNewConversation: runtimeState.startNewConversation,
      openConversation: runtimeState.openConversation,
      setSelectedModelId: runtimeState.setSelectedModelId
    })
  }
})

vi.mock('./projects/useProjectState', () => ({
  useProjectState: () => projectHookState.controller
}))

vi.mock('@assistant-ui/react-lexical', () => ({
  LexicalComposerInput: ({ placeholder, directiveChip, className }: PrimitiveProps) => (
    <div
      className={className}
      data-has-directive-chip={String(Boolean(directiveChip))}
      data-placeholder={placeholder}
      data-testid="lexical-composer-input"
    />
  )
}))

vi.mock('@assistant-ui/react-streamdown', () => ({
  StreamdownTextPrimitive: (props: Record<string, unknown>) => {
    streamdownPropsState.lastProps = props
    return <div data-testid="streamdown-text" />
  }
}))

vi.mock('@streamdown/code', () => ({
  code: { plugin: 'code' }
}))

vi.mock('@streamdown/math', () => ({
  math: { plugin: 'math' }
}))

vi.mock('@streamdown/mermaid', () => ({
  mermaid: { plugin: 'mermaid' }
}))

vi.mock('@streamdown/cjk', () => ({
  cjk: { plugin: 'cjk' }
}))

vi.mock('@assistant-ui/react', () => {
  const assistantState = {
    composer: {
      dictation: null,
      isEmpty: true
    },
    message: {
      ...threadMessageState.message,
      isCopied: false
    },
    thread: {
      capabilities: {
        dictation: false
      },
      isLoading: false,
      isRunning: false,
      messages: []
    },
    threads: {
      isLoading: false,
      mainThreadId: 'main',
      threadItems: []
    }
  }

  const currentAssistantState = (): typeof assistantState => ({
    ...assistantState,
    message: {
      ...threadMessageState.message,
      isCopied: false
    }
  })

  const renderChildren = (children: PrimitiveProps['children']): ReactNode => {
    if (typeof children === 'function') return children({ message: { role: 'assistant' } })
    return children
  }

  const omitPrimitiveOnlyProps = (props: PrimitiveProps): Record<string, unknown> => {
    const elementProps = { ...props } as Record<string, unknown>
    delete elementProps.children
    delete elementProps.asChild
    return elementProps
  }

  const primitive = (name: string) => {
    return function Primitive(props: PrimitiveProps): React.JSX.Element {
      return createElement(
        'div',
        { 'data-primitive': name, ...omitPrimitiveOnlyProps(props) },
        renderChildren(props.children)
      )
    }
  }

  return {
    ActionBarPrimitive: {
      Copy: primitive('ActionBar.Copy'),
      Edit: primitive('ActionBar.Edit'),
      Reload: primitive('ActionBar.Reload'),
      Root: primitive('ActionBar.Root')
    },
    AssistantRuntimeProvider: primitive('AssistantRuntimeProvider'),
    AttachmentPrimitive: {
      Name: primitive('Attachment.Name'),
      Root: primitive('Attachment.Root'),
      unstable_Thumb: primitive('Attachment.Thumb')
    },
    AuiIf: ({ children, condition }: PrimitiveProps) => {
      const visible =
        typeof condition === 'function' ? condition(currentAssistantState()) : condition
      return visible ? <>{renderChildren(children)}</> : null
    },
    BranchPickerPrimitive: {
      Count: primitive('BranchPicker.Count'),
      Next: primitive('BranchPicker.Next'),
      Number: primitive('BranchPicker.Number'),
      Previous: primitive('BranchPicker.Previous'),
      Root: primitive('BranchPicker.Root')
    },
    ComposerPrimitive: {
      Cancel: primitive('Composer.Cancel'),
      Input: (props: PrimitiveProps) => (
        <textarea data-testid="plain-composer-input" {...omitPrimitiveOnlyProps(props)} />
      ),
      Root: primitive('Composer.Root'),
      Send: primitive('Composer.Send'),
      Unstable_TriggerPopover: Object.assign(
        ({ char, children }: PrimitiveProps) => (
          <div data-testid="composer-trigger-popover" data-trigger-char={char}>
            {renderChildren(children)}
          </div>
        ),
        {
          Action: () => null,
          Directive: () => null
        }
      ),
      Unstable_TriggerPopoverBack: primitive('Composer.TriggerPopoverBack'),
      Unstable_TriggerPopoverCategories: ({ children }: PrimitiveProps) => (
        <div data-primitive="Composer.TriggerPopoverCategories">
          {typeof children === 'function' ? children([]) : children}
        </div>
      ),
      Unstable_TriggerPopoverCategoryItem: primitive('Composer.TriggerPopoverCategoryItem'),
      Unstable_TriggerPopoverItem: primitive('Composer.TriggerPopoverItem'),
      Unstable_TriggerPopoverItems: ({ children }: PrimitiveProps) => (
        <div data-primitive="Composer.TriggerPopoverItems">
          {typeof children === 'function' ? children([]) : children}
        </div>
      ),
      Unstable_TriggerPopoverRoot: primitive('Composer.TriggerPopoverRoot')
    },
    MessagePrimitive: {
      Attachments: primitive('Message.Attachments'),
      Content: primitive('Message.Content'),
      Error: primitive('Message.Error'),
      Parts: ({ components }: PrimitiveProps) => {
        return (
          <div data-primitive="Message.Parts">
            {threadMessageState.message.content.map((part, index) => {
              const Component = messagePartComponentFor(part, components)
              return Component
                ? createElement(Component, {
                    ...part,
                    key: index
                  })
                : null
            })}
          </div>
        )
      },
      Quote: primitive('Message.Quote'),
      Root: primitive('Message.Root')
    },
    ThreadListItemPrimitive: {
      Archive: primitive('ThreadListItem.Archive'),
      Delete: primitive('ThreadListItem.Delete'),
      Root: primitive('ThreadListItem.Root'),
      Title: primitive('ThreadListItem.Title'),
      Trigger: primitive('ThreadListItem.Trigger')
    },
    ThreadListItemMorePrimitive: {
      Content: primitive('ThreadListItemMore.Content'),
      Item: primitive('ThreadListItemMore.Item'),
      Root: primitive('ThreadListItemMore.Root'),
      Trigger: primitive('ThreadListItemMore.Trigger')
    },
    ThreadListPrimitive: {
      Items: primitive('ThreadList.Items'),
      New: primitive('ThreadList.New'),
      Root: primitive('ThreadList.Root')
    },
    ThreadPrimitive: {
      Messages: ({ children }: PrimitiveProps) => (
        <div data-primitive="Thread.Messages">
          {typeof children === 'function' ? children(threadMessageState) : children}
        </div>
      ),
      Root: primitive('Thread.Root'),
      ScrollToBottom: primitive('Thread.ScrollToBottom'),
      Viewport: primitive('Thread.Viewport'),
      ViewportFooter: primitive('Thread.ViewportFooter')
    },
    unstable_defaultDirectiveFormatter: {
      parse: (text: string) => [{ kind: 'text', text }]
    },
    unstable_useMentionAdapter: (options: unknown) => {
      mentionAdapterState.calls.push(options)
      return { adapter: {}, directive: {} }
    },
    unstable_useSlashCommandAdapter: () => ({ action: { onExecute: vi.fn() }, adapter: {} }),
    useAui: () => ({
      composer: () => ({
        getState: () => ({ runConfig: undefined })
      }),
      modelContext: () => ({
        register: vi.fn(() => vi.fn())
      }),
      thread: () => ({
        append: vi.fn(),
        getState: () => ({ isRunning: false })
      })
    }),
    useMessageTiming: () => null,
    useAuiState: (
      selector: (
        state: typeof assistantState & {
          threadListItem: {
            id: string
            remoteId: string | undefined
            externalId: string | undefined
            title: string
            status: string
            custom: undefined
          }
        }
      ) => unknown
    ) =>
      selector({
        ...currentAssistantState(),
        threadListItem: {
          id: 'main',
          remoteId: undefined,
          externalId: undefined,
          title: 'Main Thread',
          status: 'regular',
          custom: undefined
        }
      })
  }
})

import App from './App'

describe('App composer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    resetThreadMessageState()
    installDesktopApp()
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('uses the Lexical composer input with mention and slash trigger popovers', () => {
    act(() => {
      root.render(<App />)
    })

    const lexicalInput = container.querySelector('[data-testid="lexical-composer-input"]')
    const triggerChars = Array.from(
      container.querySelectorAll('[data-testid="composer-trigger-popover"]')
    )
      .map((node) => node.getAttribute('data-trigger-char'))
      .sort()

    expect(lexicalInput).not.toBeNull()
    expect(lexicalInput?.getAttribute('data-has-directive-chip')).toBe('true')
    expect(lexicalInput?.getAttribute('data-placeholder')).toContain('@')
    expect(container.querySelector('[data-slot="aui_composer-shell"]')?.className).toContain(
      'bg-background'
    )
    expect(container.querySelector('[data-slot="aui_composer-shell"]')?.className).toContain(
      'dark:bg-muted/30'
    )
    expect(container.querySelector('[data-testid="plain-composer-input"]')).toBeNull()
    expect(triggerChars).toEqual(['/', '@'])
  })

  it('prefetches selected project files for composer mentions', async () => {
    const searchFiles = vi.fn(async () => ({
      results: [{ path: '/repo/src/App.tsx', label: 'src/App.tsx', root: '/repo' }]
    }))
    window.desktopApp.projects.createFuzzyFileSearchSession = searchFiles

    act(() => {
      root.render(<App />)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(searchFiles).toHaveBeenCalledWith({ query: '', limit: 40 })
    expect(
      mentionAdapterState.calls.some((call) => {
        const categories = (call as { categories?: Array<{ items?: Array<{ id?: string }> }> })
          .categories
        return categories?.some((category) =>
          category.items?.some((item) => item.id === '/repo/src/App.tsx')
        )
      })
    ).toBe(true)
  })

  it('shows model selection failures instead of silently swallowing them', async () => {
    runtimeState.setSelectedModelId.mockRejectedValue(new Error('model catalog unavailable'))

    act(() => {
      root.render(<App />)
    })

    await act(async () => {
      buttonWithText('GPT-5 Codex')?.click()
    })

    await act(async () => {
      modelSelectorItemWithText('GPT-5.5')?.click()
    })

    expect(runtimeState.setSelectedModelId).toHaveBeenCalledWith('gpt-5.5')
    expect(container.textContent).toContain('model catalog unavailable')
  })

  it('renders split sidebar sections without delete actions', () => {
    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('Projects')
    expect(container.textContent).toContain('Remote App')
    expect(container.textContent).toContain('Quick chats')
    expect(container.textContent).toContain('New chat')
    expect(container.textContent).not.toContain('Remote projects')
    expect(container.textContent).not.toContain('Pinned')
    expect(container.textContent).not.toContain('Delete')
  })

  it('starts a new runtime conversation from the sidebar New chat action', () => {
    act(() => {
      root.render(<App />)
    })

    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'New chat'
    )
    act(() => {
      newChat?.click()
    })

    expect(runtimeState.startNewConversation).toHaveBeenCalledOnce()
  })

  it('renders the sidebar with translucent glass styling', () => {
    act(() => {
      root.render(<App />)
    })

    const sidebar = container.querySelector('[data-slot="codex-sidebar"]')
    const mainSection = container.querySelector('[data-slot="app-main-section"]')
    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'New chat'
    )

    expect(sidebar?.className).toContain('bg-background/50')
    expect(sidebar?.className).toContain('backdrop-blur-xl')
    expect(mainSection?.className).toContain('bg-background/50')
    expect(mainSection?.className).toContain('backdrop-blur-xl')
    expect(sidebar?.className).not.toContain('border-r')
    expect(sidebar?.className).toContain(
      '[@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none'
    )
    expect(newChat?.className).toContain('hover:bg-background/40')
  })

  it('keeps the original opaque sidebar colors on Windows', () => {
    setDesktopPlatform('win32')

    act(() => {
      root.render(<App />)
    })

    const appShell = container.querySelector('main')
    const sidebar = container.querySelector('[data-slot="codex-sidebar"]')
    const mainSection = container.querySelector('[data-slot="app-main-section"]')
    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'New chat'
    )

    expect(appShell?.className).toContain('bg-muted/30')
    expect(sidebar?.className).not.toContain('bg-background/50')
    expect(sidebar?.className).not.toContain('backdrop-blur-xl')
    expect(mainSection?.className).not.toContain('bg-background/50')
    expect(mainSection?.className).not.toContain('backdrop-blur-xl')
    expect(newChat?.className).toContain('hover:bg-muted')
    expect(newChat?.className).not.toContain('hover:bg-background/40')
  })

  it('renders user messages with the assistant-ui base message structure', () => {
    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-primitive="Message.Attachments"]')).not.toBeNull()
    expect(container.querySelector('.aui-user-message-content-wrapper')).not.toBeNull()
    expect(container.querySelector('.aui-user-message-content')).not.toBeNull()
    expect(container.querySelector('[data-primitive="Message.Quote"]')).not.toBeNull()
    expect(container.querySelector('[data-primitive="Message.Parts"]')).not.toBeNull()
    expect(container.querySelector('.aui-user-action-bar-wrapper')).not.toBeNull()
    expect(container.querySelector('.aui-user-action-bar-root')).not.toBeNull()
  })

  it('renders the edit composer when a user message enters editing state', () => {
    threadMessageState.message.composer.isEditing = true

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="aui_edit-composer-wrapper"]')).not.toBeNull()
    expect(container.querySelector('.aui-edit-composer-root')).not.toBeNull()
    expect(container.querySelector('.aui-user-message-content-wrapper')).toBeNull()
  })

  it('adds shimmer styling to the pending assistant thinking message', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }

    act(() => {
      root.render(<App />)
    })

    const assistantContent = container.querySelector('[data-slot="aui_assistant-message-content"]')

    expect(assistantContent?.className).toContain('shimmer')
    expect(assistantContent?.className).toContain('text-foreground/60')
    expect(assistantContent?.className).toContain('motion-reduce:animate-none')
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).toBeNull()
  })

  it('renders assistant text with the streamdown markdown renderer', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.content = [{ type: 'text', text: '# 标题\n\n- 条目' }]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-testid="streamdown-text"]')).not.toBeNull()
    expect(streamdownPropsState.lastProps).toMatchObject({
      caret: 'block',
      defer: true,
      plugins: {
        code: { plugin: 'code' },
        math: { plugin: 'math' },
        mermaid: { plugin: 'mermaid' },
        cjk: { plugin: 'cjk' }
      }
    })
  })

  it('keeps the thinking placeholder while only reasoning streams', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [{ type: 'reasoning', text: '正在整理上下文' }]

    act(() => {
      root.render(<App />)
    })

    const assistantContent = container.querySelector('[data-slot="aui_assistant-message-content"]')
    const reasoning = container.querySelector('[data-slot="aui_reasoning-part"]')

    expect(assistantContent?.className).toContain('shimmer')
    expect(assistantContent?.textContent).toContain('正在思考')
    expect(reasoning).toBeNull()
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).toBeNull()
  })

  it('hides the thinking placeholder once assistant text is visible', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [{ type: 'text', text: '你好，有什么可以帮你？' }]

    act(() => {
      root.render(<App />)
    })

    const assistantContent = container.querySelector('[data-slot="aui_assistant-message-content"]')

    expect(assistantContent?.className).not.toContain('shimmer')
    expect(assistantContent?.textContent).not.toContain('正在思考')
    expect(container.querySelector('[data-testid="streamdown-text"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).not.toBeNull()
  })

  it('does not render reasoning summary parts after the assistant finishes', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [{ type: 'reasoning', text: '推理内容' }]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="aui_reasoning-part"]')).toBeNull()
    expect(container.textContent).not.toContain('推理摘要')
    expect(container.textContent).not.toContain('推理内容')
  })

  it('does not render the server request panel when there is no queued request', () => {
    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="server-request-panel"]')).toBeNull()
  })

  it('responds to a file-change request when approving', async () => {
    const request = fileChangeApprovalRequest('file-request-1')
    runtimeState.serverRequests = [request]

    act(() => {
      root.render(<App />)
    })

    const approve = buttonWithText('Approve')
    expect(approve).not.toBeUndefined()

    await act(async () => {
      approve?.click()
    })

    expect(runtimeState.respondToServerRequest).toHaveBeenCalledWith(request, {
      action: 'approve'
    })
  })

  it('shows approval project context', () => {
    const request = fileChangeApprovalRequest('file-request-context')
    runtimeState.serverRequests = [request]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('local')
    expect(container.textContent).toContain('/workspace')
    expect(container.textContent).toContain('thread_1')
    expect(container.textContent).toContain('turn_1')
  })

  it('responds to an MCP request when approving for the session', async () => {
    const request = mcpApprovalRequest('mcp-request-1')
    runtimeState.serverRequests = [request]

    act(() => {
      root.render(<App />)
    })

    const approveSession = buttonWithText('Approve session')
    expect(approveSession).not.toBeUndefined()

    await act(async () => {
      approveSession?.click()
    })

    expect(runtimeState.respondToServerRequest).toHaveBeenCalledWith(request, {
      action: 'approveForSession'
    })
  })

  it('responds to a tool user input request with form answers', async () => {
    const request = toolUserInputRequest('input-request-1')
    runtimeState.serverRequests = [request]

    act(() => {
      root.render(<App />)
    })

    await act(async () => {
      buttonWithText('Submit answers')?.click()
    })

    expect(runtimeState.respondToServerRequest).toHaveBeenCalledWith(request, {
      action: 'answer',
      answers: { confirmation: [''] }
    })
  })
})

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text
  )
}

function modelSelectorItemWithText(text: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="model-selector-item"]')
  ).find((item) => item.textContent?.includes(text))
}

function fileChangeApprovalRequest(requestId: string): CodexApprovalRequest {
  return {
    id: requestId,
    kind: 'file-change',
    createdAt: '2026-06-27T00:00:00.000Z',
    context: {
      threadId: 'thread_1',
      turnId: 'turn_1',
      hostId: 'local',
      cwd: '/workspace'
    },
    params: {
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'file_1',
      reason: 'modify src/App.tsx',
      grantRoot: '/workspace'
    }
  }
}

function mcpApprovalRequest(requestId: string): CodexApprovalRequest {
  return {
    id: requestId,
    kind: 'mcp-elicitation',
    createdAt: '2026-06-27T00:00:00.000Z',
    params: {
      server: 'github',
      tool: 'create_issue',
      prompt: 'Create issue?'
    }
  }
}

function toolUserInputRequest(requestId: string): CodexApprovalRequest {
  return {
    id: requestId,
    kind: 'tool-user-input',
    createdAt: '2026-06-27T00:00:00.000Z',
    params: {
      questions: [
        {
          id: 'confirmation',
          header: 'Confirm',
          question: 'Continue?',
          isSecret: false
        }
      ]
    }
  }
}
