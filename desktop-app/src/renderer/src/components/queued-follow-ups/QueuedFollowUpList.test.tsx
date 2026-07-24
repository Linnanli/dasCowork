// @vitest-environment jsdom

import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createVitestPlanAssertionRecorder,
  planAssertionsForScenarios
} from '../../../../../scripts/lib/test-plan-assertions.mjs'

import type { QueuedFollowUpItem } from '../../../../shared/codexFollowUpApi'
import { QueuedFollowUpList, type QueuedFollowUpEditContext } from './QueuedFollowUpList'
import { QueuedFollowUpPausedBanner } from './QueuedFollowUpPausedBanner'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const uiAssertionIds = [
  '错误、取消与重试 UI 正确',
  '历史与已显示内容保留',
  '可访问性、脱敏和 Composer 状态正确'
]
const { planAssert } = createVitestPlanAssertionRecorder(expect)

async function assertUiPlanEvidence(
  scenarioIds: readonly string[],
  assertion: () => void | Promise<void>
): Promise<void> {
  const record = planAssertionsForScenarios(scenarioIds, planAssert)
  for (const assertionId of uiAssertionIds) {
    await record(assertionId, assertion)
  }
}

describe('queued follow-up components', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    if (!globalThis.PointerEvent) {
      globalThis.PointerEvent = MouseEvent as typeof PointerEvent
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('E09/E27/F20 renders summaries and labels every queue action for assistive technology', () => {
    const failedItem = {
      ...createItem('two', 'Second message'),
      status: 'paused-failed',
      pause: { kind: 'send-failed', userMessage: 'Attachment is missing.' }
    } satisfies QueuedFollowUpItem

    act(() => {
      root.render(
        <QueuedFollowUpList
          items={[createItem('one', 'First message'), failedItem]}
          defaultMode="queue"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onSteer={vi.fn()}
          onRetry={vi.fn()}
          onToggleQueueing={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[aria-label="Queued follow-ups"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="queued-follow-up-items"]')?.children).toHaveLength(
      2
    )
    expect(button('引导第 1 条排队消息')).not.toBeNull()
    expect(button('重试第 2 条排队消息')).not.toBeNull()
    expect(button('重试第 2 条排队消息').disabled).toBe(true)
    expect(button('删除第 1 条排队消息')).not.toBeNull()
    expect(button('拖动第 1 条排队消息').draggable).toBe(true)
    expect(container.textContent).toContain('Attachment is missing.')
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('F18 presents a paused-failed queue message as recoverable queue state', async () => {
    const failedItem = {
      ...createItem('failed', 'Queued follow-up'),
      status: 'paused-failed',
      pause: { kind: 'send-failed', userMessage: 'The queued asset is unavailable.' }
    } satisfies QueuedFollowUpItem

    act(() => {
      root.render(<QueuedFollowUpPausedBanner item={failedItem} />)
    })

    expect(
      container.querySelector('[data-slot="queued-follow-up-paused-banner"]')?.getAttribute('role')
    ).toBe('status')
    expect(container.textContent).toContain('Follow-up needs attention')
    expect(container.textContent).toContain('The queued asset is unavailable.')
    await assertUiPlanEvidence(['F18'], () => {
      expect(
        container.querySelector('[data-slot="queued-follow-up-paused-banner"]')?.getAttribute('role')
      ).toBe('status')
      expect(container.textContent).toContain('Follow-up needs attention')
      expect(container.textContent).toContain('The queued asset is unavailable.')
    })
  })

  it('E02 passes edit placement to the composer callback and moves focus to the composer', async () => {
    const onEdit = vi.fn<(item: QueuedFollowUpItem, context: QueuedFollowUpEditContext) => void>()

    act(() => {
      root.render(
        <FocusHarness
          initialItems={[createItem('one', 'First'), createItem('two', 'Second')]}
          onEdit={onEdit}
        />
      )
    })

    await openMenu(1)
    await click(menuItem('编辑消息'))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), {
      beforeId: 'two',
      afterId: undefined
    })
    expect(document.activeElement?.getAttribute('data-composer-focus')).toBe('true')
  })

  it('E02/E05/E27 keeps focus stable after delete, keyboard reorder, retry, and steer operations', async () => {
    act(() => {
      root.render(
        <FocusHarness
          initialItems={[
            createItem('one', 'First'),
            {
              ...createItem('two', 'Second'),
              status: 'paused-failed',
              pause: { kind: 'send-failed', userMessage: 'Failed.' }
            }
          ]}
        />
      )
    })

    await openMenu(1)
    await click(menuItem('下移'))
    expect(document.activeElement?.getAttribute('data-item-id')).toBe('one')

    await click(button('重试第 1 条排队消息'))
    expect(document.activeElement?.getAttribute('data-item-id')).toBe('two')

    await click(button('删除第 1 条排队消息'))
    expect(document.activeElement?.getAttribute('data-item-id')).toBe('one')

    await click(button('引导第 1 条排队消息'))
    expect(document.activeElement?.getAttribute('data-item-id')).toBe('one')

    await click(button('删除第 1 条排队消息'))
    expect(document.activeElement?.getAttribute('data-composer-focus')).toBe('true')
  })

  it('E02/E05 keeps queue mode in the more menu and steers the selected item', async () => {
    const onSteer = vi.fn()
    const onToggleQueueing = vi.fn()

    act(() => {
      root.render(
        <QueuedFollowUpList
          items={[createItem('one', 'First'), createItem('two', 'Second')]}
          defaultMode="queue"
          onDelete={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onSteer={onSteer}
          onRetry={vi.fn()}
          onToggleQueueing={onToggleQueueing}
        />
      )
    })

    await click(button('引导第 2 条排队消息'))
    expect(onSteer).toHaveBeenCalledWith('two')

    await openMenu(1)
    await click(menuItem('关闭排队'))
    expect(onToggleQueueing).toHaveBeenCalledOnce()
  })

  it('returns focus to the more trigger when Escape closes its menu', async () => {
    act(() => {
      root.render(
        <QueuedFollowUpList
          items={[createItem('one', 'First')]}
          defaultMode="queue"
          onDelete={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onSteer={vi.fn()}
          onRetry={vi.fn()}
          onToggleQueueing={vi.fn()}
        />
      )
    })

    await openMenu(1)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(button('第 1 条排队消息的更多操作'))
  })

  it('E10/E11/F20 shows a paused queue banner and exposes Resume', async () => {
    const onResume = vi.fn()
    const item = {
      ...createItem('one', 'First'),
      status: 'paused-interrupted',
      pause: { kind: 'interrupted', userMessage: 'Stopped by you.' }
    } satisfies QueuedFollowUpItem

    act(() => {
      root.render(<QueuedFollowUpPausedBanner item={item} onResume={onResume} />)
    })

    expect(container.textContent).toContain('Queue paused after interruption')
    await click(button('Resume follow-up queue'))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('E28 disables dragging and moving a paused queue head', async () => {
    const pausedHead = {
      ...createItem('one', 'First'),
      status: 'paused-failed',
      pause: { kind: 'send-failed', userMessage: 'Failed.' }
    } satisfies QueuedFollowUpItem

    act(() => {
      root.render(
        <QueuedFollowUpList
          items={[pausedHead, createItem('two', 'Second')]}
          defaultMode="queue"
          onDelete={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onSteer={vi.fn()}
          onRetry={vi.fn()}
          onToggleQueueing={vi.fn()}
        />
      )
    })

    expect(button('拖动第 1 条排队消息').disabled).toBe(true)
    await openMenu(1)
    expect(menuItem('下移').hasAttribute('data-disabled')).toBe(true)
    expect(button('拖动第 2 条排队消息').draggable).toBe(true)
  })

  function button(label: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!element) throw new Error(`Button not found: ${label}`)
    return element
  }

  async function openMenu(position: number): Promise<void> {
    const trigger = button(`第 ${position} 条排队消息的更多操作`)
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
      )
      await Promise.resolve()
    })
  }

  function menuItem(label: string): HTMLElement {
    const element = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((candidate) => candidate.textContent?.trim() === label)
    if (!element) throw new Error(`Menu item not found: ${label}`)
    return element
  }
})

function FocusHarness({
  initialItems,
  onEdit = vi.fn()
}: {
  initialItems: QueuedFollowUpItem[]
  onEdit?: (item: QueuedFollowUpItem, context: QueuedFollowUpEditContext) => void
}): React.JSX.Element {
  const [items, setItems] = useState(initialItems)
  const composerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <QueuedFollowUpList
        items={items}
        defaultMode="queue"
        onEdit={onEdit}
        onDelete={(itemId) => setItems((current) => current.filter((item) => item.id !== itemId))}
        onMoveUp={(itemId) =>
          setItems((current) =>
            moveItem(current, itemId, Math.max(0, itemIndex(current, itemId) - 1))
          )
        }
        onMoveDown={(itemId) =>
          setItems((current) =>
            moveItem(current, itemId, Math.min(current.length - 1, itemIndex(current, itemId) + 1))
          )
        }
        onSteer={vi.fn()}
        onRetry={vi.fn()}
        onToggleQueueing={vi.fn()}
        onRequestComposerFocus={() => composerRef.current?.focus()}
      />
      <button ref={composerRef} type="button" data-composer-focus="true">
        Composer
      </button>
    </>
  )
}

function itemIndex(items: QueuedFollowUpItem[], itemId: string): number {
  return items.findIndex((item) => item.id === itemId)
}

function moveItem(
  items: QueuedFollowUpItem[],
  itemId: string,
  destination: number
): QueuedFollowUpItem[] {
  const source = itemIndex(items, itemId)
  if (source < 0 || source === destination) return items
  const next = [...items]
  const [item] = next.splice(source, 1)
  next.splice(destination, 0, item)
  return next
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

function createItem(id: string, text: string): QueuedFollowUpItem {
  return {
    id,
    conversationKey: 'conversation-a',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    preferredMode: 'queue',
    status: 'queued',
    message: {
      id: `message-${id}`,
      text,
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
