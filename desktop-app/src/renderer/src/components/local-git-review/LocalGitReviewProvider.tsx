/* eslint-disable react-refresh/only-export-components -- the review context and hook form one state boundary. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import type { GitRepositoryTarget, LocalGitReviewSource } from '../../../../shared/localGitApi'
import { Button } from '@/components/ui/button'
import { useGitRepository } from './GitRepositoryProvider'
import { LocalGitReviewPanel } from './LocalGitReviewPanel'

export type LocalGitReviewLastTurn = {
  turnId: string
  files: Array<{
    path: string
    diff?: string
    additions: number
    deletions: number
  }>
}

export type LocalGitOperationFeedback = {
  id?: string
  tone: 'success' | 'info' | 'error'
  message: string
}

export type LocalGitWorkflow = {
  kind: 'commit-and-switch'
  phase: 'committing' | 'switching-branch'
}

type LocalGitReviewContextValue = {
  target?: GitRepositoryTarget
  openReview(source?: LocalGitReviewSource, lastTurn?: LocalGitReviewLastTurn): void
  closeReview(): void
  notifyGitOperation(feedback: LocalGitOperationFeedback): void
  startGitWorkflow(target: GitRepositoryTarget, workflow: LocalGitWorkflow): boolean
  updateGitWorkflow(target: GitRepositoryTarget, workflow: LocalGitWorkflow): void
  finishGitWorkflow(target: GitRepositoryTarget): void
  getGitWorkflow(target: GitRepositoryTarget): LocalGitWorkflow | undefined
}

const LocalGitReviewContext = createContext<LocalGitReviewContextValue>({
  openReview: () => undefined,
  closeReview: () => undefined,
  notifyGitOperation: () => undefined,
  startGitWorkflow: () => true,
  updateGitWorkflow: () => undefined,
  finishGitWorkflow: () => undefined,
  getGitWorkflow: () => undefined
})

type RenderedOperationFeedback = LocalGitOperationFeedback & {
  key: string
}

export function LocalGitReviewProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { target } = useGitRepository()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<LocalGitReviewSource>({ type: 'unstaged' })
  const [lastTurn, setLastTurn] = useState<LocalGitReviewLastTurn>()
  const [operationFeedbacks, setOperationFeedbacks] = useState<RenderedOperationFeedback[]>([])
  const [gitWorkflows, setGitWorkflows] = useState<Record<string, LocalGitWorkflow>>({})
  const triggerRef = useRef<HTMLElement | null>(null)
  const feedbackSequenceRef = useRef(0)
  const feedbackTimeoutsRef = useRef<Map<string, number>>(new Map())
  const gitWorkflowsRef = useRef<Record<string, LocalGitWorkflow>>({})

  const openReview = useCallback(
    (
      nextSource: LocalGitReviewSource = { type: 'unstaged' },
      nextLastTurn?: LocalGitReviewLastTurn
    ) => {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setSource(nextSource)
      setLastTurn(nextSource.type === 'last-turn' ? nextLastTurn : undefined)
      setOpen(true)
    },
    []
  )
  const closeReview = useCallback(() => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])
  const dismissGitOperationFeedback = useCallback((key: string) => {
    const timeout = feedbackTimeoutsRef.current.get(key)
    if (timeout !== undefined) {
      window.clearTimeout(timeout)
      feedbackTimeoutsRef.current.delete(key)
    }
    setOperationFeedbacks((current) => current.filter((feedback) => feedback.key !== key))
  }, [])
  const notifyGitOperation = useCallback(
    (feedback: LocalGitOperationFeedback) => {
      const key = feedback.id ?? `git-operation-${feedbackSequenceRef.current++}`
      const existingTimeout = feedbackTimeoutsRef.current.get(key)
      if (existingTimeout !== undefined) window.clearTimeout(existingTimeout)
      setOperationFeedbacks((current) => [
        ...current.filter((currentFeedback) => currentFeedback.key !== key),
        { ...feedback, key }
      ])
      feedbackTimeoutsRef.current.set(
        key,
        window.setTimeout(() => dismissGitOperationFeedback(key), 6_000)
      )
    },
    [dismissGitOperationFeedback]
  )
  useEffect(
    () => () => {
      for (const timeout of feedbackTimeoutsRef.current.values()) window.clearTimeout(timeout)
      feedbackTimeoutsRef.current.clear()
    },
    []
  )

  const startGitWorkflow = useCallback(
    (workflowTarget: GitRepositoryTarget, workflow: LocalGitWorkflow): boolean => {
      const key = gitWorkflowKey(workflowTarget)
      if (gitWorkflowsRef.current[key]) return false
      gitWorkflowsRef.current = { ...gitWorkflowsRef.current, [key]: workflow }
      setGitWorkflows(gitWorkflowsRef.current)
      return true
    },
    []
  )
  const updateGitWorkflow = useCallback(
    (workflowTarget: GitRepositoryTarget, workflow: LocalGitWorkflow) => {
      const key = gitWorkflowKey(workflowTarget)
      if (!gitWorkflowsRef.current[key]) return
      gitWorkflowsRef.current = { ...gitWorkflowsRef.current, [key]: workflow }
      setGitWorkflows(gitWorkflowsRef.current)
    },
    []
  )
  const finishGitWorkflow = useCallback((workflowTarget: GitRepositoryTarget) => {
    const key = gitWorkflowKey(workflowTarget)
    if (!gitWorkflowsRef.current[key]) return
    const remainingWorkflows = { ...gitWorkflowsRef.current }
    delete remainingWorkflows[key]
    gitWorkflowsRef.current = remainingWorkflows
    setGitWorkflows(remainingWorkflows)
  }, [])
  const getGitWorkflow = useCallback(
    (workflowTarget: GitRepositoryTarget) => gitWorkflows[gitWorkflowKey(workflowTarget)],
    [gitWorkflows]
  )
  const value = useMemo(
    () => ({
      target,
      openReview,
      closeReview,
      notifyGitOperation,
      startGitWorkflow,
      updateGitWorkflow,
      finishGitWorkflow,
      getGitWorkflow
    }),
    [
      closeReview,
      finishGitWorkflow,
      getGitWorkflow,
      notifyGitOperation,
      openReview,
      startGitWorkflow,
      target,
      updateGitWorkflow
    ]
  )

  return (
    <LocalGitReviewContext.Provider value={value}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {children}
        <LocalGitReviewPanel
          open={open}
          source={source}
          target={target}
          lastTurn={lastTurn}
          onClose={closeReview}
          onSourceChange={setSource}
          onGitOperationFeedback={notifyGitOperation}
        />
        {operationFeedbacks.length > 0 ? (
          <div className="fixed right-4 bottom-4 z-50 space-y-2">
            {operationFeedbacks.map((operationFeedback) => (
              <div
                key={operationFeedback.key}
                data-slot="local-git-operation-toast"
                role={operationFeedback.tone === 'error' ? 'alert' : 'status'}
                aria-live={operationFeedback.tone === 'error' ? 'assertive' : 'polite'}
                className={
                  operationFeedback.tone === 'error'
                    ? 'flex max-w-sm items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive shadow-lg'
                    : 'flex max-w-sm items-start gap-3 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg'
                }
              >
                <p className="min-w-0 flex-1">{operationFeedback.message}</p>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label="Dismiss Git operation feedback"
                  onClick={() => dismissGitOperationFeedback(operationFeedback.key)}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </LocalGitReviewContext.Provider>
  )
}

export function useLocalGitReview(): LocalGitReviewContextValue {
  return useContext(LocalGitReviewContext)
}

function gitWorkflowKey(target: GitRepositoryTarget): string {
  return JSON.stringify([target.hostId, target.cwd])
}
