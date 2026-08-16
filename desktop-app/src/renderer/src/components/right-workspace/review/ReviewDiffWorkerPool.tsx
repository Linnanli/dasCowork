import {
  WorkerPoolContextProvider,
  useWorkerPool,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions
} from '@pierre/diffs/react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { markReviewPerformance } from './reviewPerformance'
import type { ReviewWorkspacePreferences } from './reviewWorkspaceTypes'

type Props = {
  children: ReactNode
  lineDiffType: ReviewWorkspacePreferences['lineDiffType']
}

export function ReviewDiffWorkerPool({ children, lineDiffType }: Props): React.JSX.Element {
  const [workerFailed, setWorkerFailed] = useState(false)
  const onWorkerFailure = useCallback((): void => {
    markReviewPerformance('diff-worker-fallback')
    setWorkerFailed(true)
  }, [])
  const highlighterOptions = useMemo<WorkerInitializationRenderOptions>(
    () => ({ lineDiffType }),
    [lineDiffType]
  )
  const poolOptions = useMemo<WorkerPoolOptions | undefined>(() => {
    if (workerFailed || typeof Worker === 'undefined') return undefined
    return {
      poolSize: 2,
      totalASTLRUCacheSize: 64,
      workerFactory: () => createDiffWorker(onWorkerFailure)
    }
  }, [onWorkerFailure, workerFailed])

  if (!poolOptions) return <>{children}</>
  return (
    <WorkerPoolContextProvider highlighterOptions={highlighterOptions} poolOptions={poolOptions}>
      <ReviewDiffWorkerOptions lineDiffType={lineDiffType} onFailure={onWorkerFailure}>
        {children}
      </ReviewDiffWorkerOptions>
    </WorkerPoolContextProvider>
  )
}

function ReviewDiffWorkerOptions({
  children,
  lineDiffType,
  onFailure
}: {
  children: ReactNode
  lineDiffType: ReviewWorkspacePreferences['lineDiffType']
  onFailure(): void
}): React.JSX.Element {
  const pool = useWorkerPool()
  useEffect(() => {
    if (!pool) return
    void pool.setRenderOptions({ lineDiffType }).catch(onFailure)
  }, [lineDiffType, onFailure, pool])
  return <>{children}</>
}

function createDiffWorker(onFailure: () => void): Worker {
  const worker = new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
    type: 'module'
  })
  worker.addEventListener('error', onFailure, { once: true })
  worker.addEventListener('messageerror', onFailure, { once: true })
  return worker
}
