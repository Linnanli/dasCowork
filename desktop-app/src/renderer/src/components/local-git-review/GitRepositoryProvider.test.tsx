// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitRepositoryTarget } from '../../../../shared/localGitApi'
import { GitRepositoryProvider, useGitRepository } from './GitRepositoryProvider'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const target: GitRepositoryTarget = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

describe('GitRepositoryProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveRepositoryTarget: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resolveRepositoryTarget = vi.fn(async () => ({ status: 'ready', target }))
    window.desktopApp = {
      git: {
        resolveRepositoryTarget
      }
    } as never
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('loads one repository target per identity and shares it across consumers', async () => {
    let resolveTarget:
      | ((value: { status: 'ready'; target: GitRepositoryTarget }) => void)
      | undefined
    resolveRepositoryTarget.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTarget = resolve
      })
    )
    await act(async () => {
      root.render(
        <GitRepositoryProvider identity={{ conversationId: 'conversation', threadId: 'thread' }}>
          <StatusConsumer slot="first" />
          <StatusConsumer slot="second" />
        </GitRepositoryProvider>
      )
    })

    expect(container.textContent).toContain('first:loading')

    await act(async () => {
      resolveTarget?.({ status: 'ready', target })
    })
    await flush()

    expect(resolveRepositoryTarget).toHaveBeenCalledTimes(1)
    expect(resolveRepositoryTarget).toHaveBeenCalledWith({
      target: { conversationId: 'conversation', threadId: 'thread' }
    })
    expect(container.textContent).toContain('first:ready:/repo')
    expect(container.textContent).toContain('second:ready:/repo')

    await act(async () => {
      root.render(
        <GitRepositoryProvider identity={{ conversationId: 'conversation', threadId: 'thread' }}>
          <StatusConsumer slot="first" />
        </GitRepositoryProvider>
      )
    })

    expect(resolveRepositoryTarget).toHaveBeenCalledTimes(1)
  })

  it('exposes unavailable state and retries the same identity', async () => {
    resolveRepositoryTarget
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'Not a Git repository' })
      .mockResolvedValueOnce({ status: 'ready', target })

    await act(async () => {
      root.render(
        <GitRepositoryProvider identity={{ conversationId: 'conversation', threadId: 'thread' }}>
          <StatusConsumer slot="status" />
          <RetryButton />
        </GitRepositoryProvider>
      )
    })
    await flush()

    expect(container.textContent).toContain('status:unavailable:Not a Git repository')

    await act(async () => {
      container.querySelector('button')?.click()
    })
    await flush()

    expect(resolveRepositoryTarget).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('status:ready:/repo')
  })

  it('exposes resolve errors and retries after failures', async () => {
    resolveRepositoryTarget
      .mockRejectedValueOnce(new Error('resolver failed'))
      .mockResolvedValueOnce({ status: 'ready', target })

    await act(async () => {
      root.render(
        <GitRepositoryProvider identity={{ conversationId: 'conversation', threadId: 'thread' }}>
          <StatusConsumer slot="status" />
          <RetryButton />
        </GitRepositoryProvider>
      )
    })
    await flush()

    expect(container.textContent).toContain('status:error:resolver failed')

    await act(async () => {
      container.querySelector('button')?.click()
    })
    await flush()

    expect(resolveRepositoryTarget).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('status:ready:/repo')
  })
})

function StatusConsumer({ slot }: { slot: string }): React.JSX.Element {
  const repository = useGitRepository()
  const detail =
    repository.status === 'ready'
      ? repository.target.gitRoot
      : repository.status === 'unavailable'
        ? repository.reason
        : repository.status === 'error'
          ? repository.error.message
          : ''
  return (
    <div>
      {slot}:{repository.status}
      {detail ? `:${detail}` : ''}
    </div>
  )
}

function RetryButton(): React.JSX.Element {
  const repository = useGitRepository()
  return (
    <button type="button" onClick={repository.retry}>
      Retry
    </button>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
