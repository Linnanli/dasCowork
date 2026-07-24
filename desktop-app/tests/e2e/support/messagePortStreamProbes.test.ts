import { describe, expect, it } from 'vitest'

import {
  assertMessagePortFallbackStreams,
  attachMessagePortStreamProbes,
  collectMessagePortStreamProbes,
  messagePortStreamProbesAttachmentName,
  type MessagePortStreamProbe,
  type MessagePortStreamProbePage,
  type MessagePortStreamProbeTestInfo
} from './messagePortStreamProbes'

function fallbackProbe(index: number): MessagePortStreamProbe {
  return {
    index,
    streamId: `stream-${index}`,
    threadBoundIds: [`thread-${index}`],
    turnStartedIds: [`turn-${index}`],
    textDeltaCount: 1,
    finishCount: 0,
    abortCount: 0,
    errorCount: 1,
    terminalCallbackCount: 1,
    errors: ['The chat connection was interrupted before completion.']
  }
}

function probePage(probes: MessagePortStreamProbe[]): MessagePortStreamProbePage {
  return {
    evaluate: () => Promise.resolve(probes)
  } as unknown as MessagePortStreamProbePage
}

describe('MessagePort stream probes', () => {
  it('keeps the original per-stream failure actionable and attaches probes from finally', async () => {
    const probes = Array.from({ length: 12 }, (_, index) => fallbackProbe(index))
    probes[7] = { ...probes[7], terminalCallbackCount: 2 }
    const attachments: Array<{ name: string; body: string; contentType?: string }> = []
    const testInfo = {
      attach: async (name: string, options: { body?: string; contentType?: string }) => {
        attachments.push({ name, body: String(options.body), contentType: options.contentType })
      }
    } as unknown as MessagePortStreamProbeTestInfo
    let assertionError: unknown

    try {
      assertMessagePortFallbackStreams(probes, 12)
    } catch (error) {
      assertionError = error
    } finally {
      await attachMessagePortStreamProbes(testInfo, probePage(probes))
    }

    expect(assertionError).toBeInstanceOf(Error)
    expect((assertionError as Error).message).toContain('stream index=7')
    expect((assertionError as Error).message).toContain('streamId=stream-7')
    expect((assertionError as Error).message).toContain('must settle exactly once')
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      name: messagePortStreamProbesAttachmentName,
      contentType: 'application/json'
    })
    expect(JSON.parse(attachments[0].body)).toEqual({ streams: probes })
  })

  it('attaches an unavailable reason when renderer evaluation rejects', async () => {
    const attachments: Array<{ name: string; body: string; contentType?: string }> = []
    const testInfo = {
      attach: async (name: string, options: { body?: string; contentType?: string }) => {
        attachments.push({ name, body: String(options.body), contentType: options.contentType })
      }
    } as unknown as MessagePortStreamProbeTestInfo
    const page = {
      evaluate: () => Promise.reject(new Error('renderer disconnected'))
    } as unknown as MessagePortStreamProbePage

    const result = await collectMessagePortStreamProbes(page)
    const attachedStreams = await attachMessagePortStreamProbes(testInfo, page)

    expect(result).toBe('unavailable: renderer disconnected')
    expect(attachedStreams).toBe('unavailable: renderer disconnected')
    expect(attachments).toEqual([
      {
        name: messagePortStreamProbesAttachmentName,
        contentType: 'application/json',
        body: JSON.stringify({ streams: 'unavailable: renderer disconnected' }, null, 2)
      }
    ])
  })
})
