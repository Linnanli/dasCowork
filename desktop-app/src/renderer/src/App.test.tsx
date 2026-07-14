// @vitest-environment jsdom

import { act, createElement, type ElementType, type ReactNode, useState } from 'react'
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
      isError?: boolean
      providerMetadata?: unknown
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
  | {
      type: 'file'
      mediaType: string
      data?: string
      url?: string
      name?: string
      providerMetadata?: unknown
      status?: MockPartStatus
    }

type MockExternalMessage = {
  parts: { type: 'reasoning' | 'text'; providerMetadata?: unknown }[]
  metadata?: { codexTurnDurationMs?: number }
}

type MockThreadMessageState = {
  message: {
    composer: {
      isEditing: boolean
    }
    content: MockMessagePart[]
    parts?: MockMessagePart[]
    metadata?: {
      timing?: {
        totalStreamTime?: number
      }
    }
    role: 'assistant' | 'user'
    status: MockMessageStatus
  }
  externalMessages: MockExternalMessage[]
}

const threadMessageState = vi.hoisted<MockThreadMessageState>(() => ({
  message: {
    composer: {
      isEditing: false
    },
    content: [{ type: 'text', text: '正在思考' }],
    role: 'user',
    status: { type: 'complete' }
  },
  externalMessages: []
}))

const streamdownPropsState = vi.hoisted<{
  lastProps: Record<string, unknown> | null
}>(() => ({
  lastProps: null
}))

const runtimeState = vi.hoisted<{
  activeEntry: {
    localId: string
    newConversation: boolean
    context: ActiveConversationContext
    phase: 'loading' | 'ready' | 'streaming' | 'error'
    error?: Error
    unread: boolean
    draft: string
    loaded: boolean
    chat: object
    transport: object
    scroll?: { scrollTop: number; followBottom: boolean }
  }
  activeConversation: ActiveConversationContext | undefined
  rejectServerRequest: ReturnType<typeof vi.fn>
  respondToServerRequest: ReturnType<typeof vi.fn>
  serverRequests: CodexApprovalRequest[]
  selectedModelId: string | undefined
  modelSelectionError: string | undefined
  setSelectedModelId: ReturnType<typeof vi.fn>
  startNewConversation: ReturnType<typeof vi.fn>
  openConversation: ReturnType<typeof vi.fn>
  setActiveDraft: ReturnType<typeof vi.fn>
  setActiveScroll: ReturnType<typeof vi.fn>
}>(() => ({
  activeEntry: {
    localId: 'local-test',
    newConversation: true,
    context: { conversationId: 'local-test' },
    phase: 'ready',
    unread: false,
    draft: '',
    loaded: true,
    chat: {},
    transport: {}
  },
  activeConversation: undefined,
  rejectServerRequest: vi.fn(),
  respondToServerRequest: vi.fn(),
  serverRequests: [],
  selectedModelId: 'gpt-5-codex',
  modelSelectionError: undefined,
  setSelectedModelId: vi.fn(),
  startNewConversation: vi.fn(),
  openConversation: vi.fn(),
  setActiveDraft: vi.fn(),
  setActiveScroll: vi.fn()
}))

const mentionAdapterState = vi.hoisted<{
  calls: unknown[]
}>(() => ({
  calls: []
}))

const aiSdkRuntimeState = vi.hoisted<{
  options?: { isDisabled?: boolean }
}>(() => ({}))

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
  delete threadMessageState.message.metadata
  threadMessageState.message.role = 'user'
  threadMessageState.message.status = { type: 'complete' }
  threadMessageState.externalMessages = []
  streamdownPropsState.lastProps = null
  runtimeState.rejectServerRequest.mockReset()
  runtimeState.rejectServerRequest.mockResolvedValue(undefined)
  runtimeState.respondToServerRequest.mockReset()
  runtimeState.respondToServerRequest.mockResolvedValue(undefined)
  runtimeState.selectedModelId = 'gpt-5-codex'
  runtimeState.modelSelectionError = undefined
  runtimeState.setSelectedModelId.mockReset()
  runtimeState.setSelectedModelId.mockResolvedValue(undefined)
  runtimeState.startNewConversation.mockReset()
  runtimeState.openConversation.mockReset()
  runtimeState.openConversation.mockResolvedValue(undefined)
  runtimeState.activeConversation = undefined
  runtimeState.activeEntry.newConversation = true
  runtimeState.activeEntry.context = { conversationId: 'local-test' }
  runtimeState.activeEntry.phase = 'ready'
  delete runtimeState.activeEntry.error
  runtimeState.activeEntry.loaded = true
  runtimeState.activeEntry.draft = ''
  delete runtimeState.activeEntry.scroll
  runtimeState.serverRequests = []
  mentionAdapterState.calls = []
  aiSdkRuntimeState.options = undefined
}

function setDesktopPlatform(platform: NodeJS.Platform): void {
  window.desktopApp = {
    ...window.desktopApp,
    environment: { platform }
  }
}

function installDesktopApp(projects?: Partial<DesktopProjectsApi>): void {
  vi.stubGlobal('desktopApp', {
    environment: { platform: 'darwin' },
    codex: {
      openExternalHttpUrl: vi.fn(async () => undefined),
      openLocalPath: vi.fn(async () => undefined),
      pickLocalContext: vi.fn(async () => [])
    },
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
      activeEntry: runtimeState.activeEntry,
      serverRequests: runtimeState.serverRequests,
      activeServerRequests: runtimeState.serverRequests,
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
      modelSelectionError: runtimeState.modelSelectionError,
      activeConversation: runtimeState.activeConversation,
      startNewConversation: runtimeState.startNewConversation,
      openConversation: runtimeState.openConversation,
      setSelectedModelId: runtimeState.setSelectedModelId,
      setActiveDraft: runtimeState.setActiveDraft,
      setActiveScroll: runtimeState.setActiveScroll,
      syncConversationMetadata: vi.fn(),
      getConversationIndicator: (conversation: { running?: boolean; unread?: boolean }) => ({
        active: false,
        attention: false,
        running: Boolean(conversation.running),
        unread: Boolean(conversation.unread)
      }),
      getConversationTitle: () => undefined
    })
  }
})

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({})
}))

vi.mock('@assistant-ui/react-ai-sdk', () => ({
  useAISDKRuntime: (_chat: unknown, options?: { isDisabled?: boolean }) => {
    aiSdkRuntimeState.options = options
    return {}
  }
}))

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

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarFallback: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AvatarImage: ({ onError, ...props }: React.ComponentProps<'img'>) => {
    const [failed, setFailed] = useState(false)
    if (failed) return null

    return (
      <img
        {...props}
        onError={(event) => {
          setFailed(true)
          onError?.(event)
        }}
      />
    )
  }
}))

vi.mock('@assistant-ui/react', () => {
  const assistantState = {
    composer: {
      attachments: [],
      dictation: null,
      isEmpty: true,
      text: ''
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
    getExternalStoreMessages: () => threadMessageState.externalMessages,
    AttachmentPrimitive: {
      Name: primitive('Attachment.Name'),
      Remove: primitive('Attachment.Remove'),
      Root: primitive('Attachment.Root'),
      unstable_Thumb: primitive('Attachment.Thumb')
    },
    AuiIf: ({ children, condition }: PrimitiveProps) => {
      const visible =
        typeof condition === 'function' ? condition(currentAssistantState()) : condition
      return visible ? <>{renderChildren(children)}</> : null
    },
    ComposerPrimitive: {
      AddAttachment: primitive('Composer.AddAttachment'),
      Attachments: ({ children }: PrimitiveProps) => (
        <div data-primitive="Composer.Attachments">
          {typeof children === 'function' ? [] : children}
        </div>
      ),
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
      Attachments: ({ children }: PrimitiveProps) => {
        const attachments =
          threadMessageState.message.role === 'user'
            ? threadMessageState.message.content
                .filter(
                  (part): part is Extract<MockMessagePart, { type: 'file' }> => part.type === 'file'
                )
                .map((part) => ({
                  type: part.mediaType.startsWith('image/') ? 'image' : 'file',
                  name: part.name ?? 'file',
                  content: part.mediaType.startsWith('image/')
                    ? [{ type: 'image' as const, image: part.url ?? part.data ?? '' }]
                    : []
                }))
            : []

        return (
          <div data-primitive="Message.Attachments">
            {typeof children === 'function'
              ? attachments.map((attachment, index) => (
                  <div key={index}>{children({ attachment })}</div>
                ))
              : children}
          </div>
        )
      },
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
    useAuiEvent: () => undefined,
    useAui: () => ({
      attachment: {
        source: 'message'
      },
      on: () => vi.fn(),
      composer: () => ({
        getState: () => ({ runConfig: undefined }),
        setText: vi.fn()
      }),
      modelContext: () => ({
        register: vi.fn(() => vi.fn())
      }),
      thread: () => ({
        append: vi.fn(),
        getModelContext: () => ({}),
        getState: () => ({ isRunning: false })
      })
    }),
    useMessageTiming: () => null,
    useAuiState: (selector: (state: Record<string, unknown>) => unknown) => {
      const attachment = threadMessageState.message.content
        .filter((part): part is Extract<MockMessagePart, { type: 'file' }> => part.type === 'file')
        .map((part) => ({
          type: part.mediaType.startsWith('image/') ? 'image' : 'file',
          name: part.name ?? 'file',
          status: { type: 'complete' as const },
          content: part.mediaType.startsWith('image/')
            ? [{ type: 'image' as const, image: part.url ?? part.data ?? '' }]
            : []
        }))[0]

      return selector({
        ...currentAssistantState(),
        attachment,
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
    window.HTMLElement.prototype.focus = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
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

    expect(searchFiles).toHaveBeenCalledWith({
      query: '',
      limit: 40,
      projectSelection: { projectKind: 'path', path: '/repo' }
    })
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
    runtimeState.modelSelectionError = 'model catalog unavailable'

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

  it('uses the active conversation project for the composer context', async () => {
    const searchFiles = vi.fn(async () => ({ results: [] }))
    window.desktopApp.projects.createFuzzyFileSearchSession = searchFiles
    runtimeState.activeConversation = {
      conversationId: 'conversation-remote',
      threadId: 'thread-remote',
      title: 'Remote feature',
      projectSelection: { projectKind: 'remote', projectId: 'remote', hostId: 'ssh-dev' },
      cwd: '/srv/app'
    }

    act(() => {
      root.render(<App />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Working in: Remote App')
    expect(searchFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSelection: { projectKind: 'remote', projectId: 'remote', hostId: 'ssh-dev' }
      })
    )
  })

  it('opens the add-context menu in a projectless conversation', async () => {
    runtimeState.activeConversation = {
      conversationId: 'conversation-projectless',
      threadId: 'thread-projectless',
      title: 'Quick chat',
      projectSelection: { projectKind: 'projectless' },
      cwd: '/tmp/projectless'
    }

    act(() => {
      root.render(<App />)
    })

    const addContextButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加文件和更多"]'
    )
    expect(addContextButton?.disabled).toBe(false)

    await act(async () => {
      addContextButton?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('选择文件文件夹')
  })

  it('opens the add-context menu before a project is selected', async () => {
    runtimeState.activeConversation = {
      conversationId: 'conversation-without-project'
    }

    act(() => {
      root.render(<App />)
    })

    const addContextButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加文件和更多"]'
    )
    expect(addContextButton?.disabled).toBe(false)

    await act(async () => {
      addContextButton?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('选择文件文件夹')
  })

  it('keeps the add-context menu available while a new conversation awaits project selection', async () => {
    runtimeState.activeEntry.loaded = false
    runtimeState.activeConversation = {
      conversationId: 'conversation-awaiting-project'
    }

    act(() => {
      root.render(<App />)
    })

    const addContextButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加文件和更多"]'
    )
    expect(addContextButton?.disabled).toBe(false)

    await act(async () => {
      addContextButton?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('选择文件文件夹')
  })

  it('does not reuse the global project when a conversation workspace is unknown', async () => {
    const searchFiles = vi.fn(async () => ({ results: [] }))
    window.desktopApp.projects.createFuzzyFileSearchSession = searchFiles
    runtimeState.activeConversation = {
      conversationId: 'conversation-unassigned',
      threadId: 'thread-unassigned',
      title: 'Unassigned feature',
      cwd: '/srv/unassigned'
    }

    act(() => {
      root.render(<App />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Working in: unassigned')
    expect(searchFiles).not.toHaveBeenCalled()
  })

  it('keeps sidebar navigation available while a response is streaming', () => {
    runtimeState.activeEntry.phase = 'streaming'

    act(() => {
      root.render(<App />)
    })

    const sidebar = container.querySelector('[data-slot="codex-sidebar"]')
    expect(sidebar?.hasAttribute('inert')).toBe(false)
    expect(sidebar?.hasAttribute('aria-disabled')).toBe(false)
  })

  it('keeps the composer disabled until an existing conversation loads successfully', () => {
    runtimeState.activeEntry.loaded = false
    runtimeState.activeConversation = {
      conversationId: 'thread-loading',
      title: 'Loading thread'
    }

    act(() => {
      root.render(<App />)
    })

    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '发送消息'
    )
    expect(sendButton?.disabled).toBe(true)
    expect(aiSdkRuntimeState.options?.isDisabled).toBe(true)
  })

  it('does not render new-conversation entry points while existing history loads', () => {
    runtimeState.activeEntry.loaded = false
    runtimeState.activeEntry.newConversation = false
    runtimeState.activeEntry.phase = 'loading'
    runtimeState.activeConversation = {
      conversationId: 'thread-loading',
      title: 'Loading thread'
    }

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="project-gate"]')).toBeNull()
    expect(container.textContent).not.toContain('How can I help you today?')
  })

  it('shows a retry action when existing conversation history fails to load', async () => {
    runtimeState.activeEntry.loaded = false
    runtimeState.activeEntry.phase = 'error'
    runtimeState.activeEntry.error = new Error('history unavailable')
    runtimeState.activeConversation = {
      conversationId: 'thread-broken',
      title: 'Broken thread'
    }

    act(() => {
      root.render(<App />)
    })

    const alert = container.querySelector('[data-slot="conversation-load-error"]')
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '重试'
    )

    expect(alert?.textContent).toContain('history unavailable')

    await act(async () => {
      retryButton?.click()
      await Promise.resolve()
    })

    expect(runtimeState.openConversation).toHaveBeenCalledWith({ conversationId: 'local-test' })
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

  it('renders user image attachments with the assistant-ui attachment component', () => {
    threadMessageState.message.content = [
      { type: 'text', text: '按这个图像风格调整组件样式' },
      {
        type: 'file',
        mediaType: 'image/*',
        name: 'codex-clipboard.png',
        url: 'app://fs/@fs/tmp/codex-clipboard.png'
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const preview = container.querySelector<HTMLImageElement>('.aui-attachment-tile-image')
    const tile = container.querySelector<HTMLDivElement>('.aui-attachment-tile')

    expect(preview?.getAttribute('src')).toBe('app://fs/@fs/tmp/codex-clipboard.png')
    expect(preview?.getAttribute('alt')).toBe('Attachment preview')
    expect(tile?.className).toContain('size-14')
    expect(tile?.className).toContain('rounded-md')
    expect(container.querySelector('.aui-attachment-root')?.className).not.toContain('size-24')

    act(() => {
      preview?.dispatchEvent(new Event('error'))
    })

    expect(container.querySelector('.aui-attachment-tile-image')).toBeNull()
    expect(container.querySelector('.aui-attachment-tile-fallback-icon')).not.toBeNull()
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

  it('keeps the assistant message footer height stable when actions appear', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [{ type: 'text', text: '完成了' }]

    act(() => {
      root.render(<App />)
    })

    const assistantFooter = container.querySelector('[data-slot="aui_assistant-message-footer"]')

    expect(assistantFooter?.className).toContain('mt-1.5')
    expect(assistantFooter?.className).toContain('h-8')
    expect(assistantFooter?.className).toContain('-mb-8')
    expect(assistantFooter?.className).not.toContain('min-h-7.5')
    expect(assistantFooter?.className).not.toContain('pt-1.5')
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

  it('renders semantic exploration labels for single assistant read tool parts', () => {
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

    expect(container.textContent).toContain('已探索')
    expect(container.textContent).toContain('1 个文件')
    expect(container.textContent).not.toContain('Used tool')
    expect(container.textContent).not.toContain('codex_command_execution')
  })

  it('renders semantic exploration cards for assistant search summaries', () => {
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

    expect(container.textContent).toContain('已探索')
    expect(container.textContent).toContain('2 次搜索')
    expect(explorationToolGroup()).not.toBeNull()
  })

  it('summarizes grouped assistant exploration tool parts with Codex actions', () => {
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

    expect(container.textContent).toContain('已探索')
    expect(container.textContent).toContain('3 个文件')
    expect(container.textContent).not.toContain('3 tool calls')
    expect(explorationToolGroup()).not.toBeNull()
    expect(container.querySelector('[data-tool-group-kind="generic"]')).toBeNull()
  })

  it('renders ordinary command tool fallback as formatted shell output', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'cmd-test',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({ command: 'npm test', cwd: '/repo' }),
        status: { type: 'complete' },
        result: {
          item: {
            id: 'cmd-test',
            type: 'commandExecution',
            command: 'npm test',
            cwd: '/repo',
            processId: null,
            source: { type: 'exec' },
            status: 'completed',
            commandActions: [{ type: 'unknown', command: 'npm test' }],
            aggregatedOutput: 'PASS src/App.test.tsx\n',
            exitCode: 0,
            durationMs: 1250
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('command')
    expect(group?.dataset.state).toBe('closed')
    expect(container.textContent).toContain('已运行 1 条命令')
    expect(container.textContent).not.toContain('codex_command_execution')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(container.textContent).toContain('已运行：npm test')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    const shell = container.querySelector('[data-slot="tool-fallback-shell"]')
    expect(shell).not.toBeNull()
    expect(shell?.textContent).toContain('$ npm test')
    expect(shell?.textContent).toContain('PASS src/App.test.tsx')
    expect(shell?.textContent).toContain('cwd: /repo')
    expect(shell?.textContent).toContain('exit 0')
    expect(shell?.textContent).toContain('1.3s')
    expect(shell?.textContent).not.toContain('aggregatedOutput')
  })

  it('keeps active command details on the item instead of repeating them in group details', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'cmd-running',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({ command: 'npm test -- --watch=false', cwd: '/repo' }),
        status: { type: 'running' },
        result: {
          item: {
            id: 'cmd-running',
            type: 'commandExecution',
            command: 'npm test -- --watch=false',
            cwd: '/repo',
            processId: null,
            source: { type: 'exec' },
            status: 'inProgress',
            commandActions: [{ type: 'unknown', command: 'npm test -- --watch=false' }],
            aggregatedOutput: 'running tests\n',
            exitCode: undefined,
            durationMs: 250
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('command')
    expect(group?.textContent).toContain('正在运行：npm test -- --watch=false')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    const groupDetails = group?.querySelector('[data-slot="collapsed-activity-details"]')
    expect(groupDetails?.textContent).toContain('来源：exec')
    expect(groupDetails?.textContent).not.toContain('正在运行：npm test -- --watch=false')
    expect(groupDetails?.textContent).not.toContain('Command: npm test -- --watch=false')
    expect(group?.textContent).toContain('正在运行：npm test -- --watch=false')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    const shell = container.querySelector('[data-slot="tool-fallback-shell"]')
    expect(shell?.textContent).toContain('$ npm test -- --watch=false')
    expect(shell?.textContent).toContain('running tests')
    expect(shell?.textContent).toContain('cwd: /repo')
    expect(shell?.textContent).toContain('250ms')
  })

  it('shows fallback item attention statuses in the visible group label', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'cmd-approval',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({ command: 'npm test -- --inspect', cwd: '/repo' }),
        status: { type: 'requires-action', reason: 'interrupt' }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(toolGroup('command')?.textContent).toContain('等待审批：npm test -- --inspect')

    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'patch-stopped',
        toolName: 'codex_file_change',
        argsText: '',
        result: {
          item: {
            id: 'patch-stopped',
            type: 'fileChange',
            status: 'stopped',
            changes: [{ path: 'src/new.ts', kind: { type: 'add' }, diff: '+new\n' }]
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(toolGroup('file-change')?.textContent).toContain('已停止创建：src/new.ts')
  })

  it('keeps command fallback error results visible with shell output', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'tool-call',
        toolCallId: 'cmd-error',
        toolName: 'codex_command_execution',
        argsText: JSON.stringify({ command: 'npm test', cwd: '/repo' }),
        isError: true,
        status: { type: 'complete' },
        result: { error: 'command did not complete before the turn closed' }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('command')
    expect(container.textContent).toContain('命令出错：npm test')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(container.textContent).toContain('命令出错：npm test')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    expect(container.querySelector('[data-slot="tool-fallback-shell"]')?.textContent).toContain(
      '$ npm test'
    )
    const result = container.querySelector('[data-slot="tool-fallback-result"]')
    expect(result).not.toBeNull()
    expect(result?.textContent).toContain('command did not complete before the turn closed')
  })

  it('keeps unknown tool fallback on generic input and result rendering', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'dynamic-tool',
        toolCallId: 'custom-tool-1',
        toolName: 'custom_tool',
        state: 'output-available',
        input: { query: 'needle' },
        output: { found: true },
        providerExecuted: true
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('dynamic')
    expect(group?.dataset.state).toBe('closed')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    expect(container.querySelector('[data-slot="tool-fallback-shell"]')).toBeNull()
    expect(container.textContent).toContain('Custom Tool')
    expect(container.textContent).toContain('"query": "needle"')
    expect(container.textContent).toContain('"found": true')
  })

  it('keeps collapsed tool activity closed until expanded', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('edit-a', 'codex_file_change', 'fileChange', {
        changes: [
          {
            path: 'src/a.ts',
            diff: '--- a/src/a.ts\n+++ b/src/a.ts\n+new line\n'
          }
        ]
      }),
      genericToolPart('edit-b', 'codex_file_change', 'fileChange', {
        changes: [
          {
            path: 'src/b.ts',
            diff: '--- a/src/b.ts\n+++ b/src/b.ts\n-old line\n+new line\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('file-change')
    expect(group).not.toBeNull()
    expect(group?.dataset.state).toBe('closed')
    expect(group?.textContent).toContain('已编辑 2 个文件')
    expect(container.querySelector('[data-slot="collapsed-activity-details"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="tool-fallback-root"]')).toHaveLength(0)

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(group?.dataset.state).toBe('open')
    expect(container.querySelector('[data-slot="collapsed-activity-details"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="tool-fallback-root"]')).toHaveLength(2)
    const fileChangeStats = Array.from(
      group?.querySelectorAll<HTMLElement>('[data-slot="tool-file-change-stats"]') ?? []
    )
    expect(fileChangeStats.map((stats) => stats.textContent)).toEqual(['+1-0', '+1-1'])
    expect(fileChangeStats[0]?.children[0]?.className).toContain(
      'group-hover/tool-fallback-root:text-emerald-700'
    )
    expect(fileChangeStats[0]?.children[1]?.className).toContain(
      'group-hover/tool-fallback-root:text-red-700'
    )

    const contentBody = group?.querySelector<HTMLElement>('[data-slot="tool-group-content"] > div')
    expect(contentBody?.className).not.toContain('animate-in')
    expect(contentBody?.className).not.toContain('fade-in-0')
    expect(contentBody?.className).not.toContain('blur-in')
    expect(contentBody?.className).not.toContain('slide-in-from-top')
  })

  it('renders expanded file changes with Diff Viewer instead of generic parameters and results', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('edit-diff', 'codex_file_change', 'fileChange', {
        changes: [
          {
            path: 'src/example.ts',
            diff: '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,1 +1,1 @@\n-old value\n+new value\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('file-change')
    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })
    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    const diff = group?.querySelector<HTMLElement>('[data-slot="tool-file-change-diff"]')
    expect(diff).not.toBeNull()
    expect(diff?.className).toContain('max-h-96')
    expect(diff?.className).toContain('overflow-y-auto')
    expect(diff?.querySelector('[data-slot="diff-viewer"]')?.getAttribute('data-view-mode')).toBe(
      'unified'
    )
    expect(diff?.textContent).toContain('example.ts')
    expect(diff?.textContent).toContain('old value')
    expect(diff?.textContent).toContain('new value')
    expect(group?.querySelector('[data-slot="tool-fallback-args"]')).toBeNull()
    expect(group?.querySelector('[data-slot="tool-fallback-result"]')).toBeNull()
  })

  it('renders each changed file in a file-change result as a separate tool item', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('edit-many', 'codex_file_change', 'fileChange', {
        changes: [
          {
            path: 'src/App.test.tsx',
            diff: '--- a/src/App.test.tsx\n+++ b/src/App.test.tsx\n-old test\n+new test\n'
          },
          {
            path: 'src/components/assistant-ui/tool-fallback.tsx',
            diff: '--- a/src/components/assistant-ui/tool-fallback.tsx\n+++ b/src/components/assistant-ui/tool-fallback.tsx\n+first line\n+second line\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('file-change')
    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    const toolItems = Array.from(
      group?.querySelectorAll<HTMLElement>('[data-slot="tool-fallback-root"]') ?? []
    )
    const stats = Array.from(
      group?.querySelectorAll<HTMLElement>('[data-slot="tool-file-change-stats"]') ?? []
    )

    expect(group?.textContent).toContain('已编辑 2 个文件')
    expect(toolItems).toHaveLength(2)
    expect(toolItems.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('App.test.tsx'),
        expect.stringContaining('tool-fallback.tsx')
      ])
    )
    expect(stats.map((item) => item.textContent)).toEqual(['+1-1', '+2-0'])

    await act(async () => {
      for (const item of toolItems) {
        item.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
      }
    })

    expect(group?.querySelectorAll('[data-slot="tool-file-change-diff"]')).toHaveLength(2)
    expect(group?.textContent).toContain('old test')
    expect(group?.textContent).toContain('first line')
  })

  it('renders created files from their raw content in Diff Viewer', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('create-diff', 'codex_file_change', 'fileChange', {
        changes: [
          {
            path: '/repo/src/generated/new-file.ts',
            kind: { type: 'add' },
            diff: 'export const created = true\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('file-change')
    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })
    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
    })

    const trigger = group?.querySelector<HTMLElement>('[data-slot="tool-fallback-trigger"]')
    const filePath = trigger?.querySelector<HTMLElement>('[data-slot="file-path"]')
    const diff = group?.querySelector<HTMLElement>('[data-slot="tool-file-change-diff"]')

    expect(trigger?.textContent).toContain('new-file.ts')
    expect(trigger?.textContent).not.toContain('/repo/src/generated/new-file.ts')
    expect(filePath?.getAttribute('title')).toBe('/repo/src/generated/new-file.ts')
    expect(
      diff?.querySelector('[data-slot="diff-viewer-line"][data-type="add"]')?.textContent
    ).toContain('export const created = true')
  })

  it('uses dedicated renderers when tool runs are separated by text', async () => {
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
      { type: 'text', text: '继续调用集成' },
      genericToolPart('mcp-1', 'mcp:github/read', 'mcpToolCall', {
        server: 'github',
        tool: 'read'
      }),
      genericToolPart('mcp-2', 'mcp:github/write', 'mcpToolCall', {
        server: 'github',
        tool: 'write'
      }),
      { type: 'text', text: '继续运行 Node' },
      genericToolPart('mcp-node', 'mcp:node_repl/js', 'mcpToolCall', {
        server: 'node_repl',
        tool: 'js'
      }),
      { type: 'text', text: '继续使用 Browser' },
      genericToolPart('mcp-browser', 'mcp:browser/open', 'mcpToolCall', {
        server: 'browser',
        tool: 'open'
      }),
      { type: 'text', text: '继续协作' },
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

    const reasoning = container.querySelector<HTMLElement>('[data-slot="reasoning-group"]')
    expect(reasoning?.dataset.state).toBe('closed')

    await act(async () => {
      reasoning?.querySelector<HTMLButtonElement>('[data-slot="reasoning-group-trigger"]')?.click()
    })

    const webSearchGroup = toolGroup('web-search')
    const dynamicGroup = toolGroup('dynamic')
    const pendingMcpGroup = toolGroup('mcp')
    const multiAgentGroup = toolGroup('multi-agent')
    expect(webSearchGroup?.dataset.state).toBe('closed')
    expect(dynamicGroup?.dataset.state).toBe('closed')
    expect(pendingMcpGroup?.dataset.state).toBe('closed')
    expect(multiAgentGroup?.dataset.state).toBe('closed')
    expect(container.textContent).toContain('已使用 github')
    expect(container.textContent).toContain('已运行命令')
    expect(container.textContent).toContain('已使用 Browser')
    expect(container.textContent).toContain('已处理 2 个协作任务')
  })

  it('renders adjacent subagent activity as compact deduplicated agent chips', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('activity-a-started', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'started',
        agentThreadId: 'agent-a',
        agentPath: '/root/code_quality_review'
      }),
      genericToolPart('activity-a-updated', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'interacted',
        agentThreadId: 'agent-a',
        agentPath: '/root/code_quality_review'
      }),
      genericToolPart('activity-b', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'started',
        agentThreadId: 'agent-b',
        agentPath: '/root/architecture_review'
      }),
      genericToolPart('activity-c', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'started',
        agentThreadId: 'agent-c',
        agentPath: '/root/reviewer'
      }),
      genericToolPart('activity-d', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'started',
        agentThreadId: 'agent-d',
        agentPath: '/root/architect'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = container.querySelector<HTMLElement>('[data-slot="subagent-activity-group"]')
    const chips = group?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="subagent-activity-agent"]'
    )
    expect(group?.textContent).toContain('已更新')
    expect(group?.textContent).toContain('Code quality review')
    expect(group?.textContent).toContain('另有 1 个子 agent')
    expect(chips).toHaveLength(3)
    expect(container.textContent).not.toContain('子任务活动')

    await act(async () => {
      chips?.[0]?.click()
    })

    expect(runtimeState.openConversation).toHaveBeenCalledWith({ conversationId: 'agent-a' })
  })

  it('renders semantic multi-agent details and opens the receiver conversation', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('spawn-agent', 'codex_collab_agent', 'collabAgentToolCall', {
        tool: 'spawnAgent',
        receiverThreadIds: ['agent-architecture'],
        prompt: '检查架构边界',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        agentsStates: {
          'agent-architecture': { status: 'running', message: '正在检查模块边界' }
        }
      }),
      genericToolPart('activity-architecture', 'codex_sub_agent_activity', 'subAgentActivity', {
        kind: 'started',
        agentThreadId: 'agent-architecture',
        agentPath: '/root/architecture_review'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('multi-agent')
    expect(group?.textContent).toContain('已启动 1 个子 agent')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    const receiver = group?.querySelector<HTMLButtonElement>(
      '[data-slot="multi-agent-detail-row"][data-agent-thread-id="agent-architecture"]'
    )
    expect(receiver?.textContent).toContain('Architecture review')
    expect(receiver?.textContent).toContain('gpt-5.5 · high')
    expect(receiver?.textContent).toContain('检查架构边界')
    expect(receiver?.textContent).toContain('正在检查模块边界')

    await act(async () => {
      receiver?.click()
    })

    expect(runtimeState.openConversation).toHaveBeenCalledWith({
      conversationId: 'agent-architecture'
    })
  })

  it('keeps the missing metadata diagnostic for unknown dynamic tool groups', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('lookup-1', 'lookup', 'dynamicToolCall', {
        tool: 'lookup',
        arguments: { id: 'A' }
      }),
      genericToolPart('lookup-2', 'lookup', 'dynamicToolCall', {
        tool: 'lookup',
        arguments: { id: 'B' }
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('dynamic')
    expect(group).not.toBeNull()
    expect(group?.textContent).toContain('Lookup（2 次）')
    expect(group?.textContent).not.toContain('动态工具缺少完整显示元数据')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(group?.textContent).toContain('动态工具缺少完整显示元数据')
  })

  it('renders summary-only dynamic groups without expandable details', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('lookup-1', 'lookup', 'dynamicToolCall', {
        registryMetadata: {
          summaryOnlyInConversationGroup: true,
          completedSummaryKey: 'lookup'
        }
      }),
      genericToolPart('lookup-2', 'lookup', 'dynamicToolCall', {
        registryMetadata: {
          summaryOnlyInConversationGroup: true,
          completedSummaryKey: 'lookup'
        }
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('dynamic')
    const trigger = group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')
    expect(group).not.toBeNull()
    expect(trigger?.disabled).toBe(true)
    expect(group?.querySelector('[data-slot="tool-group-content"]')).toBeNull()
    expect(group?.querySelector('[data-slot="collapsed-activity-details"]')).toBeNull()
  })

  it('renders rich MCP content blocks and compact web search details', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('mcp-rich', 'mcp:docs/search', 'mcpToolCall', {
        server: 'docs',
        tool: 'search',
        arguments: { query: 'render unit parity' },
        result: {
          content: [
            { type: 'text', text: 'found docs' },
            {
              type: 'image',
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png',
              altText: 'diagram'
            },
            { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' },
            { type: 'resource_link', title: 'Docs resource', uri: 'app://docs/1' },
            { type: 'resource', resource: { uri: 'file:///docs/canonical.md', text: 'canonical' } },
            { type: 'embedded_resource', resource: { title: 'Embedded doc', text: 'inside' } },
            { type: 'custom_block', value: 1 }
          ],
          structuredContent: { count: 1 },
          isError: false
        }
      }),
      genericToolPart('web-1', 'codex_web_search', 'webSearch', {
        query: 'render unit parity',
        action: { type: 'openPage', url: 'https://example.test/docs/render-unit-parity' },
        faviconUrl: 'https://example.test/favicon.ico'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('composite')
    expect(group).not.toBeNull()

    act(() => {
      group
        ?.querySelector('[data-slot="tool-group-trigger"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-slot="mcp-rich-output"]')).not.toBeNull()
    expect(container.textContent).toContain('docs / search')
    expect(container.textContent).toContain('found docs')
    expect(container.textContent).toContain('Docs resource')
    expect(container.textContent).toContain('file:///docs/canonical.md')
    expect(container.textContent).toContain('canonical')
    expect(container.textContent).toContain('Embedded doc')
    expect(container.textContent).toContain('未知内容：custom_block')
    expect(container.querySelector('[data-slot="web-search-details"]')).not.toBeNull()
    const webSearchDetail = container.querySelector<HTMLElement>(
      '[data-slot="web-search-details"] li'
    )
    expect(webSearchDetail?.textContent).toContain('已搜索网页')
    expect(webSearchDetail?.textContent).toContain('https://example.test/docs/render-unit-parity')
    expect(webSearchDetail?.className).toContain('text-sm')
    expect(webSearchDetail?.className).toContain('text-muted-foreground')
    expect(webSearchDetail?.className).not.toMatch(/rounded|border|bg-/)
    expect(webSearchDetail?.querySelector('[data-slot="web-search-detail-icon"]')).not.toBeNull()
    expect(container.querySelector('img[src="https://example.test/favicon.ico"]')).toBeNull()
  })

  it('renders live web search details from tool input before result item exists', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      {
        type: 'dynamic-tool',
        toolCallId: 'web-live',
        toolName: 'codex_web_search',
        state: 'input-available',
        input: { query: 'live render unit query', action: { type: 'search' } },
        providerExecuted: true
      }
    ]

    act(() => {
      root.render(<App />)
    })

    act(() => {
      toolGroup('web-search')
        ?.querySelector('[data-slot="tool-group-trigger"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-slot="web-search-details"]')).not.toBeNull()
    expect(container.textContent).toContain('live render unit query')
    expect(container.textContent).toContain('正在搜索网页')
  })

  it('renders compact web search details without favicons', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('web-data', 'codex_web_search', 'webSearch', {
        query: 'safe data favicon',
        action: { type: 'search' },
        faviconUrl: 'data:image/png;base64,iVBORw0KGgo='
      }),
      genericToolPart('web-js', 'codex_web_search', 'webSearch', {
        query: 'unsafe js favicon',
        action: { type: 'search' },
        faviconUrl: 'javascript:alert(1)'
      }),
      genericToolPart('web-file', 'codex_web_search', 'webSearch', {
        query: 'unsafe file favicon',
        action: { type: 'search' },
        faviconUrl: 'file:///tmp/favicon.ico'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    act(() => {
      toolGroup('web-search')
        ?.querySelector('[data-slot="tool-group-trigger"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelectorAll('[data-slot="web-search-detail-icon"]')).toHaveLength(3)
    expect(container.querySelector('img[src="data:image/png;base64,iVBORw0KGgo="]')).toBeNull()
    expect(container.querySelector('img[src^="javascript:"]')).toBeNull()
    expect(container.querySelector('img[src^="file:"]')).toBeNull()
  })

  it('renders fixture-backed custom entry units for todo diff generated resources comments and approval review', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('todo-1', 'todo-list', 'todo-list', {
        items: [
          { text: '锁定现有行为', status: 'completed' },
          { text: '实现 rich renderer', status: 'inProgress' }
        ]
      }),
      genericToolPart('diff-1', 'turn-diff', 'turn-diff', {
        cwd: '/repo',
        files: [
          {
            path: '/repo/src/App.tsx',
            diff: '--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n'
          }
        ]
      }),
      genericToolPart('image-1', 'generated-image', 'generated-image', {
        result: 'iVBORw0KGgo=',
        revisedPrompt: 'a render unit gallery'
      }),
      genericToolPart('resources-1', 'endResources', 'endResources', {
        resources: [
          { type: 'file', path: '/repo/report.pdf', title: 'Report' },
          { type: 'google-drive', url: 'https://drive.example/doc', title: 'Drive doc' },
          { type: 'appgen-app', id: 'app-1', title: 'Generated app' },
          { type: 'website', url: 'https://example.test', title: 'Website' }
        ]
      }),
      genericToolPart('comments-1', 'reviewComments', 'reviewComments', {
        comments: [
          { priority: 'P2', file: '/repo/a.ts', line: 20, title: 'Second', body: 'later' },
          { priority: 'P1', file: '/repo/b.ts', line: 10, title: 'First', body: 'fix this' }
        ]
      }),
      genericToolPart('approval-1', 'codex_automatic_approval_review', 'automaticApprovalReview', {
        outcome: 'approved',
        rationale: 'safe command'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="todo-list-entry-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('待办进度 1/2')
    const turnDiffCard = container.querySelector('[data-slot="turn-diff-entry-unit"]')
    expect(turnDiffCard).not.toBeNull()
    expect(turnDiffCard?.querySelector('[data-slot="card-header"]')).not.toBeNull()
    expect(turnDiffCard?.querySelector('[data-slot="table"]')).not.toBeNull()
    expect(container.textContent).toContain('已编辑 1 个文件')
    expect(turnDiffCard?.textContent).toContain('src/App.tsx')
    expect(turnDiffCard?.textContent).not.toContain('/repo/src/App.tsx')
    expect(container.textContent).toContain('+1')
    expect(container.textContent).toContain('-1')
    expect(container.querySelector('[data-slot="turn-diff-static-actions"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="generated-image-entry-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('已生成 1 张图片')
    expect(container.querySelector('[data-slot="end-resource-cards-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('Report')
    expect(container.textContent).toContain('显示更多 1 条')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 Report"]')?.click()
    })
    expect(window.desktopApp.codex.openLocalPath).toHaveBeenCalledWith({
      path: '/repo/report.pdf',
      line: undefined
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 Drive doc"]')?.click()
    })
    expect(window.desktopApp.codex.openExternalHttpUrl).toHaveBeenCalledWith(
      'https://drive.example/doc'
    )
    expect(container.querySelector('[data-slot="review-comments-entry-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('First')
    expect(container.textContent).toContain('/repo/b.ts:10')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 /repo/b.ts:10"]')?.click()
    })
    expect(window.desktopApp.codex.openLocalPath).toHaveBeenCalledWith({
      path: '/repo/b.ts',
      line: 10
    })
    expect(
      container.querySelector('[data-slot="automatic-approval-review-entry-unit"]')
    ).not.toBeNull()
    expect(container.textContent).toContain('自动审批已通过')
  })

  it('renders parsed code comments as a sorted expandable card and opens relative files', async () => {
    runtimeState.activeConversation = {
      conversationId: 'conversation-comments',
      threadId: 'thread-comments',
      cwd: '/repo',
      projectSelection: { projectKind: 'path', path: '/repo' }
    }
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'text',
        text: [
          '审查完成。',
          codeCommentDirective('P2 issue', 'details-p2', 'src/p2.ts', 22, 2),
          codeCommentDirective('P0 issue', 'details-p0', 'src/p0.ts', 2, 0),
          codeCommentDirective('P1 issue', 'details-p1', 'src/p1.ts', 11, 1),
          codeCommentDirective('No priority', 'details-none', 'src/none.ts', 50),
          codeCommentDirective('P3 issue', 'details-p3', 'src/p3.ts', 33, 3)
        ].join('\n')
      }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text', providerMetadata: messagePhaseMetadata('final_answer') }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const card = container.querySelector<HTMLElement>('[data-slot="review-comments-unit"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('5 comments')
    expect(container.textContent).toContain('审查完成。')
    expect(container.textContent).not.toContain('::code-comment')
    expect(card?.textContent).not.toContain('details-p0')

    const visibleRows = Array.from(
      card?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? []
    )
    expect(visibleRows.map((button) => button.textContent)).toEqual([
      expect.stringContaining('P0 issue'),
      expect.stringContaining('P1 issue'),
      expect.stringContaining('P2 issue')
    ])

    await act(async () => {
      visibleRows[0]?.click()
    })
    expect(window.desktopApp.codex.openLocalPath).toHaveBeenCalledWith({
      path: 'src/p0.ts',
      cwd: '/repo',
      line: 2
    })

    await act(async () => {
      visibleRows[0]?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 650))
    })
    expect(document.body.textContent).toContain('details-p0')

    const showMore = buttonWithText('再显示 2 条评论')
    expect(showMore?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      showMore?.click()
    })
    expect(card?.textContent).toContain('P3 issue')
    expect(card?.textContent).toContain('No priority')
    const collapse = buttonWithText('收起评论')
    expect(collapse?.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      collapse?.click()
    })
    expect(card?.textContent).not.toContain('P3 issue')
    expect(buttonWithText('再显示 2 条评论')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps remote-project code comments visible without opening local files', async () => {
    runtimeState.activeConversation = {
      conversationId: 'conversation-remote-comments',
      threadId: 'thread-remote-comments',
      cwd: '/srv/app',
      projectSelection: { projectKind: 'remote', projectId: 'remote', hostId: 'ssh-dev' }
    }
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'text',
        text: codeCommentDirective('Remote issue', 'remote details', 'src/remote.ts', 9, 1)
      }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text', providerMetadata: messagePhaseMetadata('final_answer') }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const row = container.querySelector<HTMLButtonElement>(
      'button[aria-label="src/remote.ts:9 无法作为本地文件打开"]'
    )
    expect(row).not.toBeNull()
    expect(row?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      row?.click()
    })
    expect(window.desktopApp.codex.openLocalPath).not.toHaveBeenCalled()
  })

  it('opens absolute turn diff file paths from the diff card', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('diff-open', 'codex_turn_diff', 'turnDiff', {
        files: [
          {
            path: '/repo/src/App.tsx',
            diff: '--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="打开 /repo/src/App.tsx"]')
        ?.click()
    })

    expect(window.desktopApp.codex.openLocalPath).toHaveBeenCalledWith({
      path: '/repo/src/App.tsx'
    })
  })

  it('opens relative turn diff file paths when cwd metadata is available', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('diff-relative-open', 'codex_turn_diff', 'turnDiff', {
        cwd: '/repo',
        files: [
          {
            path: 'src/App.tsx',
            diff: '--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 src/App.tsx"]')?.click()
    })

    expect(window.desktopApp.codex.openLocalPath).toHaveBeenCalledWith({
      path: '/repo/src/App.tsx'
    })
  })

  it('disables relative turn diff file opening when cwd metadata is missing', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('diff-relative-disabled', 'codex_turn_diff', 'turnDiff', {
        files: [
          {
            path: 'src/App.tsx',
            diff: '--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n'
          }
        ]
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="无法打开 src/App.tsx"]'
    )
    expect(button?.disabled).toBe(true)

    await act(async () => {
      button?.click()
    })

    expect(window.desktopApp.codex.openLocalPath).not.toHaveBeenCalled()
  })

  it('expands turn diff file lists beyond the three-file preview', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('diff-many-files', 'codex_turn_diff', 'turnDiff', {
        cwd: '/repo',
        files: Array.from({ length: 6 }, (_, index) => ({
          path: `src/file-${index + 1}.ts`,
          added: index + 1,
          removed: 0,
          diff: `--- a/src/file-${index + 1}.ts\n+++ b/src/file-${index + 1}.ts\n+new\n`
        }))
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('file-3.ts')
    expect(container.textContent).not.toContain('file-4.ts')

    await act(async () => {
      buttonWithText('再显示 3 个文件')?.click()
    })

    expect(container.textContent).toContain('file-6.ts')
    expect(container.textContent).toContain('收起文件')
  })

  it('keeps large turn diffs collapsed to file summaries', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('diff-large', 'codex_turn_diff', 'turnDiff', {
        originalLength: 75_000,
        diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.textContent).toContain('大 diff 已折叠，只显示文件摘要')
    expect(container.textContent).toContain('a.ts')
  })

  it('renders command read search and list activity as a collapsed exploration card', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      commandToolPart('read-exploration', 'read', { status: { type: 'complete' } }),
      commandToolPart('search-exploration', 'search', { status: { type: 'complete' } }),
      commandToolPart('list-exploration', 'listFiles', { status: { type: 'complete' } })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = explorationToolGroup()
    expect(group?.dataset.state).toBe('closed')
    expect(container.textContent).toContain('已探索')
    expect(container.textContent).toContain('1 个文件')
    expect(container.textContent).toContain('1 次搜索')
    expect(container.textContent).toContain('1 次列表')
    expect(container.textContent).not.toContain('read-exploration')

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(group?.dataset.state).toBe('open')
    expect(container.textContent).toContain('read-exploration')
    expect(container.textContent).toContain('已运行：search search-exploration')
    expect(container.textContent).toContain('list-exploration')
  })

  it('moves active todo and diff entries into a running-turn live footer only while running', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      genericToolPart('todo-live', 'codex_todo_list', 'todoList', {
        status: 'inProgress',
        items: [
          { label: 'Inspect contract', status: 'completed' },
          { label: 'Patch footer', status: 'inProgress' }
        ]
      }),
      genericToolPart('diff-live', 'codex_turn_diff', 'turnDiff', {
        status: 'inProgress',
        diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="live-render-unit-footer"]')).not.toBeNull()
    expect(container.textContent).toContain('待办进度 1/2')
    expect(container.textContent).toContain('已编辑 1 个文件')
    expect(container.textContent).not.toContain('正在思考')
    expect(container.querySelector('[data-slot="message-thinking-unit"]')).toBeNull()

    threadMessageState.message.status = { type: 'complete' }
    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="live-render-unit-footer"]')).toBeNull()
    expect(container.querySelector('[data-slot="todo-list-entry-unit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="turn-diff-entry-unit"]')).not.toBeNull()
    expect(container.textContent).not.toContain('正在思考')
    expect(container.querySelector('[data-slot="message-thinking-unit"]')).toBeNull()
  })

  it('keeps active todo and diff entries in the message body while a server request is blocking', () => {
    runtimeState.serverRequests = [fileChangeApprovalRequest('blocking-request')]
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      genericToolPart('todo-blocked-live', 'codex_todo_list', 'todoList', {
        status: 'inProgress',
        items: [
          { label: 'Inspect contract', status: 'completed' },
          { label: 'Wait for approval', status: 'inProgress' }
        ]
      }),
      genericToolPart('diff-blocked-live', 'codex_turn_diff', 'turnDiff', {
        status: 'inProgress',
        diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="server-request-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="live-render-unit-footer"]')).toBeNull()
    expect(container.querySelector('[data-slot="todo-list-entry-unit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="turn-diff-entry-unit"]')).not.toBeNull()
  })

  it('renders generated image file parts as an image gallery card', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'file',
        mediaType: 'image/png',
        data: 'iVBORw0KGgo=',
        providerMetadata: {
          '@janole/ai-sdk-provider-codex-asp': {
            revisedPrompt: 'a generated reference image',
            savedPath: '/tmp/image.png'
          }
        }
      }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="generated-image-file-unit"]')).not.toBeNull()
    expect(container.textContent).toContain('已生成图片')
    expect(container.textContent).toContain('a generated reference image')
  })

  it('keeps hidden render target metadata for unknown non-image file parts', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'file',
        mediaType: 'application/pdf',
        data: 'JVBERi0xLjQ=',
        name: 'report.pdf'
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const target = container.querySelector('[data-slot="unknown-render-unit"]')
    expect(target).not.toBeNull()
    expect(target?.getAttribute('data-render-unit-key')).toBe('unknown:0')
  })

  it('scrolls to a render target when the app receives a render-target event', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      commandToolPart('scroll-target-command', 'search', { status: { type: 'complete' } })
    ]

    act(() => {
      root.render(<App />)
    })

    const target = container.querySelector<HTMLElement>(
      '[data-render-target-ids~="scroll-target-command"]'
    )
    expect(target).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('codex:scroll-render-target', {
          detail: { targetId: 'scroll-target-command', behavior: 'auto' }
        })
      )
      await Promise.resolve()
    })

    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(target?.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('expands a real tool group root before scrolling to its render target', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('web-scroll', 'codex_web_search', 'webSearch', {
        query: 'timeline target query',
        action: { type: 'search' }
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = toolGroup('web-search')
    expect(group).not.toBeNull()
    expect(group?.dataset.state).toBe('closed')

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('codex:scroll-render-target', {
          detail: { targetId: 'web-scroll', behavior: 'auto' }
        })
      )
      await Promise.resolve()
    })

    expect(group?.dataset.state).toBe('open')
    expect(group?.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
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

    expect(container.textContent).toContain('正在探索')
    expect(container.textContent).toContain('2 次搜索')
    expect(container.textContent).not.toContain('已探索')
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

  it('groups commentary and process activity while hiding internal reasoning summaries', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      {
        type: 'reasoning',
        text: '**Clarifying state initialization and active flags**'
      },
      {
        type: 'text',
        text: '我会按“只分析、不改代码”的方式，把这几段异常文字沿着「模型事件 → provider 映射 → AI SDK 流 → renderer 消息渲染/持久化」逐层定位，并核对你点名的几个本地对话记录。先读取仓库的分析流程要求，再收集实际证据。'
      },
      commandToolPart('search-1', 'search', { status: { type: 'complete' } }),
      {
        type: 'reasoning',
        text: '**Confirming reasoning visibility handling**'
      },
      { type: 'text', text: '现已核对实时流与历史记录。' }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [
          { type: 'reasoning' },
          { type: 'text', providerMetadata: messagePhaseMetadata('commentary') },
          { type: 'reasoning' },
          { type: 'text', providerMetadata: messagePhaseMetadata('commentary') }
        ]
      }
    ]
    act(() => {
      root.render(<App />)
    })

    const reasoning = container.querySelector('[data-slot="reasoning-group"]')
    const reasoningContent = reasoning?.querySelector<HTMLElement>(
      '[data-slot="reasoning-group-content"] > div'
    )
    const reasoningHeader = reasoning?.querySelector<HTMLElement>(
      '[data-slot="reasoning-group-header"]'
    )
    const reasoningDivider = reasoning?.querySelector<HTMLElement>(
      '[data-slot="reasoning-group-divider"]'
    )
    const activeTrigger = reasoning?.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )
    const reasoningLabel = reasoning?.querySelector<HTMLElement>(
      '[data-slot="reasoning-group-label"]'
    )

    expect(container.querySelectorAll('[data-slot="reasoning-group"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="reasoning-process-item"]')).toHaveLength(3)
    expect(reasoning?.getAttribute('data-state')).toBe('open')
    expect(reasoning?.className).not.toContain('text-sm')
    expect(reasoning?.className).not.toContain('text-muted-foreground')
    expect(reasoningHeader).not.toBeNull()
    expect(reasoningDivider?.className).toBe('mb-4 border-border')
    expect(reasoningLabel?.className).not.toContain('font-medium')
    expect(reasoningContent?.className).toBe('min-w-0 space-y-4')
    expect(reasoning?.textContent).toContain('我会按“只分析、不改代码”的方式')
    expect(reasoning?.textContent).toContain('现已核对实时流与历史记录')
    expect(activeTrigger?.textContent).toBe('已处理 · 耗时 0 秒')
    expect(activeTrigger?.querySelector('.shimmer')).toBeNull()
    expect(activeTrigger?.disabled).toBe(true)
    expect(activeTrigger?.querySelectorAll('svg')).toHaveLength(1)
    const thinkingPlaceholder = container.querySelector('[data-slot="message-thinking-unit"]')
    expect(thinkingPlaceholder?.textContent).toBe('正在思考')
    expect(thinkingPlaceholder?.querySelector('.shimmer')).not.toBeNull()
    expect(container.textContent).not.toContain('Clarifying state initialization and active flags')
    expect(container.textContent).not.toContain('Confirming reasoning visibility handling')

    act(() => {
      activeTrigger?.click()
    })

    expect(reasoning?.getAttribute('data-state')).toBe('open')

    threadMessageState.message.content = [
      ...threadMessageState.message.content,
      { type: 'text', text: '## 结论\n\n根因已经确认。' }
    ]
    threadMessageState.externalMessages = [
      {
        metadata: { codexTurnDurationMs: 1250 },
        parts: [
          { type: 'reasoning' },
          { type: 'text', providerMetadata: messagePhaseMetadata('commentary') },
          { type: 'reasoning' },
          { type: 'text', providerMetadata: messagePhaseMetadata('commentary') },
          { type: 'text', providerMetadata: messagePhaseMetadata('final_answer') }
        ]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const streamingAnswerReasoning = container.querySelector('[data-slot="reasoning-group"]')
    const streamingAnswerTrigger = streamingAnswerReasoning?.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )

    expect(streamingAnswerReasoning?.getAttribute('data-state')).toBe('closed')
    expect(streamingAnswerTrigger?.disabled).toBe(false)
    expect(streamingAnswerReasoning?.textContent).not.toContain('根因已经确认')
    expect(container.textContent).toContain('根因已经确认')

    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.metadata = undefined

    act(() => {
      root.render(<App />)
    })

    const completedReasoning = container.querySelector('[data-slot="reasoning-group"]')
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )

    expect(completedReasoning?.getAttribute('data-state')).toBe('closed')
    expect(trigger?.textContent).toBe('已处理 · 耗时 1 秒')
    expect(trigger?.querySelectorAll('svg')).toHaveLength(1)
    expect(completedReasoning?.textContent).not.toContain('根因已经确认')
    expect(container.textContent).toContain('根因已经确认')

    act(() => {
      trigger?.click()
    })

    expect(completedReasoning?.getAttribute('data-state')).toBe('open')
    expect(completedReasoning?.textContent).toContain('我会按“只分析、不改代码”的方式')
    expect(completedReasoning?.textContent).toContain('现已核对实时流与历史记录')
  })

  it('collapses an inferred process when the candidate answer starts', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      { type: 'text', text: '## 执行过程\n\n先检查项目。' },
      commandToolPart('qwen-search-1', 'search', { status: { type: 'complete' } }),
      { type: 'text', text: '## 最终结论\n\n根因已经确认。' }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text' }, { type: 'text' }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const runningReasoning = container.querySelector<HTMLElement>('[data-slot="reasoning-group"]')
    const runningReasoningTrigger = runningReasoning?.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )
    const candidateAnswer = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="assistant-render-text"]')
    ).find((element) => element.textContent?.includes('最终结论'))

    expect(runningReasoning?.getAttribute('data-state')).toBe('closed')
    expect(runningReasoningTrigger?.disabled).toBe(false)
    expect(runningReasoning?.textContent).not.toContain('最终结论')
    expect(candidateAnswer?.querySelector('[data-testid="streamdown-text"]')).not.toBeNull()

    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.externalMessages = [
      {
        metadata: { codexTurnDurationMs: 1250 },
        parts: [{ type: 'text' }, { type: 'text' }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const completedReasoning = container.querySelector<HTMLElement>('[data-slot="reasoning-group"]')
    const completedTrigger = completedReasoning?.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )

    expect(completedReasoning?.getAttribute('data-state')).toBe('closed')
    expect(completedTrigger?.textContent).toBe('已处理 · 耗时 1 秒')
    expect(completedReasoning?.textContent).not.toContain('最终结论')
    expect(container.textContent).toContain('根因已经确认')
  })

  it('keeps the inferred process chevron mounted when a candidate becomes process', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      { type: 'text', text: '先检查项目。' },
      commandToolPart('qwen-check-1', 'search', { status: { type: 'complete' } }),
      { type: 'text', text: '目前看是配置问题。' }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text' }, { type: 'text' }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const inactiveTrigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )
    const chevron = inactiveTrigger?.querySelector('svg')

    expect(inactiveTrigger?.disabled).toBe(false)
    expect(chevron).not.toBeNull()

    threadMessageState.message.content = [
      ...threadMessageState.message.content,
      commandToolPart('qwen-check-2', 'search', { status: { type: 'complete' } })
    ]

    act(() => {
      root.render(<App />)
    })

    const activeTrigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )

    expect(activeTrigger?.disabled).toBe(true)
    expect(activeTrigger?.querySelector('svg')).toBe(chevron)
  })

  it('shows blocked commentary as waiting for confirmation', () => {
    runtimeState.serverRequests = [fileChangeApprovalRequest('commentary-blocking-request')]
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [{ type: 'text', text: '请确认这次修改。' }]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text', providerMetadata: messagePhaseMetadata('commentary') }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const trigger = container.querySelector<HTMLElement>('[data-slot="reasoning-group-trigger"]')

    expect(container.querySelector('[data-slot="reasoning-group"]')).not.toBeNull()
    expect(trigger?.textContent).toBe('等待确认')
    expect(trigger?.querySelector('.shimmer')).toBeNull()
    expect(container.querySelector('[data-slot="message-thinking-unit"]')).toBeNull()
    expect(container.textContent).not.toContain('正在思考')
  })

  it('renders every completed command and wait item in a historical commentary replay', async () => {
    const commandParts = Array.from({ length: 15 }, (_, index) => {
      const callId = `replay-exec-${index + 1}`
      const command = `echo ${callId}`

      return genericToolPart(callId, 'codex_command_execution', 'commandExecution', {
        command,
        cwd: '/repo',
        processId: null,
        status: 'completed',
        commandActions: [],
        aggregatedOutput: `${callId} completed`,
        exitCode: 0,
        durationMs: 1
      })
    })
    const waitParts = Array.from({ length: 3 }, (_, index) =>
      genericToolPart(`replay-wait-${index + 1}`, 'codex_sleep', 'sleep', {
        durationMs: 1_000
      })
    )

    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      { type: 'text', text: '开始回放工具调用。' },
      ...commandParts.slice(0, 11),
      waitParts[0],
      ...commandParts.slice(11, 14),
      waitParts[1],
      commandParts[14],
      waitParts[2],
      { type: 'text', text: '## 回放完成' }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [
          { type: 'text', providerMetadata: messagePhaseMetadata('commentary') },
          { type: 'text', providerMetadata: messagePhaseMetadata('final_answer') }
        ]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const reasoning = container.querySelector<HTMLElement>('[data-slot="reasoning-group"]')
    const reasoningTrigger = reasoning?.querySelector<HTMLButtonElement>(
      '[data-slot="reasoning-group-trigger"]'
    )

    expect(reasoning?.getAttribute('data-state')).toBe('closed')
    expect(container.textContent).toContain('回放完成')

    await act(async () => {
      reasoningTrigger?.click()
    })

    const commandGroups = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-slot="tool-group-unit"][data-tool-group-kind="command"]'
      )
    )
    const renderedWaitItems = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="compact-entry-unit"]')
    )

    expect(commandGroups).toHaveLength(3)
    expect(commandGroups.every((group) => !group.className.includes('my-2'))).toBe(true)
    expect(
      commandGroups.every(
        (group) =>
          !group.querySelector('[data-slot="tool-group-trigger"]')?.className.includes('py-1.5')
      )
    ).toBe(true)
    expect(commandGroups.map((group) => group.textContent)).toEqual(
      expect.arrayContaining(['已运行 11 条命令', '已运行 3 条命令', '已运行 1 条命令'])
    )
    expect(renderedWaitItems).toHaveLength(3)
    expect(renderedWaitItems.every((item) => item.textContent?.includes('等待完成'))).toBe(true)

    await act(async () => {
      for (const group of commandGroups) {
        group.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
      }
    })

    const toolItems = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="tool-fallback-root"]')
    )
    expect(toolItems).toHaveLength(15)

    await act(async () => {
      for (const item of toolItems) {
        item.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]')?.click()
      }
    })

    for (const index of Array.from({ length: 15 }, (_, position) => position + 1)) {
      expect(container.textContent).toContain(`$ echo replay-exec-${index}`)
    }
  })

  it('renders a loaded tool definition in an expandable tool group', async () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      genericToolPart('loaded-1', 'codex_loaded_tool', 'loadedTool', {
        name: 'functions.exec'
      })
    ]

    act(() => {
      root.render(<App />)
    })

    const group = container.querySelector<HTMLElement>(
      '[data-slot="tool-group-unit"][data-tool-group-kind="generic"]'
    )
    expect(group?.textContent).toContain('已加载 1 个工具定义')
    expect(container.querySelector('[data-slot="compact-entry-unit"]')).toBeNull()

    await act(async () => {
      group?.querySelector<HTMLButtonElement>('[data-slot="tool-group-trigger"]')?.click()
    })

    expect(group?.textContent).toContain('functions.exec')
    expect(group?.querySelector('[data-slot="tool-fallback-root"]')).not.toBeNull()
  })

  it('embeds thinking in a completed tool group and restores its summary when done', async () => {
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

    const toolGroupTrigger = container.querySelector(
      '[data-slot="tool-group-unit"] [data-slot="tool-group-trigger"]'
    )

    expect(toolGroupTrigger?.textContent).toContain('正在思考')
    expect(
      toolGroupTrigger?.querySelector('[data-slot="tool-group-trigger-shimmer"]')
    ).not.toBeNull()
    expect(toolGroupTrigger?.querySelector('[data-slot="tool-group-trigger-icon"]')).toBeNull()
    expect(container.querySelector('[data-slot="message-thinking-unit"]')).toBeNull()
    expect(
      container.querySelector('[data-slot="aui_assistant-message-content"]')?.className
    ).not.toContain('shimmer')
    expect(container.querySelector('[data-slot="aui_assistant-message-footer"]')).not.toBeNull()

    await act(async () => {
      if (toolGroupTrigger instanceof HTMLButtonElement) toolGroupTrigger.click()
    })

    expect(container.textContent).toContain('已编辑：edit.ts')

    threadMessageState.message.status = { type: 'complete' }
    act(() => {
      root.render(<App />)
    })

    const completedTrigger = container.querySelector(
      '[data-slot="tool-group-unit"] [data-slot="tool-group-trigger"]'
    )
    expect(completedTrigger?.textContent).not.toContain('正在思考')
    expect(completedTrigger?.textContent).toContain('已编辑 1 个文件')
    expect(completedTrigger?.querySelector('[data-slot="tool-group-trigger-shimmer"]')).toBeNull()
    expect(completedTrigger?.querySelector('[data-slot="tool-group-trigger-icon"]')).not.toBeNull()
  })

  it('shows thinking after the latest completed exploration despite earlier unphased text', () => {
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

    const thinkingExplorationCards = Array.from(
      container.querySelectorAll(
        '[data-slot="tool-group-unit"][data-tool-group-kind="exploration"]'
      )
    ).filter((trigger) => trigger.textContent?.includes('正在思考'))

    expect(thinkingExplorationCards).toHaveLength(0)
    const reasoningTrigger = container.querySelector('[data-slot="reasoning-group-trigger"]')
    expect(reasoningTrigger).not.toBeNull()
    expect(reasoningTrigger?.textContent).toBe('已处理 · 耗时 0 秒')
    expect(reasoningTrigger?.querySelector('.shimmer')).toBeNull()
    const thinkingPlaceholder = container.querySelector('[data-slot="message-thinking-unit"]')
    expect(thinkingPlaceholder).not.toBeNull()
    expect(thinkingPlaceholder?.querySelector('.shimmer')).not.toBeNull()
    expect(container.textContent).toContain('正在思考')
    expect(container.textContent).toContain('先查到一部分')
  })

  it('hides thinking when unphased visible text follows the latest completed tool', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      commandToolPart('search-1', 'search', { status: { type: 'complete' } }),
      { type: 'text', text: '这是最终分析' }
    ]

    act(() => {
      root.render(<App />)
    })

    expect(container.querySelector('[data-slot="message-thinking-unit"]')).toBeNull()
    expect(container.textContent).not.toContain('正在思考')
    expect(container.textContent).toContain('这是最终分析')
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

    expect(container.textContent).toContain('正在探索')
    expect(container.textContent).toContain('2 次搜索')
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

  it('loads historical commentary as a collapsed group and keeps the final answer outside', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      {
        type: 'reasoning',
        text: '**Inspecting ProjectGate card conditions**\n\n<!-- -->',
        status: { type: 'complete' }
      },
      { type: 'text', text: '我会先读取仓库记录，再收集实际证据。' },
      { type: 'text', text: '## 结论\n\n根因已经确认。' }
    ]
    threadMessageState.externalMessages = [
      {
        parts: [
          { type: 'reasoning' },
          {
            type: 'text',
            providerMetadata: messagePhaseMetadata('commentary', 1250)
          },
          {
            type: 'text',
            providerMetadata: messagePhaseMetadata('final_answer', 1250)
          }
        ]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const reasoning = container.querySelector('[data-slot="reasoning-group"]')

    expect(container.querySelectorAll('[data-slot="reasoning-group"]')).toHaveLength(1)
    expect(reasoning?.getAttribute('data-state')).toBe('closed')
    expect(reasoning?.textContent).toContain('已处理 · 耗时 1 秒')
    expect(reasoning?.textContent).not.toContain('根因已经确认')
    expect(container.textContent).toContain('根因已经确认')
    expect(container.textContent).not.toContain('Inspecting ProjectGate card conditions')
  })

  it('formats completed reasoning duration as seconds, minutes, or hours', () => {
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.message.content = [
      { type: 'text', text: '我会先读取仓库记录，再收集实际证据。' },
      { type: 'text', text: '## 结论\n\n根因已经确认。' }
    ]

    const renderWithDuration = (durationMs: number): string | null | undefined => {
      threadMessageState.externalMessages = [
        {
          metadata: { codexTurnDurationMs: durationMs },
          parts: [
            { type: 'text', providerMetadata: messagePhaseMetadata('commentary') },
            { type: 'text', providerMetadata: messagePhaseMetadata('final_answer') }
          ]
        }
      ]

      act(() => {
        root.render(<App />)
      })

      return container.querySelector('[data-slot="reasoning-group-trigger"]')?.textContent
    }

    expect(renderWithDuration(1250)).toBe('已处理 · 耗时 1 秒')
    expect(renderWithDuration(65_000)).toBe('已处理 · 耗时 1 分 5 秒')
    expect(renderWithDuration(3_661_000)).toBe('已处理 · 耗时 1 小时 1 分 1 秒')
  })

  it('shows a live stopwatch while reasoning and freezes the locally measured duration', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T08:00:00.000Z'))
    threadMessageState.message.role = 'assistant'
    threadMessageState.message.status = { type: 'running' }
    threadMessageState.message.content = [
      { type: 'text', text: '我会先读取仓库记录，再收集实际证据。' },
      commandToolPart('timer-search', 'search', { status: { type: 'running' } })
    ]
    threadMessageState.externalMessages = [
      {
        parts: [{ type: 'text', providerMetadata: messagePhaseMetadata('commentary') }]
      }
    ]

    act(() => {
      root.render(<App />)
    })

    const runningLabel = (): string | null | undefined =>
      container.querySelector('[data-slot="reasoning-group-trigger"]')?.textContent

    expect(runningLabel()).toBe('已处理 · 耗时 0 秒')

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(runningLabel()).toBe('已处理 · 耗时 2 秒')

    threadMessageState.message.status = { type: 'complete' }
    threadMessageState.externalMessages = []

    act(() => {
      root.render(<App />)
    })

    expect(runningLabel()).toBe('已处理 · 耗时 2 秒')
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

function toolGroup(kind: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-slot="tool-group-unit"][data-tool-group-kind="${kind}"]`
  )
}

function explorationToolGroup(): HTMLElement | null {
  return toolGroup('exploration')
}

function modelSelectorItemWithText(text: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="model-selector-item"]')
  ).find((item) => item.textContent?.includes(text))
}

function messagePhaseMetadata(
  phase: 'commentary' | 'final_answer',
  turnDurationMs?: number
): Record<string, unknown> {
  return {
    '@janole/ai-sdk-provider-codex-asp': {
      messagePhase: phase,
      ...(turnDurationMs === undefined ? {} : { turnDurationMs })
    }
  }
}

function codeCommentDirective(
  title: string,
  body: string,
  file: string,
  line: number,
  priority?: number
): string {
  const priorityAttribute = priority === undefined ? '' : ` priority=${priority}`
  return `::code-comment{title="${title}" body="${body}" file="${file}" start=${line}${priorityAttribute}}`
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
