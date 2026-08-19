import { describe, expect, it } from 'vitest'

import { parseConversationStreamTrace, percentile } from './conversationStreamTrace'

describe('conversation stream trace parser', () => {
  it('keeps only events whose start timestamp is inside the measured window', () => {
    const metrics = parseConversationStreamTrace({
      startMarkName: 'start',
      endMarkName: 'end',
      samples: [
        { domNodes: 10, heapBytes: 100 },
        { domNodes: 14, heapBytes: 90 },
        { domNodes: 12, heapBytes: 120 }
      ],
      traceEvents: [
        mark('start', 1_000),
        event('RunTask', 999, 200_000),
        event('RunTask', 1_100, 80_000),
        event('RunTask', 1_900, 70_000),
        event('RunTask', 2_000, 120_000),
        event('Layout', 1_200, 6_000),
        event('Paint', 1_300, 5_000),
        event('BeginFrame', 1_400),
        event('DroppedFrame', 1_500),
        event('MinorGC', 1_600, 2_500),
        event('MajorGC', 1_700, 7_500),
        mark('end', 2_000)
      ]
    })

    expect(metrics.runTasksOver50ms).toBe(2)
    expect(metrics.totalBlockingMs).toBe(50)
    expect(metrics.layout).toEqual({ count: 1, p95Ms: 6, maxMs: 6 })
    expect(metrics.paint).toEqual({ count: 1, p95Ms: 5, maxMs: 5 })
    expect(metrics.beginFrames).toBe(1)
    expect(metrics.droppedFrames).toBe(1)
    expect(metrics.minorGcMs).toBe(2.5)
    expect(metrics.majorGcMs).toBe(7.5)
    expect(metrics.domNodes).toEqual({ start: 10, end: 12, peak: 14 })
    expect(metrics.heapBytes).toEqual({ start: 100, end: 120, peak: 120 })
  })

  it('does not double count nested tasks', () => {
    const metrics = parseConversationStreamTrace({
      startMarkName: 'start',
      endMarkName: 'end',
      traceEvents: [
        mark('start', 100),
        event('RunTask', 110, 150_000),
        event('EvaluateScript', 120, 100_000),
        event('FunctionCall', 130, 90_000),
        mark('end', 300)
      ]
    })

    expect(metrics.runTasksOver50ms).toBe(1)
    expect(metrics.totalBlockingMs).toBe(100)
  })

  it('handles missing optional metrics and empty windows', () => {
    const metrics = parseConversationStreamTrace({
      startMarkName: 'start',
      endMarkName: 'end',
      traceEvents: [mark('start', 100), mark('end', 200)]
    })

    expect(metrics).toEqual({
      runTasksOver50ms: 0,
      totalBlockingMs: 0,
      layout: { count: 0, p95Ms: 0, maxMs: 0 },
      paint: { count: 0, p95Ms: 0, maxMs: 0 },
      droppedFrames: 0,
      beginFrames: 0,
      minorGcMs: 0,
      majorGcMs: 0,
      domNodes: { start: 0, end: 0, peak: 0 },
      heapBytes: { start: 0, end: 0, peak: 0 }
    })
  })

  it('returns zero metrics when timing marks are absent', () => {
    const metrics = parseConversationStreamTrace({
      startMarkName: 'missing-start',
      endMarkName: 'missing-end',
      traceEvents: [event('RunTask', 100, 200_000)]
    })

    expect(metrics.runTasksOver50ms).toBe(0)
    expect(metrics.totalBlockingMs).toBe(0)
  })

  it('uses nearest-rank percentile values', () => {
    expect(percentile([5, 1, 9, 3], 50)).toBe(3)
    expect(percentile([5, 1, 9, 3], 95)).toBe(9)
    expect(percentile([], 95)).toBe(0)
  })
})

function mark(name: string, ts: number): { name: string; ph: string; ts: number } {
  return { name, ph: 'R', ts }
}

function event(
  name: string,
  ts: number,
  dur = 0
): { name: string; ph: string; ts: number; dur: number } {
  return { name, ph: 'X', ts, dur }
}
