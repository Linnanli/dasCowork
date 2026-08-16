let sequence = 0

export function measureReviewPerformance<T>(name: string, work: () => T): T {
  const start = markReviewPerformance(`${name}:start`)
  try {
    return work()
  } finally {
    measureFromMark(name, start)
  }
}

export function markReviewPerformance(name: string): string | undefined {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return undefined
  const mark = `review:${name}:${++sequence}`
  performance.mark(mark)
  return mark
}

export function measureFromMark(name: string, start: string | undefined): void {
  if (!start || typeof performance === 'undefined' || typeof performance.measure !== 'function')
    return
  performance.measure(`review:${name}`, start)
}
