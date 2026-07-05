import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerState = vi.hoisted(() => ({
  listModels: vi.fn(),
  shutdown: vi.fn(),
  startThread: vi.fn()
}))

vi.mock('./codexAspProvider', () => ({
  createCodexAspProvider: vi.fn(() => ({
    listModels: providerState.listModels,
    shutdown: providerState.shutdown,
    startThread: providerState.startThread,
    chat: vi.fn()
  }))
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app',
    isPackaged: false
  }
}))

import {
  CodexChatRuntimeService,
  type CodexPortLike,
  type CodexChatRuntimeServiceOptions,
  type ModelCatalogLike
} from './codexChatRuntimeService'
import { ProjectStore, createDefaultProjectState } from './projects/ProjectStore'

class FakePort implements CodexPortLike {
  readonly messages: unknown[] = []
  private handler: ((event: { data: unknown }) => void) | undefined

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  on(event: 'message', handler: (event: { data: unknown }) => void): void {
    if (event === 'message') this.handler = handler
  }

  start(): void {
    return undefined
  }

  close(): void {
    return undefined
  }

  emit(message: unknown): void {
    this.handler?.({ data: message })
  }
}

async function* emptyUiMessageStream(): AsyncGenerator<never, void, unknown> {
  if (process.env['NODE_ENV'] === '__unused_test_stream__') {
    yield undefined as never
  }
}

type RuntimeStreamTextInput = {
  resumeThreadId?: string
  onThreadStarted?: (thread: { threadId: string; threadPath?: string }) => void | Promise<void>
}

function streamTextWithStartedThread(
  threadId = 'thread-prestarted'
): NonNullable<CodexChatRuntimeServiceOptions['streamText']> {
  return vi.fn(async (input: RuntimeStreamTextInput) => {
    await input.onThreadStarted?.({ threadId })
    return {
      toUIMessageStream: () => emptyUiMessageStream()
    }
  }) as NonNullable<CodexChatRuntimeServiceOptions['streamText']>
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('CodexChatRuntimeService', () => {
  beforeEach(() => {
    providerState.listModels.mockReset()
    providerState.shutdown.mockReset()
    providerState.startThread.mockReset()
    providerState.startThread.mockResolvedValue({ threadId: 'thread-prestarted' })
  })

  it('returns catalog unavailability instead of provider fallback when catalog is configured', async () => {
    providerState.listModels.mockResolvedValue([])
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn().mockResolvedValue({
        models: [],
        unavailableReason: 'backend down'
      }),
      setSelectedModel: vi.fn().mockRejectedValue(new Error('model catalog unavailable')),
      resolveClientModel: vi.fn().mockRejectedValue(new Error('model catalog unavailable'))
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog
    })

    await expect(service.listModels()).resolves.toEqual({
      models: [],
      unavailableReason: 'backend down'
    })
    expect(providerState.listModels).not.toHaveBeenCalled()
  })

  it('keeps catalog validation required after an unavailable catalog list', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    providerState.listModels.mockResolvedValue([
      {
        id: 'provider-model',
        displayName: 'Provider Model',
        inputModalities: ['text'],
        isDefault: true
      }
    ])
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn().mockResolvedValue({
        models: [],
        unavailableReason: 'backend down'
      }),
      setSelectedModel: vi.fn().mockRejectedValue(new Error('model catalog unavailable')),
      resolveClientModel: vi.fn().mockRejectedValue(new Error('model catalog unavailable'))
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog,
      streamText
    })

    await service.listModels()
    await expect(service.setSelectedModel('provider-model')).rejects.toThrow(
      'model catalog unavailable'
    )
    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'provider-model'
      },
      port
    )

    expect(modelCatalog.setSelectedModel).toHaveBeenCalledWith('provider-model')
    expect(modelCatalog.resolveClientModel).toHaveBeenCalledWith('provider-model')
    expect(streamText).not.toHaveBeenCalled()
    expect(port.messages).toEqual([{ type: 'error', error: 'model catalog unavailable' }])
  })

  it('uses the configured model catalog for listModels', async () => {
    const catalogList = {
      models: [
        {
          id: 'backend-model',
          displayName: 'Backend Model',
          description: 'Catalog model',
          inputModalities: ['text'],
          isDefault: true
        }
      ],
      selectedModelId: 'backend-model'
    }
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn().mockResolvedValue(catalogList),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog
    })

    await expect(service.listModels()).resolves.toEqual(catalogList)
    expect(modelCatalog.listModels).toHaveBeenCalledTimes(1)
  })

  it('uses the catalog selected model when chat requests omit modelId', async () => {
    const port = new FakePort()
    const streamText = streamTextWithStartedThread()
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn().mockResolvedValue({
        models: [
          {
            id: 'backend-default',
            displayName: 'Backend Default',
            inputModalities: ['text'],
            isDefault: true
          }
        ],
        selectedModelId: 'backend-default'
      }),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn().mockResolvedValue({
        model_id: 'backend-default',
        display_name: 'Backend Default',
        description: null,
        provider: 'openai',
        capabilities: ['text'],
        is_default: true,
        api_base_url: 'https://models.example.test',
        api_key: 'secret',
        api_format: 'openai',
        source: 'admin'
      })
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText,
      modelCatalog
    })

    await service.listModels()
    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: []
      },
      port
    )

    expect(modelCatalog.resolveClientModel).toHaveBeenCalledWith('backend-default')
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'backend-default'
      })
    )
    expect(port.messages).toEqual([{ type: 'finish', threadId: 'thread-prestarted' }])
  })

  it('rejects chat request modelId values that are not in the catalog', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn(),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn().mockRejectedValue(new Error('Unknown model: unknown-model'))
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText,
      modelCatalog
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'unknown-model'
      },
      port
    )

    expect(streamText).not.toHaveBeenCalled()
    expect(port.messages).toEqual([{ type: 'error', error: 'Unknown model: unknown-model' }])
  })

  it('streams with the canonical catalog model id after resolving padded request values', async () => {
    const port = new FakePort()
    const streamText = streamTextWithStartedThread()
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn(),
      setSelectedModel: vi.fn(),
      resolveClientModel: vi.fn().mockResolvedValue({
        model_id: 'canonical-model',
        display_name: 'Canonical Model',
        description: null,
        provider: 'openai',
        capabilities: ['text'],
        is_default: false,
        api_base_url: 'https://models.example.test',
        api_key: 'secret',
        api_format: 'openai',
        source: 'admin'
      })
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText,
      modelCatalog
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: '  canonical-model  '
      },
      port
    )

    expect(modelCatalog.resolveClientModel).toHaveBeenCalledWith('  canonical-model  ')
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'canonical-model'
      })
    )
    expect(port.messages).toEqual([{ type: 'finish', threadId: 'thread-prestarted' }])
  })

  it('delegates selected model validation to the catalog', async () => {
    const modelCatalog: ModelCatalogLike = {
      listModels: vi.fn(),
      setSelectedModel: vi.fn().mockResolvedValue({ selectedModelId: 'backend-model' }),
      resolveClientModel: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      modelCatalog
    })

    await expect(service.setSelectedModel('backend-model')).resolves.toEqual({
      selectedModelId: 'backend-model'
    })
    expect(modelCatalog.setSelectedModel).toHaveBeenCalledWith('backend-model')
  })

  it('streams UI message chunks to the provided port', async () => {
    const port = new FakePort()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async (input: RuntimeStreamTextInput) => {
        await input.onThreadStarted?.({ threadId: 'thread-prestarted' })
        return {
          toUIMessageStream: () =>
            (async function* () {
              yield { type: 'text-start', id: 'text-1' }
              yield { type: 'text-delta', id: 'text-1', delta: 'hello' }
              yield { type: 'text-end', id: 'text-1' }
            })()
        }
      }
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test'
      },
      port
    )

    expect(port.messages).toEqual([
      { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
      { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' } },
      { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
  })

  it('forwards model stream error messages as terminal IPC errors', async () => {
    const port = new FakePort()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async () => ({
        toUIMessageStream: (options: { onError?: (error: unknown) => string } = {}) =>
          (async function* () {
            yield {
              type: 'error',
              errorText:
                options.onError?.(new Error('The free quota has been exhausted.')) ??
                'missing error'
            }
          })()
      })
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test'
      },
      port
    )

    expect(port.messages).toEqual([{ type: 'error', error: 'The free quota has been exhausted.' }])
  })

  it('normalizes project assignment to the app-server thread id from stream metadata', async () => {
    const port = new FakePort()
    const projectStore = ProjectStore.inMemory(createDefaultProjectState())
    const projectService = {
      resolveNewThreadTarget: vi.fn().mockResolvedValue({
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo'],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'local',
          projectId: 'project-1',
          cwd: '/repo'
        }
      }),
      resolveExistingThreadTarget: vi.fn()
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      projectService,
      projectStore,
      streamText: async (input: RuntimeStreamTextInput) => {
        await input.onThreadStarted?.({ threadId: 'thread-prestarted' })
        return {
          toUIMessageStream: () =>
            (async function* () {
              yield {
                type: 'text-start',
                id: 'text-1',
                providerMetadata: {
                  '@janole/ai-sdk-provider-codex-asp': {
                    threadId: 'thread-real'
                  }
                }
              } as never
            })()
        }
      }
    })

    await service.startChatStream(
      {
        chatId: 'chat-temp',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: {
          projectSelection: { projectKind: 'local', projectId: 'project-1' }
        }
      },
      port
    )

    await flushAsyncWork()
    await expect(projectStore.getState()).resolves.toMatchObject({
      threadProjectAssignments: {
        'thread-real': {
          projectKind: 'local',
          projectId: 'project-1',
          cwd: '/repo'
        }
      }
    })
    expect((await projectStore.getState()).threadProjectAssignments).not.toHaveProperty('chat-temp')
    expect((await projectStore.getState()).threadProjectAssignments).not.toHaveProperty(
      'thread-prestarted'
    )
  })

  it('does not fail the chat stream when project assignment persistence fails', async () => {
    const port = new FakePort()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const projectService = {
      resolveNewThreadTarget: vi.fn().mockResolvedValue({
        hostId: 'local',
        cwd: '/repo',
        workspaceRoots: ['/repo'],
        workspaceKind: 'project',
        projectAssignment: {
          projectKind: 'local',
          projectId: 'project-1',
          cwd: '/repo'
        }
      }),
      resolveExistingThreadTarget: vi.fn()
    }
    const projectStore = {
      getState: vi.fn(async () => createDefaultProjectState()),
      setState: vi.fn(async () => {
        throw new Error('project store unavailable')
      })
    }
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      projectService,
      projectStore,
      streamText: async (input: RuntimeStreamTextInput) => {
        input.onThreadStarted?.({ threadId: 'thread-prestarted' })
        return {
          toUIMessageStream: () =>
            (async function* () {
              yield { type: 'text-start', id: 'text-1' } as never
            })()
        }
      }
    })

    try {
      await service.startChatStream(
        {
          chatId: 'chat-1',
          trigger: 'submit-message',
          messages: [],
          modelId: 'gpt-test',
          body: {
            projectSelection: { projectKind: 'local', projectId: 'project-1' }
          }
        },
        port
      )
      await flushAsyncWork()

      expect(projectStore.setState).toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(
        'failed to persist project assignment for thread-prestarted',
        expect.any(Error)
      )
      expect(port.messages).toEqual([
        { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
        { type: 'finish', threadId: 'thread-prestarted' }
      ])
    } finally {
      consoleError.mockRestore()
    }
  })

  it('publishes the provider-started thread before streaming first-turn chunks', async () => {
    const port = new FakePort()
    const events: string[] = []
    const onThreadIdAvailable = vi.fn((threadId: string) => {
      events.push(`callback:${threadId}`)
    })
    const streamText = vi.fn(
      async ({ resumeThreadId, onThreadStarted }: RuntimeStreamTextInput) => {
        expect(resumeThreadId).toBeUndefined()
        events.push('streamText')
        await onThreadStarted?.({ threadId: 'thread-prestarted' })
        return {
          toUIMessageStream: () =>
            (async function* () {
              events.push('chunk')
              yield { type: 'text-start', id: 'text-1' } as never
            })()
        }
      }
    )
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })

    const result = await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '你好,你是什么模型?' }]
          }
        ],
        modelId: 'gpt-test'
      },
      port,
      { onThreadIdAvailable }
    )

    expect(events).toEqual(['streamText', 'callback:thread-prestarted', 'chunk'])
    expect(providerState.startThread).not.toHaveBeenCalled()
    expect(onThreadIdAvailable).toHaveBeenCalledWith(
      'thread-prestarted',
      expect.objectContaining({
        threadId: 'thread-prestarted',
        title: '你好,你是什么模型?'
      })
    )
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeThreadId: undefined,
        onThreadStarted: expect.any(Function)
      })
    )
    expect(result.threadId).toBe('thread-prestarted')
    expect(port.messages).toEqual([
      { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
  })

  it('fires onThreadIdAvailable when resumed stream metadata reports a different thread id', async () => {
    const port = new FakePort()
    const onThreadIdAvailable = vi.fn()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async () => ({
        toUIMessageStream: () =>
          (async function* () {
            yield {
              type: 'text-start',
              id: 'text-1',
              providerMetadata: {
                '@janole/ai-sdk-provider-codex-asp': {
                  threadId: 'thread-real',
                  turnId: 'turn-real'
                }
              }
            } as never
            yield { type: 'text-end', id: 'text-1' } as never
          })()
      })
    })

    const result = await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { threadId: 'thread-old' }
      },
      port,
      { onThreadIdAvailable }
    )

    expect(providerState.startThread).not.toHaveBeenCalled()
    expect(onThreadIdAvailable).toHaveBeenCalledTimes(1)
    expect(onThreadIdAvailable).toHaveBeenCalledWith('thread-real')
    expect(result.threadId).toBe('thread-real')
    expect(port.messages.at(-1)).toEqual({ type: 'finish', threadId: 'thread-real' })
  })

  it('tracks and interrupts an active conversation by conversation id or app-server thread id', async () => {
    const port = new FakePort()
    const metadataSeen = deferred()
    const abortSeen = deferred()
    let capturedAbortSignal: AbortSignal | undefined
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async ({ abortSignal }) => {
        capturedAbortSignal = abortSignal
        abortSignal.addEventListener('abort', () => abortSeen.resolve(), { once: true })
        return {
          toUIMessageStream: () =>
            (async function* () {
              yield {
                type: 'text-start',
                id: 'text-1',
                providerMetadata: {
                  '@janole/ai-sdk-provider-codex-asp': {
                    threadId: 'thread-real',
                    turnId: 'turn-real'
                  }
                }
              } as never
              metadataSeen.resolve()
              await abortSeen.promise
            })()
        }
      }
    })

    const streamPromise = service.startChatStream(
      {
        chatId: 'chat-temp',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1' }
      },
      port
    )

    await metadataSeen.promise
    expect(service.isConversationRunning('conversation-1')).toBe(true)
    expect(service.isConversationRunning('thread-real')).toBe(true)

    service.interruptConversation('conversation-1')
    await abortSeen.promise
    expect(capturedAbortSignal?.aborted).toBe(true)
    await streamPromise

    expect(service.isConversationRunning('conversation-1')).toBe(false)
    expect(service.isConversationRunning('thread-real')).toBe(false)
    expect(port.messages.at(-1)).toEqual({ type: 'aborted' })
  })

  it('sends stream errors to the provided port', async () => {
    const port = new FakePort()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async () => {
        throw new Error('boom')
      }
    })

    await service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test'
      },
      port
    )

    expect(port.messages).toEqual([{ type: 'error', error: 'boom' }])
  })

  it('broadcasts approval requests', async () => {
    const listener = vi.fn()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      }
    })
    service.onApprovalRequest(listener)

    const requestPromise = service.requestApprovalForTest({
      kind: 'command',
      params: { command: 'pwd' }
    })
    const request = listener.mock.calls[0][0]
    service.respondApproval(request.id, { action: 'approve' })

    await expect(requestPromise).resolves.toEqual({ action: 'approve' })
  })
})
