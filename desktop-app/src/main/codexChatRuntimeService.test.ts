import { describe, expect, it, vi } from 'vitest'

const providerState = vi.hoisted(() => ({
  listModels: vi.fn(),
  shutdown: vi.fn()
}))

vi.mock('./codexAspProvider', () => ({
  createCodexAspProvider: vi.fn(() => ({
    listModels: providerState.listModels,
    shutdown: providerState.shutdown,
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
  type ModelCatalogLike
} from './codexChatRuntimeService'

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

describe('CodexChatRuntimeService', () => {
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
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
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
        capabilities: ['text'],
        is_default: true,
        api_base_url: 'https://models.example.test',
        api_key: 'secret'
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
    expect(port.messages).toEqual([{ type: 'finish' }])
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
    const streamText = vi.fn(async () => ({
      toUIMessageStream: () => emptyUiMessageStream()
    }))
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
    expect(port.messages).toEqual([{ type: 'finish' }])
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
      streamText: async () => ({
        toUIMessageStream: () =>
          (async function* () {
            yield { type: 'text-start', id: 'text-1' }
            yield { type: 'text-delta', id: 'text-1', delta: 'hello' }
            yield { type: 'text-end', id: 'text-1' }
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

    expect(port.messages).toEqual([
      { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
      { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' } },
      { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } },
      { type: 'finish' }
    ])
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
