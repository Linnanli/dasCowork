// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createVitestPlanAssertionRecorder } from '../../../../scripts/lib/test-plan-assertions.mjs'

import type {
  ConversationFollowUpState,
  DesktopCodexFollowUpApi,
  FollowUpSteerPendingAck,
  FollowUpQueueChangeEvent,
  QueuedFollowUpItem
} from '../../../shared/codexFollowUpApi'
import {
  useConversationFollowUps,
  type ConversationFollowUpsController
} from './useConversationFollowUps'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { planAssert } = createVitestPlanAssertionRecorder(expect)

const raceAssertionIds = [
  'claim、接受与队列结算至多一次',
  '正确的恢复、暂停或拒绝状态',
  'terminal 和 active run 不被竞态覆盖'
]

async function assertRacePlanEvidence(
  scenarioIds: readonly string[],
  assertion: () => void | Promise<void>
): Promise<void> {
  for (const scenarioId of scenarioIds) {
    for (const assertionId of raceAssertionIds) {
      await planAssert({ scenarioId, assertionId, assertion })
    }
  }
}

describe('useConversationFollowUps', () => {
  let container: HTMLDivElement
  let root: Root
  let controller: ConversationFollowUpsController | null
  let listener: ((event: FollowUpQueueChangeEvent) => void) | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    controller = null
    listener = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('loads the conversation, subscribes to newer revisions, and ignores stale snapshots', async () => {
    const initial = createState(1, [createItem('one')])
    const updated = createState(2, [createItem('one'), createItem('two')])
    const unsubscribe = vi.fn()
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      subscribe: (nextListener) => {
        listener = nextListener
        return unsubscribe
      }
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })

    expect(controller?.loading).toBe(false)
    expect(controller?.items.map((item) => item.id)).toEqual(['one'])

    await act(async () => {
      listener?.({ revision: 2, state: updated })
      listener?.({ revision: 1, state: initial })
    })

    expect(controller?.items.map((item) => item.id)).toEqual(['one', 'two'])
    act(() => root.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    root = createRoot(container)
  })

  it('B12/B14 collapses rapid duplicate Steer actions and ignores stale revisions while acknowledgement is pending', async () => {
    const item = createItem('one')
    const initial = createState(1, [item])
    const steering = createState(3, [{ ...item, status: 'steering' }])
    const stale = createState(2, [item])
    const acknowledgement = deferred<FollowUpSteerPendingAck>()
    const steerItem = vi.fn(() => acknowledgement.promise)
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      steerItem,
      subscribe: (nextListener) => {
        listener = nextListener
        return vi.fn()
      }
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })

    let firstSteer!: Promise<FollowUpSteerPendingAck>
    let secondSteer!: Promise<FollowUpSteerPendingAck>
    act(() => {
      firstSteer = controller!.steerItem('one')
      secondSteer = controller!.steerItem('one')
    })

    expect(steerItem).toHaveBeenCalledTimes(1)
    expect(steerItem).toHaveBeenCalledWith('conversation-a', 'one')
    expect(controller?.pendingItemIds).toEqual(new Set(['one']))

    await act(async () => {
      listener?.({ revision: 3, state: steering })
      listener?.({ revision: 2, state: stale })
    })
    expect(controller?.state?.revision).toBe(3)
    expect(controller?.items[0]?.status).toBe('steering')

    acknowledgement.resolve({
      delivery: 'pending-ack',
      clientUserMessageId: 'one',
      targetTurnId: 'turn-one',
      state: steering
    })
    await act(async () => {
      await Promise.all([firstSteer, secondSteer])
    })

    expect(steerItem).toHaveBeenCalledTimes(1)
    expect(controller?.pendingItemIds.size).toBe(0)
    await assertRacePlanEvidence(['B12', 'B14'], () => {
      expect(steerItem).toHaveBeenCalledTimes(1)
      expect(steerItem).toHaveBeenCalledWith('conversation-a', 'one')
      expect(controller?.state?.revision).toBe(3)
      expect(controller?.items[0]?.status).toBe('steering')
      expect(controller?.pendingItemIds.size).toBe(0)
    })
  })

  it('persists default mode optimistically and routes item actions through the API', async () => {
    const initial = createState(1, [createItem('one'), createItem('two')])
    const reordered = createState(2, [createItem('two'), createItem('one')])
    const setDefaultMode = vi.fn().mockResolvedValue(undefined)
    const enqueue = vi.fn().mockResolvedValue(initial)
    const reorder = vi.fn().mockResolvedValue(reordered)
    const steerItem = vi.fn().mockResolvedValue({
      ...reordered,
      revision: 3,
      items: [{ ...reordered.items[0], status: 'steering' }]
    } satisfies ConversationFollowUpState)
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      setDefaultMode,
      enqueue,
      reorder,
      steerItem
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })
    await act(async () => controller?.setDefaultMode('steer'))
    expect(controller?.defaultMode).toBe('steer')
    expect(setDefaultMode).toHaveBeenCalledWith('steer')

    await act(async () => controller?.enqueue(initial.items[0].message))
    expect(enqueue).toHaveBeenCalledWith('conversation-a', initial.items[0].message, 'steer')

    await act(async () => controller?.moveDown('one'))
    expect(reorder).toHaveBeenCalledWith('conversation-a', 'one', { afterId: 'two' })
    expect(controller?.items.map((item) => item.id)).toEqual(['two', 'one'])

    await act(async () => controller?.steerItem('two'))
    expect(steerItem).toHaveBeenCalledWith('conversation-a', 'two')
    expect(controller?.pendingItemIds.size).toBe(0)
    expect(controller?.announcement).toBe('正在用这条消息引导当前任务。')
  })

  it('reserves, commits, and cancels Composer editing through the stable item id', async () => {
    const item = createItem('one')
    const initial = createState(1, [item])
    const editing = {
      ...initial,
      revision: 2,
      items: [{ ...item, status: 'editing' as const }]
    }
    const beginEdit = vi.fn().mockResolvedValue({
      state: editing,
      message: {
        id: item.id,
        parts: [{ type: 'text', text: item.message.text }],
        contextReferences: [],
        trustedContext: item.message.trustedContext
      }
    })
    const commitEdit = vi.fn().mockResolvedValue({ ...initial, revision: 3 })
    const cancelEdit = vi.fn().mockResolvedValue({ ...initial, revision: 4 })
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      beginEdit,
      commitEdit,
      cancelEdit
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })

    let prepared: Awaited<ReturnType<ConversationFollowUpsController['beginEdit']>> | undefined
    await act(async () => {
      prepared = await controller?.beginEdit('one')
    })
    expect(prepared?.message.id).toBe('one')
    expect(controller?.items[0]?.status).toBe('editing')

    await act(async () => controller?.commitEdit('one', item.message))
    expect(commitEdit).toHaveBeenCalledWith('conversation-a', 'one', item.message)

    await act(async () => controller?.cancelEdit('one'))
    expect(cancelEdit).toHaveBeenCalledWith('conversation-a', 'one')
  })

  it('announces an uncertain Steer result without reporting a definite failure', async () => {
    const item = createItem('one')
    const initial = createState(1, [item])
    const uncertain = createState(2, [
      {
        ...item,
        status: 'paused-recovery-uncertain',
        pause: {
          kind: 'recovery-uncertain',
          userMessage: 'The steer may already have been accepted.'
        }
      }
    ])
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      steerItem: vi.fn().mockResolvedValue({
        delivery: 'pending-ack',
        clientUserMessageId: 'one',
        targetTurnId: 'turn-one',
        state: uncertain
      })
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })
    await act(async () => controller?.steerItem('one'))

    expect(controller?.error).toBeNull()
    expect(controller?.items[0]?.status).toBe('paused-recovery-uncertain')
    expect(controller?.announcement).toBe('引导结果尚未确认，队列已安全暂停。')
  })

  it('reports load and action errors without losing the current queue', async () => {
    const initial = createState(1, [createItem('one')])
    const retry = vi.fn().mockRejectedValue(new Error('still offline'))
    const api = createApi({
      getState: vi.fn().mockResolvedValue(initial),
      retry
    })

    await act(async () => {
      root.render(
        <Probe api={api} onController={(nextController) => (controller = nextController)} />
      )
    })

    await act(async () => {
      await expect(controller?.retry('one')).rejects.toThrow('still offline')
    })

    expect(controller?.items).toHaveLength(1)
    expect(controller?.error).toBe('still offline')
    expect(controller?.announcement).toContain('still offline')
  })
})

function Probe({
  api,
  onController
}: {
  api: DesktopCodexFollowUpApi
  onController: (controller: ConversationFollowUpsController) => void
}): null {
  const controller = useConversationFollowUps({ api, conversationKey: 'conversation-a' })
  useEffect(() => {
    onController(controller)
  }, [controller, onController])
  return null
}

function createApi(overrides: Partial<DesktopCodexFollowUpApi>): DesktopCodexFollowUpApi {
  const state = createState(1, [])
  return {
    getState: vi.fn().mockResolvedValue(state),
    enqueue: vi.fn().mockResolvedValue(state),
    edit: vi.fn().mockResolvedValue(state),
    beginEdit: vi.fn(),
    commitEdit: vi.fn().mockResolvedValue(state),
    cancelEdit: vi.fn().mockResolvedValue(state),
    delete: vi.fn().mockResolvedValue(state),
    reorder: vi.fn().mockResolvedValue(state),
    requestSendNow: vi.fn().mockResolvedValue(state),
    retry: vi.fn().mockResolvedValue(state),
    resume: vi.fn().mockResolvedValue(state),
    clear: vi.fn().mockResolvedValue(state),
    setDefaultMode: vi.fn().mockResolvedValue(undefined),
    prepareNextTurn: vi.fn(),
    materializeItem: vi.fn(),
    steerItem: vi.fn().mockImplementation(async (_conversationKey, itemId) => ({
      delivery: 'pending-ack',
      clientUserMessageId: itemId,
      targetTurnId: 'turn-one',
      state
    })),
    steerNext: vi.fn().mockImplementation(async (_conversationKey, itemId) => ({
      delivery: 'pending-ack',
      clientUserMessageId: itemId,
      targetTurnId: 'turn-one',
      state
    })),
    subscribe: vi.fn(() => vi.fn()),
    ...overrides
  }
}

function createState(revision: number, items: QueuedFollowUpItem[]): ConversationFollowUpState {
  return {
    version: 2,
    revision,
    conversationKey: 'conversation-a',
    defaultMode: 'queue',
    archived: false,
    items
  }
}

function createItem(id: string): QueuedFollowUpItem {
  return {
    id,
    conversationKey: 'conversation-a',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    preferredMode: 'queue',
    status: 'queued',
    message: {
      id: `message-${id}`,
      text: `Follow-up ${id}`,
      attachments: [],
      contextReferences: [],
      trustedContext: {
        conversationId: 'conversation-a',
        hostId: 'local',
        cwd: '/workspace',
        workspaceRoots: ['/workspace']
      }
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
