import type { Page } from '@playwright/test'

type CdpSession = Awaited<ReturnType<Page['context']>['newCDPSession']>

export type ConversationStreamTraceMetrics = {
  runTasksOver50ms: number
  totalBlockingMs: number
  layout: DurationSummary
  paint: DurationSummary
  droppedFrames: number
  beginFrames: number
  minorGcMs: number
  majorGcMs: number
  domNodes: SampleSummary
  heapBytes: SampleSummary
}

export type DurationSummary = {
  count: number
  p95Ms: number
  maxMs: number
}

export type SampleSummary = {
  start: number
  end: number
  peak: number
}

export type ConversationStreamTraceSample = {
  domNodes: number
  heapBytes: number
}

export type ParsedTraceInput = {
  traceEvents?: readonly TraceEvent[]
  startMarkName: string
  endMarkName: string
  samples?: readonly ConversationStreamTraceSample[]
}

type TraceEvent = {
  name?: string
  ph?: string
  ts?: number
  dur?: number
  pid?: number
  tid?: number
  args?: Record<string, unknown>
}

const traceCategories = [
  'devtools.timeline',
  'blink.user_timing',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame'
].join(',')

const defaultSample = { start: 0, end: 0, peak: 0 }

export async function startConversationStreamTrace(page: Page): Promise<{
  collect: () => Promise<{ rawTrace: string; metrics: ConversationStreamTraceMetrics }>
  sample: () => Promise<ConversationStreamTraceSample>
}> {
  const client = await page.context().newCDPSession(page)
  const samples: ConversationStreamTraceSample[] = []
  const startMarkName = `conversation-stream:trace-start:${Date.now().toString(36)}`
  const endMarkName = `conversation-stream:trace-end:${Date.now().toString(36)}`

  await client.send('Performance.enable')
  await client.send('Tracing.start', {
    categories: traceCategories,
    transferMode: 'ReturnAsStream'
  })
  await page.evaluate((markName) => performance.mark(markName), startMarkName)

  const sample = async (): Promise<ConversationStreamTraceSample> => {
    const metric = await readRendererMetrics(client)
    samples.push(metric)
    return metric
  }
  await sample()

  return {
    sample,
    collect: async () => {
      await page.evaluate((markName) => performance.mark(markName), endMarkName)
      const tracingComplete = waitForTracingComplete(client)
      await client.send('Tracing.end')
      const stream = await tracingComplete
      const rawTrace = await readTraceStream(client, stream)
      await sample()
      await client.detach()
      return {
        rawTrace,
        metrics: parseConversationStreamTrace({
          traceEvents: JSON.parse(rawTrace).traceEvents,
          startMarkName,
          endMarkName,
          samples
        })
      }
    }
  }
}

export function parseConversationStreamTrace(
  input: ParsedTraceInput
): ConversationStreamTraceMetrics {
  const events = input.traceEvents ?? []
  const startMark = userTimingMark(events, input.startMarkName)
  const endMark = userTimingMark(events, input.endMarkName)
  const windowed = startMark && endMark ? eventsInWindow(events, startMark.ts, endMark.ts) : []
  const runTasks = windowed.filter((event) => event.name === 'RunTask' && durationMs(event) >= 50)
  const layouts = windowed.filter((event) => event.name === 'Layout').map(durationMs)
  const paints = windowed.filter((event) => event.name === 'Paint').map(durationMs)
  const minorGcMs = sumDurations(
    windowed.filter((event) => event.name === 'MinorGC' || event.name === 'V8.GCScavenger')
  )
  const majorGcMs = sumDurations(
    windowed.filter((event) => event.name === 'MajorGC' || event.name === 'V8.GCCompactor')
  )

  return {
    runTasksOver50ms: runTasks.length,
    totalBlockingMs: roundMs(
      runTasks.reduce((total, event) => total + Math.max(0, durationMs(event) - 50), 0)
    ),
    layout: summarizeDurations(layouts),
    paint: summarizeDurations(paints),
    droppedFrames: windowed.filter((event) => event.name === 'DroppedFrame').length,
    beginFrames: windowed.filter((event) => event.name === 'BeginFrame').length,
    minorGcMs,
    majorGcMs,
    domNodes: summarizeSamples(input.samples?.map((sample) => sample.domNodes) ?? []),
    heapBytes: summarizeSamples(input.samples?.map((sample) => sample.heapBytes) ?? [])
  }
}

function userTimingMark(events: readonly TraceEvent[], name: string): TraceEvent | undefined {
  return events.find((event) => event.name === name && typeof event.ts === 'number')
}

function eventsInWindow(
  events: readonly TraceEvent[],
  startTs: number,
  endTs: number
): TraceEvent[] {
  return events.filter((event) => {
    if (typeof event.ts !== 'number') return false
    if (event.ts < startTs || event.ts >= endTs) return false
    return event.name !== undefined
  })
}

function durationMs(event: TraceEvent): number {
  return (event.dur ?? 0) / 1_000
}

function summarizeDurations(values: readonly number[]): DurationSummary {
  return {
    count: values.length,
    p95Ms: percentile(values, 95),
    maxMs: roundMs(Math.max(0, ...values))
  }
}

function summarizeSamples(values: readonly number[]): SampleSummary {
  if (values.length === 0) return defaultSample
  return {
    start: values[0] ?? 0,
    end: values[values.length - 1] ?? 0,
    peak: Math.max(...values)
  }
}

function sumDurations(events: readonly TraceEvent[]): number {
  return roundMs(events.reduce((total, event) => total + durationMs(event), 0))
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  )
  return roundMs(sorted[index] ?? 0)
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100
}

async function readRendererMetrics(client: CdpSession): Promise<ConversationStreamTraceSample> {
  const response = await client.send('Performance.getMetrics')
  const metrics = new Map(
    response.metrics.map((metric: { name: string; value: number }) => [metric.name, metric.value])
  )
  return {
    domNodes: Math.round(metrics.get('Nodes') ?? 0),
    heapBytes: Math.round(metrics.get('JSHeapUsedSize') ?? 0)
  }
}

async function waitForTracingComplete(client: CdpSession): Promise<string> {
  return new Promise((resolve) => {
    client.once('Tracing.tracingComplete', (event: { stream: string }) => resolve(event.stream))
  })
}

async function readTraceStream(client: CdpSession, handle: string): Promise<string> {
  let result = ''
  for (;;) {
    const chunk = await client.send('IO.read', { handle })
    result += chunk.data
    if (chunk.eof) break
  }
  await client.send('IO.close', { handle })
  return result
}
