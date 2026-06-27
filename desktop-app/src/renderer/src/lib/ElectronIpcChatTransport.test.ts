import { describe, expect, it, vi } from 'vitest'

import { ElectronIpcChatTransport } from './ElectronIpcChatTransport'
import type { DesktopCodexChatApi } from '../../../shared/codexIpcApi'

describe('ElectronIpcChatTransport', () => {
  it('returns a stream that yields chunks from the desktop bridge', async () => {
    let callbacks: Parameters<DesktopCodexChatApi['startChatStream']>[1] | undefined
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn((_request, nextCallbacks) => {
        callbacks = nextCallbacks
        return 'stream-1'
      }),
      abortChatStream: vi.fn()
    }
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    const stream = await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined
    })
    callbacks?.onChunk({ type: 'text-start', id: 'text-1' })
    callbacks?.onFinish()

    const reader = stream.getReader()
    const chunks: unknown[] = []
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    expect(chunks).toEqual([{ type: 'text-start', id: 'text-1' }])
    expect(bridge.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', modelId: 'gpt-test' }),
      expect.any(Object)
    )
  })

  it('aborts active stream through the desktop bridge', async () => {
    const bridge: DesktopCodexChatApi = {
      startChatStream: vi.fn(() => 'stream-1'),
      abortChatStream: vi.fn()
    }
    const abortController = new AbortController()
    const transport = new ElectronIpcChatTransport({
      chatBridge: bridge,
      getSelectedModelId: () => 'gpt-test'
    })

    await transport.sendMessages({
      chatId: 'chat-1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: abortController.signal
    })
    abortController.abort()

    expect(bridge.abortChatStream).toHaveBeenCalledWith('stream-1')
  })
})
