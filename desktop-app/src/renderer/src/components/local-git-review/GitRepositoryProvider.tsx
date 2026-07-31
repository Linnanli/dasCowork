/* eslint-disable react-hooks/set-state-in-effect, react-refresh/only-export-components -- effects synchronize the resolved Git target with the active conversation; provider and hook share one context boundary. */
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

import type { GitConversationTarget, GitRepositoryTarget } from '../../../../shared/localGitApi'

type GitRepositoryState =
  | { status: 'idle'; target?: undefined; reason?: undefined; error?: undefined }
  | { status: 'loading'; target?: undefined; reason?: undefined; error?: undefined }
  | { status: 'ready'; target: GitRepositoryTarget; reason?: undefined; error?: undefined }
  | { status: 'unavailable'; target?: undefined; reason: string; error?: undefined }
  | { status: 'error'; target?: undefined; reason?: undefined; error: Error }

type GitRepositoryContextValue = GitRepositoryState & {
  retry(): void
}

const GitRepositoryContext = createContext<GitRepositoryContextValue>({
  status: 'idle',
  retry: () => undefined
})

export function GitRepositoryProvider({
  identity,
  children
}: {
  identity?: GitConversationTarget
  children: ReactNode
}): React.JSX.Element {
  const [state, setState] = useState<GitRepositoryState>({ status: 'idle' })
  const [retryRevision, setRetryRevision] = useState(0)
  const cacheRef = useRef(new Map<string, GitRepositoryState>())
  const requestIdRef = useRef(0)
  const identityKey = repositoryIdentityKey(identity)

  const retry = useCallback(() => {
    if (!identityKey) return
    cacheRef.current.delete(identityKey)
    setRetryRevision((revision) => revision + 1)
  }, [identityKey])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!identity || !identityKey) {
      setState({ status: 'idle' })
      return
    }

    const cached = cacheRef.current.get(identityKey)
    if (cached) {
      setState(cached)
      return
    }

    setState({ status: 'loading' })
    void window.desktopApp.git
      .resolveRepositoryTarget({ target: identity })
      .then((result) => {
        if (requestId !== requestIdRef.current) return
        const next: GitRepositoryState =
          result.status === 'ready'
            ? { status: 'ready', target: result.target }
            : { status: 'unavailable', reason: result.reason }
        cacheRef.current.set(identityKey, next)
        setState(next)
      })
      .catch((cause) => {
        if (requestId !== requestIdRef.current) return
        const error = cause instanceof Error ? cause : new Error('Unable to resolve Git repository')
        const next: GitRepositoryState = { status: 'error', error }
        cacheRef.current.set(identityKey, next)
        setState(next)
      })
  }, [identity, identityKey, retryRevision])

  const value = useMemo(() => ({ ...state, retry }), [retry, state])

  return <GitRepositoryContext.Provider value={value}>{children}</GitRepositoryContext.Provider>
}

export function useGitRepository(): GitRepositoryContextValue {
  return useContext(GitRepositoryContext)
}

function repositoryIdentityKey(identity: GitConversationTarget | undefined): string | undefined {
  if (!identity?.conversationId) return undefined
  return `${identity.conversationId}\u0000${identity.threadId ?? ''}`
}
