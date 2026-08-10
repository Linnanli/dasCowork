// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const target = {
  conversationId: 'conversation',
  threadId: 'thread',
  hostId: 'local',
  cwd: '/repo',
  gitRoot: '/repo'
}

vi.mock('./GitRepositoryProvider', () => ({
  useGitRepository: () => ({ target })
}))

import { LocalGitReviewProvider, useLocalGitReview } from './LocalGitReviewProvider'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('LocalGitReviewProvider', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('queues independent feedback, replaces matching feedback, and tracks a repository workflow', async () => {
    await act(async () => {
      root.render(
        <LocalGitReviewProvider>
          <FeedbackProbe />
        </LocalGitReviewProvider>
      )
    })

    await act(async () => buttonWithText('Show first')?.click())
    await act(async () => buttonWithText('Show second')?.click())
    expect(toastMessages()).toEqual(['First result', 'Second result'])

    await act(async () => buttonWithText('Replace first')?.click())
    expect(toastMessages()).toEqual(['Second result', 'Updated first result'])

    await act(async () => buttonWithText('Begin commit')?.click())
    expect(document.body.textContent).toContain('committing')
    await act(async () => buttonWithText('Switch branch')?.click())
    expect(document.body.textContent).toContain('switching-branch')
    await act(async () => buttonWithText('Finish commit')?.click())
    expect(document.body.textContent).toContain('idle')
  })
})

function FeedbackProbe(): React.JSX.Element {
  const {
    finishGitWorkflow,
    getGitWorkflow,
    notifyGitOperation,
    startGitWorkflow,
    updateGitWorkflow
  } = useLocalGitReview()
  const [started, setStarted] = useState(false)
  const workflow = getGitWorkflow(target)

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          notifyGitOperation({ id: 'first', tone: 'success', message: 'First result' })
        }
      >
        Show first
      </button>
      <button
        type="button"
        onClick={() => notifyGitOperation({ tone: 'error', message: 'Second result' })}
      >
        Show second
      </button>
      <button
        type="button"
        onClick={() =>
          notifyGitOperation({ id: 'first', tone: 'info', message: 'Updated first result' })
        }
      >
        Replace first
      </button>
      <button
        type="button"
        onClick={() =>
          setStarted(startGitWorkflow(target, { kind: 'commit-and-switch', phase: 'committing' }))
        }
      >
        Begin commit
      </button>
      <button
        type="button"
        disabled={!started}
        onClick={() =>
          updateGitWorkflow(target, { kind: 'commit-and-switch', phase: 'switching-branch' })
        }
      >
        Switch branch
      </button>
      <button
        type="button"
        disabled={!started}
        onClick={() => {
          finishGitWorkflow(target)
          setStarted(false)
        }}
      >
        Finish commit
      </button>
      <output>{workflow?.phase ?? 'idle'}</output>
    </div>
  )
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text
  )
}

function toastMessages(): string[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>('[data-slot="local-git-operation-toast"]')
  ].map((toast) => toast.textContent?.replace('Dismiss', '').trim() ?? '')
}
