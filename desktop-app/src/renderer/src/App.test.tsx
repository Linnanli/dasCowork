// @vitest-environment jsdom

import { act, createElement, type ElementType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import type { CodexApprovalRequest, DesktopProjectsApi } from '../../shared/codexIpcApi'
import type { ActiveConversationContext } from './lib/ElectronIpcChatTransport'

type MockPartStatus =
  | { type: 'complete' }
  | { type: 'running' }
  | { type: 'incomplete'; reason?: 'cancelled'; error?: string }
  | { type: 'error'; error?: string }
  | { type: 'requires-action'; reason: 'interrupt' }

type MockMessageStatus =
  | { type: 'complete' }
  | { type: 'running' }
  | { type: 'incomplete'; reason?: 'cancelled'; error?: string }
  | { type: 'error'; error?: string }

type MockMessagePart =
  | { type: 'reasoning' | 'text'; text: string; status?: MockPartStatus }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      argsText: string
      result?: unknown
      status?: MockPartStatus
    }
  | {
      type: 'dynamic-tool'
      toolCallId: string
      toolName: string
      state:
        | 'input-streaming'
        | 'input-available'
        | 'approval-requested'
        | 'approval-responded'
        | 'output-available'
        | 'output-error'
        | 'output-denied'
      input?: unknown
      output?: unknown
      preliminary?: boolean
      providerExecuted?: boolean
      status?: MockPartStatus
    }

type MockThreadMessageState = {
  message: {
    composer: {
      isEditing: boolean
    }
    content: MockMessagePart[]
    parts?: MockMessagePart[]
    role: 'assistant' | 'user'
    status: MockMessageStatus
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
  activeConversation: ActiveConversationContext | undefined
  rejectServerRequest: ReturnType<typeof vi.fn>
  respondToServerRequest: ReturnType<typeof vi.fn>
  serverRequests: CodexApprovalRequest[]
  selectedModelId: string | undefined
  setSelectedModelId: ReturnType<typeof vi.fn>
  startNewConversation: ReturnType<typeof vi.fn>
  openConversation: ReturnType<typeof vi.fn>
}>(() => ({
  activeConversation: undefined,
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
  delete threadMessageState.message.parts
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
  runtimeState.activeConversation = undefined
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
  part: MockMessagePart,
  components: Record<string, unknown> | undefined
): ElementType<Record<string, unknown>> | undefined {
  if (part.type === 'reasoning' && typeof components?.Reasoning === 'function') {
    return components.Reasoning as ElementType<Record<string, unknown>>
  }
  if (part.type === 'text' && typeof components?.Text === 'function') {
    return components.Text as ElementType<Record<string, unknown>>
  }
  if (part.type === 'tool-call' && isToolFallbackComponents(components)) {
    return components.tools.Fallback
  }
  return undefined
}

function isToolFallbackComponents(
  components: Record<string, unknown> | undefined
): components is { tools: { Fallback: ElementType<Record<string, unknown>> } } {
  const tools = components?.tools as { Fallback?: unknown } | undefined
  return Boolean(tools && typeof tools === 'object' && tools.Fallback)
}

function currentMessageParts(): MockMessagePart[] {
  if (threadMessageState.message.parts) return threadMessageState.message.parts

  const lastIndex = Math.max(0, threadMessageState.message.content.length - 1)

  return threadMessageState.message.content.map((part, index) => {
    if (part.status) return part

    if (threadMessageState.message.role !== 'assistant') {
      return { ...part, status: { type: 'complete' as const } }
    }

    if (part.type === 'tool-call') {
      return {
        ...part,
        status: part.result ? { type: 'complete' as const } : threadMessageState.message.status
      }
    }

    const isLastPart = index === lastIndex
    return {
      ...part,
      status: isLastPart ? threadMessageState.message.status : { type: 'complete' as const }
    }
  })
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
      activeConversation: runtimeState.activeConversation,
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

vi.mock('streamdown', () => ({
  Streamdown: (props: Record<string, unknown>) => {
    streamdownPropsState.lastProps = props
    return <div data-testid="streamdown-text">{props.children as ReactNode}</div>
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
      parts: currentMessageParts(),
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
      parts: currentMessageParts(),
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
    ErrorPrimitive: {
      Message: primitive('Error.Message'),
      Root: primitive('Error.Root')
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
      GroupedParts: ({
        children: render
      }: {
        groupBy?: unknown
        children: (info: { part: unknown; children: ReactNode }) => ReactNode
      }) => {
        const parts = currentMessageParts()
        const result: ReactNode[] = []

        let i = 0
        while (i < parts.length) {
          const part = parts[i]
          const isToolCall = part.type === 'tool-call'

          if (isToolCall) {
            const groupIndices: number[] = []
            const groupChildren: ReactNode[] = []

            while (i < parts.length && parts[i].type === 'tool-call') {
              const enrichedPart = {
                ...parts[i],
                toolUI: null,
                addResult: () => {},
                resume: () => {},
                respondToApproval: () => {}
              }
              groupIndices.push(i)
              groupChildren.push(
                <div key={`tool-${i}`}>{render({ part: enrichedPart, children: null })}</div>
              )
              i++
            }

            result.push(
              <div key={`group-${groupIndices[0]}`}>
                {render({
                  part: { type: 'group-tool', indices: groupIndices },
                  children: groupChildren
                })}
              </div>
            )
          } else {
            result.push(<div key={`part-${i}`}>{render({ part, children: null })}</div>)
            i++
          }
        }

        return <div data-primitive="Message.GroupedParts">{result}</div>
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
    groupPartByType: () => () => undefined,
    useScrollLock: () => vi.fn(),
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
    expect(container.textContent).toContain('新对话')
    expect(container.textContent).not.toContain('Remote projects')
    expect(container.textContent).not.toContain('Pinned')
    expect(container.textContent).not.toContain('Delete')
  })

  it('starts a new runtime conversation from the sidebar new conversation action', () => {
    act(() => {
      root.render(<App />)
    })

    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '新对话'
    )
    act(() => {
      newChat?.click()
    })

    expect(runtimeState.startNewConversation).toHaveBeenCalledOnce()
  })

  it('shows active conversation title in the header without workspace path', () => {
    runtimeState.activeConversation = {
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      title: 'Feature thread',
      cwd: '/Users/test/repo'
    }

    act(() => {
      root.render(<App />)
    })

    const header = container.querySelector('header')

    expect(header?.textContent).toContain('Feature thread')
    expect(header?.innerHTML).not.toContain('/Users/test/repo')
  })

  it('renders the sidebar with translucent glass styling', () => {
    act(() => {
      root.render(<App />)
    })

    const sidebar = container.querySelector('[data-slot="codex-sidebar"]')
    const mainSection = container.querySelector('[data-slot="app-main-section"]')
    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '新对话'
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
      (button) => button.textContent?.trim() === '新对话'
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
      mode: 'streaming',
      plugins: {
        code: { plugin: 'code' },
        math: { plugin: 'math' },
        mermaid: { plugin: 'mermaid' },
        cjk: { plugin: 'cjk' }
      }
    })
    expect(streamdownPropsState.lastProps?.children).toBe('# 标题\n\n- 条目')
  })

  it('renders semantic labels for single assistant tool parts', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({
          command: "sed -n '1,20p' file.ts",
          cwd: '/repo',
          commandActions: [
            {
              type: 'read',
              command: "sed -n '1,20p' file.ts",
              name: 'sed',
              path: '/repo/file.ts'
            }
          ]
        }),
        status: { type: 'complete' },
        result: {
          item: {
            id: 'read-1',
            type: 'commandExecution',
            command: "sed -n '1,20p' file.ts",
            cwd: '/repo',
            processId: null,
            source: { type: 'exec' },
            status: 'completed',
            commandActions: [
              {
                type: 'read',
                command: "sed -n '1,20p' file.ts",
                name: 'sed',
                path: '/repo/file.ts'
              }
            ],
            aggregatedOutput: '',
            exitCode: 0,
            durationMs: 1
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('已读取 1 个文件')
    expect(container.textContent).not.toContain('Used tool')
    expect(container.textContent).not.toContain('codex_command_execution')
  })

  it('renders semantic icons for single assistant tool summaries', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'search-1',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({
          command: 'rg needle',
          cwd: '/repo',
          commandActions: [
            { type: 'search', command: 'rg needle', query: 'needle', path: null },
            { type: 'search', command: 'rg other', query: 'other', path: null }
          ]
        }),
        status: { type: 'complete' },
        result: {
          item: {
            id: 'search-1',
            type: 'commandExecution',
            command: 'rg needle',
            cwd: '/repo',
            processId: null,
            source: { type: 'exec' },
            status: 'completed',
            commandActions: [
              { type: 'search', command: 'rg needle', query: 'needle', path: null },
              { type: 'search', command: 'rg other', query: 'other', path: null }
            ],
            aggregatedOutput: '',
            exitCode: 0,
            durationMs: 1
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('已搜索 2 次代码')
    expect(container.querySelector('[data-slot="tool-fallback-trigger-icon"]')).not.toBeNull()
  })

  it('summarizes grouped assistant tool parts with Codex actions', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = Array.from({ length: 3 }, (_, index) => ({
      type: 'tool-call' as const,
      toolCallId: `read-${index}`,
      toolName: 'codex_command_execution',
      argsText: JSON.stringify({ command: `sed -n '${index + 1}p' file.ts`, cwd: '/repo' }),
      result: {
        item: {
          id: `read-${index}`,
          type: 'commandExecution',
          command: `sed -n '${index + 1}p' file.ts`,
          cwd: '/repo',
          processId: null,
          source: { type: 'exec' },
          status: 'completed',
          commandActions: [
            {
              type: 'read',
              command: `sed -n '${index + 1}p' file.ts`,
              name: 'sed',
              path: `/repo/file-${index}.ts`
            }
          ],
          aggregatedOutput: '',
          exitCode: 0,
          durationMs: 1
        }
      }
    }))

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('已读取 3 个文件')
    expect(container.textContent).not.toContain('3 tool calls')
    expect(container.querySelector('[data-slot="tool-group-trigger-icon"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="collapsed-tool-activity-unit"]')).not.toBeNull()
  })

  it('uses dedicated renderers for web dynamic MCP and multi-agent groups', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('web-1', 'codex_web_search', 'webSearch'),
      genericToolPart('web-2', 'codex_web_search', 'webSearch'),
      { type: 'text', text: '继续处理' },
      genericToolPart('dyn-1', 'dynamicToolCall', 'dynamicToolCall', {
        completedSummaryKey: 'dyn:search',
        registryMetadata: { completedSummaryKey: 'dyn:search' }
      }),
      genericToolPart('dyn-2', 'dynamicToolCall', 'dynamicToolCall', {
        completedSummaryKey: 'dyn:search',
        registryMetadata: { completedSummaryKey: 'dyn:search' }
      }),
      genericToolPart('mcp-1', 'mcp:github/read', 'mcpToolCall', {
        server: 'github',
        tool: 'read'
      }),
      genericToolPart('mcp-2', 'mcp:github/write', 'mcpToolCall', {
        server: 'github',
        tool: 'write'
      }),
      genericToolPart('mcp-node', 'mcp:node_repl/js', 'mcpToolCall', {
        server: 'node_repl',
        tool: 'js'
      }),
      genericToolPart('mcp-browser', 'mcp:browser/open', 'mcpToolCall', {
        server: 'browser',
        tool: 'open'
      }),
      genericToolPart('agent-1', 'codex_collab_agent', 'collabAgentToolCall', {
        action: 'review'
      }),
      genericToolPart('agent-2', 'codex_collab_agent', 'collabAgentToolCall', {
        action: 'review'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="web-search-group-unit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="dynamic-tool-call-group-unit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="pending-mcp-tool-calls-unit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="multi-agent-group-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('已调用 github 2 次')
    expect(container.textContent).toContain('已运行 Node REPL')
    expect(container.textContent).toContain('已使用 Browser')
    expect(container.textContent).toContain('已运行 2 个 review 协作任务')
  })

  it('summarizes grouped running tool parts from derived assistant-ui part state', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      { type: 'text', text: '先查一下' },
      ...Array.from({ length: 2 }, (_, index) => ({
        type: 'tool-call' as const,
        toolCallId: `search-${index}`,
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({
          command: `rg needle-${index}`,
          cwd: '/repo',
          commandActions: [
            {
              type: 'search',
              command: `rg needle-${index}`,
              query: `needle-${index}`,
              path: null
            }
          ]
        })
      }))
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('正在搜索 2 次代码')
    expect(container.textContent).not.toContain('已搜索 2 次代码')
  })

  it('renders preliminary dynamic-tool outputs as running activity', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = []
    threadMessageState.message.parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'sleep-running',
        toolName: 'codex_sleep',
        state: 'output-available',
        preliminary: true,
        providerExecuted: true,
        input: { durationMs: 1000 },
        output: { item: { id: 'sleep-running', type: 'sleep', durationMs: 1000 } }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('正在等待 1 次')
    expect(container.textContent).not.toContain('已等待 1 次')
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

  it('shows thinking inside the latest completed tool activity while waiting for text', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      commandToolPart('read-1', 'read', { status: { type: 'complete' } }),
      {
        type: 'tool-call',
        toolCallId: 'file-1',
        toolName: 'codex_file_change',
        argsText: JSON.stringify({ changes: [] }),
        status: { type: 'complete' },
        result: {
          item: {
            id: 'file-1',
            type: 'fileChange',
            status: 'completed',
            changes: [{ path: '/repo/edit.ts', kind: { type: 'update' }, diff: '' }]
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('正在思考')
    expect(
      container.querySelector('[data-slot="aui_assistant-message-content"]')?.className
    ).not.toContain('shimmer')
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).not.toBeNull()
  })

  it('only lets the latest eligible tool group own thinking fallback', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      commandToolPart('read-1', 'read', { status: { type: 'complete' } }),
      { type: 'text', text: '先查到一部分' },
      commandToolPart('search-1', 'search', { status: { type: 'complete' } })
    ]

    act(() => {
      root.render(<App />)
    })

    const thinkingTriggers = Array.from(
      container.querySelectorAll('[data-slot="tool-fallback-trigger-label"]')
    ).filter((trigger) => trigger.textContent?.includes('正在思考'))

    expect(thinkingTriggers).toHaveLength(1)
    expect(container.textContent).toContain('先查到一部分')
  })

  it('shows active latest tool summary instead of generic thinking', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      commandToolPart('search-1', 'search', { status: { type: 'running' } }),
      commandToolPart('search-2', 'search', { status: { type: 'running' } })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('正在搜索 2 次代码')
    expect(container.textContent).not.toContain('正在思考')
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

  it.each([
    ['finished', { type: 'complete' } satisfies MockMessageStatus],
    ['cancelled', { type: 'incomplete', reason: 'cancelled' } satisfies MockMessageStatus],
    ['errored', { type: 'error', error: 'boom' } satisfies MockMessageStatus]
  ])('does not show thinking for %s assistant messages', (_label, status) => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = status
    threadMessageState.message.content = [
      commandToolPart('read-finished', 'read', { status: { type: 'complete' } }),
      commandToolPart('search-finished', 'search', { status: { type: 'complete' } })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).not.toContain('正在思考')
    expect(
      container.querySelector('[data-slot="aui_assistant-message-content"]')?.className
    ).not.toContain('shimmer')
  })

  it('renders completed reasoning parts as renderable entry text', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      { type: 'reasoning', text: '推理内容', status: { type: 'complete' } }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="aui_reasoning-part"]')).toBeNull()
    expect(container.textContent).toContain('推理内容')
    expect(container.querySelector('[data-slot="entry-unit"]')).toBeNull()
  })

  it('does not show thinking for a finished empty assistant message', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = []

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).not.toContain('正在思考')
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).not.toBeNull()
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

function commandToolPart(
  id: string,
  actionType: string,
  options: { status: MockPartStatus }
): MockMessagePart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: 'codex_command_execution',
    argsText: JSON.stringify({
      command: `${actionType} ${id}`,
      cwd: '/repo',
      commandActions: [{ type: actionType, command: `${actionType} ${id}`, path: `/repo/${id}.ts` }]
    }),
    status: options.status,
    result: {
      item: {
        id,
        type: 'commandExecution',
        command: `${actionType} ${id}`,
        cwd: '/repo',
        processId: null,
        source: { type: 'exec' },
        status: options.status.type === 'running' ? 'inProgress' : 'completed',
        commandActions: [
          { type: actionType, command: `${actionType} ${id}`, name: id, path: `/repo/${id}.ts` }
        ],
        aggregatedOutput: '',
        exitCode: 0,
        durationMs: 1
      }
    }
  }
}

function genericToolPart(
  id: string,
  toolName: string,
  itemType: string,
  itemOverrides: Record<string, unknown> = {}
): MockMessagePart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName,
    argsText: JSON.stringify({ id }),
    status: { type: 'complete' },
    result: {
      item: {
        id,
        type: itemType,
        status: 'completed',
        ...itemOverrides
      }
    }
  }
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
