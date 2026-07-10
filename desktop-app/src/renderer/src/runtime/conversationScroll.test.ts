import { describe, expect, it } from 'vitest'

import { captureConversationScroll, restoreConversationScroll } from './conversationScroll'

describe('conversation scroll snapshots', () => {
  it('restores an exact historical reading position', () => {
    const element = { scrollTop: 0, scrollHeight: 1_000, clientHeight: 300 }
    restoreConversationScroll(element, { scrollTop: 240, followBottom: false })
    expect(element.scrollTop).toBe(240)
  })

  it('temporarily disables smooth scrolling while restoring a viewport', () => {
    const assignedBehaviors: string[] = []
    const style = {
      current: 'smooth',
      get scrollBehavior() {
        return this.current
      },
      set scrollBehavior(value: string) {
        this.current = value
        assignedBehaviors.push(value)
      }
    }
    const element = { scrollTop: 0, scrollHeight: 1_000, clientHeight: 300, style }

    restoreConversationScroll(element, { scrollTop: 240, followBottom: false })

    expect(element.scrollTop).toBe(240)
    expect(assignedBehaviors).toEqual(['auto', 'smooth'])
  })

  it('follows the current bottom when the prior position was near the bottom', () => {
    const snapshot = captureConversationScroll({
      scrollTop: 675,
      scrollHeight: 1_000,
      clientHeight: 300
    })
    expect(snapshot.followBottom).toBe(true)

    const element = { scrollTop: 0, scrollHeight: 1_400, clientHeight: 300 }
    restoreConversationScroll(element, snapshot)
    expect(element.scrollTop).toBe(1_100)
  })
})
