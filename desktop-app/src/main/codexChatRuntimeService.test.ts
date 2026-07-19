import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexSession } from '@janole/ai-sdk-provider-codex-asp'

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
import type { ConversationFollowUpQueueService } from './followUps/ConversationFollowUpQueueService'
import { ProjectStore, createDefaultProjectState } from './projects/ProjectStore'

class FakePort implements CodexPortLike {
  readonly messages: unknown[] = []
  started = false
  closed = false
  private handler: ((event: { data: unknown }) => void) | undefined

  constructor(
    private readonly acknowledgeThreadBinding = true,
    private readonly onPostMessage?: (message: unknown) => void
  ) {}

  postMessage(message: unknown): void {
    this.messages.push(message)
    this.onPostMessage?.(message)
    if (
      this.acknowledgeThreadBinding &&
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'thread-bound' &&
      'threadId' in message &&
      typeof message.threadId === 'string'
    ) {
      this.emit({ type: 'thread-bound-ack', threadId: message.threadId })
    }
  }

  on(event: 'message', handler: (event: { data: unknown }) => void): void {
    if (event === 'message') this.handler = handler
  }

  start(): void {
    this.started = true
  }

  close(): void {
    this.closed = true
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
  onSessionCreated?: (session: CodexSession) => void
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

async function* waitThenEnd(promise: Promise<unknown>): AsyncGenerator<never, void, unknown> {
  await promise
  if (process.env['NODE_ENV'] === '__unused_test_stream__') {
    yield undefined as never
  }
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

  it('restores app media URLs only in the model-input request copy', async () => {
    const port = new FakePort()
    let originalMessages: unknown
    const streamText = vi.fn(async () => ({
      toUIMessageStream: (options?: { originalMessages?: unknown }) => {
        originalMessages = options?.originalMessages
        return emptyUiMessageStream()
      }
    }))
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })
    const messages = [
      {
        id: 'user-image',
        role: 'user' as const,
        parts: [
          {
            type: 'file' as const,
            mediaType: 'image/png',
            url: 'app://fs/@fs/tmp/codex-clipboard.png'
          },
          { type: 'text' as const, text: 'Describe this image' }
        ]
      }
    ]

    await service.startChatStream(
      {
        chatId: 'chat-media',
        trigger: 'submit-message',
        messages,
        modelId: 'gpt-test'
      },
      port
    )

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          messages: [
            expect.objectContaining({
              parts: [
                expect.objectContaining({ url: 'file:///tmp/codex-clipboard.png' }),
                expect.objectContaining({ text: 'Describe this image' })
              ]
            })
          ]
        })
      })
    )
    expect(originalMessages).toBe(messages)
    expect(messages[0]!.parts[0]!.url).toBe('app://fs/@fs/tmp/codex-clipboard.png')
    expect(port.messages.at(-1)).toEqual({ type: 'finish', threadId: undefined })
  })

  it('rejects invalid app media URLs before invoking the provider boundary', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })

    await service.startChatStream(
      {
        chatId: 'chat-invalid-media',
        trigger: 'submit-message',
        messages: [
          {
            id: 'user-image',
            role: 'user',
            parts: [
              {
                type: 'file',
                mediaType: 'image/png',
                url: 'app://fs/@fs/tmp/%252e%252e/secret.png'
              }
            ]
          }
        ],
        modelId: 'gpt-test'
      },
      port
    )

    expect(streamText).not.toHaveBeenCalled()
    expect(port.messages).toEqual([
      { type: 'error', error: 'Invalid local media URL in model input' }
    ])
  })

  it('revalidates local path attachments before invoking the provider boundary', async () => {
    const port = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })

    await service.startChatStream(
      {
        chatId: 'chat-invalid-local-attachment',
        trigger: 'submit-message',
        messages: [
          {
            id: 'user-file',
            role: 'user',
            parts: [
              {
                type: 'file',
                mediaType: 'application/vnd.dascowork.local-file',
                filename: 'missing.txt',
                url: 'file:///definitely-missing-dascowork-runtime.txt'
              }
            ]
          }
        ],
        modelId: 'gpt-test'
      },
      port
    )

    expect(streamText).not.toHaveBeenCalled()
    expect(port.messages).toEqual([
      {
        type: 'error',
        error: 'Invalid local attachment “missing.txt”: path does not exist or is not readable'
      }
    ])
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
    expect(port.messages).toEqual([
      { type: 'thread-bound', threadId: 'thread-prestarted' },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
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
    expect(port.messages).toEqual([
      { type: 'thread-bound', threadId: 'thread-prestarted' },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
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
      { type: 'thread-bound', threadId: 'thread-prestarted' },
      { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
      { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' } },
      { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
  })

  it('forwards completed turn duration to UI message metadata', async () => {
    const port = new FakePort()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async () => ({
        toUIMessageStream: (options) => {
          expect(
            options?.messageMetadata?.({
              part: {
                providerMetadata: {
                  '@janole/ai-sdk-provider-codex-asp': { turnDurationMs: 1250 }
                }
              }
            })
          ).toEqual({ codexTurnDurationMs: 1250 })
          return emptyUiMessageStream()
        }
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

  it('persists project assignment to the canonical app-server thread id', async () => {
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
                    threadId: 'thread-prestarted'
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
        'thread-prestarted': {
          projectKind: 'local',
          projectId: 'project-1',
          cwd: '/repo'
        }
      }
    })
    expect((await projectStore.getState()).threadProjectAssignments).not.toHaveProperty('chat-temp')
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
        await input.onThreadStarted?.({ threadId: 'thread-prestarted' })
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
        { type: 'thread-bound', threadId: 'thread-prestarted' },
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
    const postMessage = port.postMessage.bind(port)
    vi.spyOn(port, 'postMessage').mockImplementation((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'thread-bound'
      ) {
        events.push(`port:${(message as unknown as { threadId: string }).threadId}`)
      }
      postMessage(message)
    })
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

    expect(events).toEqual([
      'streamText',
      'callback:thread-prestarted',
      'port:thread-prestarted',
      'chunk'
    ])
    expect(providerState.startThread).not.toHaveBeenCalled()
    expect(onThreadIdAvailable).toHaveBeenCalledWith(
      'thread-prestarted',
      expect.objectContaining({
        threadId: 'thread-prestarted',
        originConversationId: 'chat-1',
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
      { type: 'thread-bound', threadId: 'thread-prestarted' },
      { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
      { type: 'finish', threadId: 'thread-prestarted' }
    ])
  })

  it('waits for async thread publication work before streaming first-turn chunks', async () => {
    const port = new FakePort()
    const publication = deferred()
    const events: string[] = []
    const streamText = vi.fn(async ({ onThreadStarted }: RuntimeStreamTextInput) => {
      await onThreadStarted?.({ threadId: 'thread-migrated' })
      return {
        toUIMessageStream: () =>
          (async function* () {
            events.push('chunk')
            yield { type: 'text-start', id: 'text-1' } as never
          })()
      }
    })
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })

    const run = service.startChatStream(
      {
        chatId: 'chat-local',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test'
      },
      port,
      {
        onThreadIdAvailable: async () => {
          events.push('publication-started')
          await publication.promise
          events.push('publication-finished')
        }
      }
    )

    await flushAsyncWork()
    expect(events).toEqual(['publication-started'])
    publication.resolve()
    await run
    expect(events).toEqual(['publication-started', 'publication-finished', 'chunk'])
  })

  it('releases a prepared queue lease when another turn wins the conversation race', async () => {
    const firstPort = new FakePort()
    const secondPort = new FakePort()
    const firstTurn = deferred()
    const queueItem = {
      id: 'follow-up-1',
      conversationKey: 'conversation-1',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      preferredMode: 'queue' as const,
      message: {
        id: 'follow-up-1',
        text: 'queued',
        attachments: [],
        contextReferences: [],
        trustedContext: {
          conversationId: 'conversation-1',
          hostId: 'local',
          cwd: '/repo',
          workspaceRoots: ['/repo']
        }
      },
      status: 'sending' as const,
      lease: {
        token: 'lease-1',
        operation: 'turn-start' as const,
        claimedAt: '2026-07-18T00:00:00.000Z',
        owner: 'runtime'
      }
    }
    const failClaim = vi.fn(async () => ({
      version: 1 as const,
      revision: 1,
      conversationKey: 'conversation-1',
      defaultMode: 'queue' as const,
      archived: false,
      items: []
    }))
    const followUpQueue = {
      claimHead: vi.fn(async () => ({
        conversationKey: 'conversation-1',
        item: queueItem,
        leaseToken: 'lease-1'
      })),
      materializeClaimMessage: vi.fn(async () => ({
        id: 'follow-up-1',
        parts: [{ type: 'text' as const, text: 'queued' }],
        contextReferences: [],
        trustedContext: queueItem.message.trustedContext
      })),
      failClaim
    } as unknown as ConversationFollowUpQueueService
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      followUpQueue,
      streamText: vi.fn(async () => ({
        toUIMessageStream: () => waitThenEnd(firstTurn.promise)
      }))
    })

    const activeRun = service.startChatStream(
      {
        chatId: 'chat-first',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1' }
      },
      firstPort
    )
    await flushAsyncWork()

    await service.startChatStream(
      {
        chatId: 'chat-second',
        trigger: 'submit-message',
        messageId: 'follow-up-1',
        messages: [],
        modelId: 'gpt-test',
        body: {
          conversationId: 'conversation-1',
          followUpRequest: {
            conversationKey: 'conversation-1',
            itemId: 'follow-up-1'
          }
        }
      },
      secondPort
    )

    expect(failClaim).toHaveBeenCalledWith(
      'conversation-1',
      'follow-up-1',
      'lease-1',
      expect.objectContaining({ kind: 'send-failed' })
    )
    expect(secondPort.messages).toEqual([
      {
        type: 'error',
        error: 'Conversation already has an active turn: conversation-1'
      }
    ])

    firstTurn.resolve()
    await activeRun
  })

  it('settles an accepted follow-up under its migrated thread key', async () => {
    const item = {
      id: 'follow-up-migrated',
      conversationKey: 'conversation-local',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      preferredMode: 'queue' as const,
      message: {
        id: 'follow-up-migrated',
        text: 'queued',
        attachments: [],
        contextReferences: [],
        trustedContext: {
          conversationId: 'conversation-local',
          hostId: 'local',
          cwd: '/repo',
          workspaceRoots: ['/repo']
        }
      },
      status: 'sending' as const,
      lease: {
        token: 'lease-migrated',
        operation: 'turn-start' as const,
        claimedAt: '2026-07-18T00:00:00.000Z',
        owner: 'runtime'
      }
    }
    const commitClaim = vi.fn(async () => ({
      version: 1 as const,
      revision: 3,
      conversationKey: 'thread-real',
      defaultMode: 'queue' as const,
      archived: false,
      items: []
    }))
    const followUpQueue = {
      claimHead: vi.fn(async () => ({
        conversationKey: 'conversation-local',
        item,
        leaseToken: 'lease-migrated'
      })),
      materializeClaimMessage: vi.fn(async () => ({
        id: item.id,
        parts: [{ type: 'text' as const, text: item.message.text }],
        contextReferences: [],
        trustedContext: item.message.trustedContext
      })),
      commitClaim,
      failClaim: vi.fn()
    } as unknown as ConversationFollowUpQueueService
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      followUpQueue,
      streamText: async (input: RuntimeStreamTextInput) => {
        await input.onThreadStarted?.({ threadId: 'thread-real' })
        input.onSessionCreated?.({
          threadId: 'thread-real',
          turnId: 'turn-real',
          isActive: () => true,
          steerPrompt: vi.fn(),
          injectMessage: vi.fn(),
          interrupt: vi.fn()
        })
        return { toUIMessageStream: () => emptyUiMessageStream() }
      }
    })

    await service.startChatStream(
      {
        chatId: 'conversation-local',
        trigger: 'submit-message',
        messageId: item.id,
        messages: [],
        modelId: 'gpt-test',
        body: {
          conversationId: 'conversation-local',
          followUpRequest: {
            conversationKey: 'conversation-local',
            itemId: item.id
          }
        }
      },
      new FakePort(),
      { onThreadIdAvailable: vi.fn() }
    )

    expect(commitClaim).toHaveBeenCalledWith('thread-real', 'follow-up-migrated', 'lease-migrated')
  })

  it('publishes durable thread metadata before asking the renderer to bind', async () => {
    const port = new FakePort(false)
    const onThreadIdAvailable = vi.fn()
    const streamText = vi.fn(async ({ onThreadStarted }: RuntimeStreamTextInput) => {
      await onThreadStarted?.({ threadId: 'thread-acknowledged' })
      return { toUIMessageStream: () => emptyUiMessageStream() }
    })
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })

    const running = service.startChatStream(
      {
        chatId: 'chat-acknowledged',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test'
      },
      port,
      { onThreadIdAvailable }
    )

    await vi.waitFor(() =>
      expect(port.messages).toContainEqual({
        type: 'thread-bound',
        threadId: 'thread-acknowledged'
      })
    )
    expect(onThreadIdAvailable).toHaveBeenCalledWith(
      'thread-acknowledged',
      expect.objectContaining({ threadId: 'thread-acknowledged' })
    )

    port.emit({ type: 'thread-bound-ack', threadId: 'thread-acknowledged' })
    await running
  })

  it('fails the stream when resumed metadata reports a different thread id', async () => {
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
    expect(onThreadIdAvailable).not.toHaveBeenCalled()
    expect(result.threadId).toBe('thread-old')
    expect(port.messages).not.toContainEqual({ type: 'thread-bound', threadId: 'thread-real' })
    expect(port.messages.at(-1)).toEqual({
      type: 'error',
      error: 'Active conversation thread changed from thread-old to thread-real'
    })
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

    service.interruptConversation('thread-real')
    await abortSeen.promise
    expect(capturedAbortSignal?.aborted).toBe(true)
    await streamPromise

    expect(service.isConversationRunning('conversation-1')).toBe(false)
    expect(service.isConversationRunning('thread-real')).toBe(false)
    expect(port.messages.at(-1)).toEqual({ type: 'aborted' })
  })

  it('rejects a duplicate active turn without replacing the original run', async () => {
    const firstPort = new FakePort()
    const duplicatePort = new FakePort()
    const firstEntered = deferred()
    const firstAborted = deferred()
    const streamText = vi.fn(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
      abortSignal.addEventListener('abort', () => firstAborted.resolve(), { once: true })
      firstEntered.resolve()
      return {
        toUIMessageStream: () => waitThenEnd(firstAborted.promise)
      }
    }) as NonNullable<CodexChatRuntimeServiceOptions['streamText']>
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })
    const firstRequest = service.startChatStream(
      {
        chatId: 'chat-first',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1' }
      },
      firstPort
    )

    await firstEntered.promise
    await service.startChatStream(
      {
        chatId: 'chat-duplicate',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1' }
      },
      duplicatePort
    )

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(duplicatePort.messages).toEqual([
      {
        type: 'error',
        error: 'Conversation already has an active turn: conversation-1'
      }
    ])
    expect(duplicatePort.closed).toBe(true)
    expect(service.isConversationRunning('conversation-1')).toBe(true)

    service.interruptConversation('conversation-1')
    await firstRequest
    expect(firstPort.messages.at(-1)).toEqual({ type: 'aborted' })
    expect(service.isConversationRunning('conversation-1')).toBe(false)
  })

  it('clears the active run before delivering the authoritative terminal event', async () => {
    const secondPort = new FakePort()
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })
    let secondRun: Promise<unknown> | undefined
    const firstPort = new FakePort(true, (message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'finish'
      ) {
        secondRun = service.startChatStream(
          {
            chatId: 'chat-second',
            trigger: 'submit-message',
            messages: [],
            modelId: 'gpt-test',
            body: { conversationId: 'conversation-1' }
          },
          secondPort
        )
      }
    })

    await service.startChatStream(
      {
        chatId: 'chat-first',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1' }
      },
      firstPort
    )
    await secondRun

    expect(secondPort.messages).toEqual([{ type: 'finish', threadId: undefined }])
  })

  it('steers through the exact provider session associated with the active run', async () => {
    const finish = deferred()
    const steerPrompt = vi.fn().mockResolvedValue({ turnId: 'turn-1' })
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async (input: RuntimeStreamTextInput) => {
        input.onSessionCreated?.({
          threadId: 'thread-1',
          turnId: 'turn-1',
          isActive: () => true,
          steerPrompt,
          injectMessage: vi.fn(),
          interrupt: vi.fn()
        })
        return {
          toUIMessageStream: () => waitThenEnd(finish.promise)
        }
      }
    })
    const run = service.startChatStream(
      {
        chatId: 'chat-1',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'conversation-1', threadId: 'thread-1' }
      },
      new FakePort()
    )
    await flushAsyncWork()

    await expect(
      service.steerConversation(
        'conversation-1',
        {
          id: 'follow-up-1',
          role: 'user',
          parts: [{ type: 'text', text: 'change direction' }]
        },
        'follow-up-1'
      )
    ).resolves.toEqual({ turnId: 'turn-1' })
    expect(steerPrompt).toHaveBeenCalledWith([expect.objectContaining({ role: 'user' })], {
      clientUserMessageId: 'follow-up-1'
    })

    finish.resolve()
    await run
  })

  it('allows different conversations to enter execution concurrently', async () => {
    const ports = [new FakePort(), new FakePort()]
    const entered = [deferred(), deferred()]
    const aborted = [deferred(), deferred()]
    let invocation = 0
    const streamText = vi.fn(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
      const index = invocation++
      abortSignal.addEventListener('abort', () => aborted[index].resolve(), { once: true })
      entered[index].resolve()
      return {
        toUIMessageStream: () => waitThenEnd(aborted[index].promise)
      }
    }) as NonNullable<CodexChatRuntimeServiceOptions['streamText']>
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText
    })
    const requests = ['conversation-a', 'conversation-b'].map((conversationId, index) =>
      service.startChatStream(
        {
          chatId: `chat-${index}`,
          trigger: 'submit-message',
          messages: [],
          modelId: 'gpt-test',
          body: { conversationId }
        },
        ports[index]
      )
    )

    await Promise.all(entered.map((entry) => entry.promise))
    expect(streamText).toHaveBeenCalledTimes(2)
    expect(service.isConversationRunning('conversation-a')).toBe(true)
    expect(service.isConversationRunning('conversation-b')).toBe(true)

    service.interruptConversation('conversation-a')
    service.interruptConversation('conversation-b')
    await Promise.all(requests)
    expect(ports.map((port) => port.messages.at(-1))).toEqual([
      { type: 'aborted' },
      { type: 'aborted' }
    ])
  })

  it('keeps a healthy concurrent run and global status isolated from another turn error', async () => {
    const healthyPort = new FakePort()
    const failedPort = new FakePort()
    const healthyEntered = deferred()
    const healthyAborted = deferred()
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      streamText: async ({ request, abortSignal }) => {
        if (request.body?.conversationId === 'healthy') {
          abortSignal.addEventListener('abort', () => healthyAborted.resolve(), { once: true })
          healthyEntered.resolve()
          return {
            toUIMessageStream: () => waitThenEnd(healthyAborted.promise)
          }
        }
        return {
          toUIMessageStream: () =>
            (async function* () {
              yield { type: 'error', errorText: 'turn failed' } as never
            })()
        }
      }
    })
    const healthyRequest = service.startChatStream(
      {
        chatId: 'chat-healthy',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'healthy' }
      },
      healthyPort
    )
    await healthyEntered.promise
    await flushAsyncWork()

    await service.startChatStream(
      {
        chatId: 'chat-failed',
        trigger: 'submit-message',
        messages: [],
        modelId: 'gpt-test',
        body: { conversationId: 'failed' }
      },
      failedPort
    )

    expect(failedPort.messages).toEqual([{ type: 'error', error: 'turn failed' }])
    expect(healthyPort.messages).toEqual([])
    expect(service.isConversationRunning('healthy')).toBe(true)
    expect(service.getStatus()).toMatchObject({ state: 'ready' })

    service.interruptConversation('healthy')
    await healthyRequest
    expect(healthyPort.messages).toEqual([{ type: 'aborted' }])
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

  it('passes the live-agent lifecycle observer into the active stream call', async () => {
    const port = new FakePort()
    const onAgentLifecycle = vi.fn()
    let observedCallback: unknown
    const service = new CodexChatRuntimeService({
      cwd: '/repo',
      launch: {
        command: '/bin/codex-app-server',
        args: ['--listen', 'stdio://'],
        displayBinary: '/bin/codex-app-server --listen stdio://'
      },
      onAgentLifecycle,
      streamText: async (input) => {
        observedCallback = input.onAgentLifecycle
        return { toUIMessageStream: () => emptyUiMessageStream() }
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

    expect(observedCallback).toBe(onAgentLifecycle)
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
