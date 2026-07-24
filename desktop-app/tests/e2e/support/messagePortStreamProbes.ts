import { expect, type Page, type TestInfo } from '@playwright/test'

import { serializeDiagnosticData } from './app'

export type MessagePortStreamProbe = {
  index: number
  streamId: string
  threadBoundIds: string[]
  turnStartedIds: string[]
  textDeltaCount: number
  finishCount: number
  abortCount: number
  errorCount: number
  terminalCallbackCount: number
  errors: string[]
}

export type MessagePortStreamProbeCollection = MessagePortStreamProbe[] | string

export type MessagePortStreamProbePage = Pick<Page, 'evaluate'>
export type MessagePortStreamProbeTestInfo = Pick<TestInfo, 'attach'>

export const messagePortStreamProbesAttachmentName = 'message-port-stream-probes.json'
export const messagePortFallbackError = 'The chat connection was interrupted before completion.'

/**
 * Reads the renderer-owned probes without allowing a failed renderer evaluation
 * to mask the original E2E assertion failure during finally cleanup.
 */
export async function collectMessagePortStreamProbes(
  page: MessagePortStreamProbePage | undefined
): Promise<MessagePortStreamProbeCollection> {
  if (!page) return 'unavailable: Electron page was not created'

  return page
    .evaluate(
      () =>
        (
          window as typeof window & {
            __e2eMessagePortStreamProbes?: MessagePortStreamProbe[]
          }
        ).__e2eMessagePortStreamProbes ?? []
    )
    .catch(
      (error: unknown) => `unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
}

export async function attachMessagePortStreamProbes(
  testInfo: MessagePortStreamProbeTestInfo,
  page: MessagePortStreamProbePage | undefined
): Promise<MessagePortStreamProbeCollection> {
  const streams = await collectMessagePortStreamProbes(page)
  await testInfo.attach(messagePortStreamProbesAttachmentName, {
    body: serializeDiagnosticData({ streams }),
    contentType: 'application/json'
  })
  return streams
}

export function assertMessagePortFallbackStreams(
  streams: MessagePortStreamProbeCollection,
  streamCount: number,
  fallbackError = messagePortFallbackError
): asserts streams is MessagePortStreamProbe[] {
  if (!Array.isArray(streams)) {
    throw new Error(`MessagePort stream probes are unavailable: ${streams}`)
  }

  expect(streams).toHaveLength(streamCount)
  expect(new Set(streams.map((stream) => stream.streamId)).size).toBe(streamCount)
  expect(new Set(streams.flatMap((stream) => stream.turnStartedIds)).size).toBe(streamCount)

  for (const stream of streams) {
    const streamLabel = `stream index=${stream.index} streamId=${stream.streamId || '<missing>'}`
    expect(stream.streamId, `${streamLabel}: stream ID must be non-empty`).not.toBe('')
    expect(stream.threadBoundIds, `${streamLabel}: thread must bind exactly once`).toHaveLength(1)
    expect(stream.turnStartedIds, `${streamLabel}: turn must start exactly once`).toHaveLength(1)
    expect(
      stream.textDeltaCount,
      `${streamLabel}: must receive a text delta`
    ).toBeGreaterThanOrEqual(1)
    expect(stream.terminalCallbackCount, `${streamLabel}: must settle exactly once`).toBe(1)
    expect(stream.finishCount, `${streamLabel}: must not finish after port failure`).toBe(0)
    expect(stream.abortCount, `${streamLabel}: must not abort after port failure`).toBe(0)
    expect(stream.errorCount, `${streamLabel}: must enter the fallback error terminal`).toBe(1)
    expect(stream.errors, `${streamLabel}: fallback error must be stable`).toEqual([fallbackError])
  }
}
